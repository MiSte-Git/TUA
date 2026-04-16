use chrono::{DateTime, Utc};
use grammers_client::{tl, Client, InvocationError};
use std::collections::HashMap;
use grammers_session::types::{PeerAuth, PeerId, PeerRef};
use tauri::Emitter;
use tokio::time::{sleep, Duration};

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct ChatMember {
    pub user_id: i64,
    pub name: String,
    pub username: Option<String>,
    pub joined_at: Option<String>, // ISO 8601
}

#[derive(serde::Serialize)]
pub struct FirstMentionResult {
    pub first_own_message: Option<String>, // ISO 8601
    pub first_mention: Option<String>,     // ISO 8601
    pub first_seen: Option<String>,        // ISO 8601, min() of both
    pub message_context: Option<String>,   // message text, max 200 chars
    pub message_link: Option<String>,      // https://t.me/USERNAME/ID or https://t.me/c/CHAT_ID/ID
    pub found_in: String,                  // "own_message" | "mention" | "both" | "not_found"
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Load all channel/supergroup members and emit progress events.
pub async fn load_chat_members(
    client: &Client,
    chat_id: i64,
    app: &tauri::AppHandle,
) -> Result<Vec<ChatMember>, String> {
    let input_channel = resolve_input_channel(client, chat_id).await?;

    let mut members: Vec<ChatMember> = Vec::new();
    let mut offset = 0i32;
    let limit = 200i32;

    loop {
        let result = client
            .invoke(&tl::functions::channels::GetParticipants {
                channel: input_channel.clone(),
                filter: tl::enums::ChannelParticipantsFilter::ChannelParticipantsRecent,
                offset,
                limit,
                hash: 0,
            })
            .await
            .map_err(|e| e.to_string())?;

        let (batch_count, participants, users) = match result {
            tl::enums::channels::ChannelParticipants::Participants(list) => {
                (list.participants.len(), list.participants, list.users)
            }
            tl::enums::channels::ChannelParticipants::NotModified => break,
        };

        if batch_count == 0 {
            break;
        }

        // Build user_id → join timestamp map from participants
        let date_map: HashMap<i64, i32> = participants
            .iter()
            .filter_map(|p| {
                let (uid, date_opt) = participant_join_info(p);
                date_opt.map(|d| (uid, d))
            })
            .collect();

        for user in users {
            if let tl::enums::User::User(u) = user {
                let name = build_display_name(u.first_name.as_deref(), u.last_name.as_deref(), u.id);
                let joined_at = date_map.get(&u.id).and_then(|&ts| {
                    DateTime::from_timestamp(ts as i64, 0)
                }).map(|dt| dt.to_rfc3339());
                members.push(ChatMember {
                    user_id: u.id,
                    name,
                    username: u.username,
                    joined_at,
                });
            }
        }

        let total = members.len();
        let _ = app.emit("members_progress", total as u32);

        // Log every 1 000 members
        if total > 0 && total % 1000 == 0 {
            let _ = app.emit("log", format!("{} Mitglieder geladen…", total));
        }

        if batch_count < limit as usize {
            break;
        }
        offset += batch_count as i32;
    }

    let _ = app.emit(
        "log",
        format!("{} Mitglieder insgesamt geladen.", members.len()),
    );

    Ok(members)
}

pub async fn find_first_mention(
    client: &Client,
    chat_id: i64,
    chat_username: Option<String>,
    username: String,
    app: &tauri::AppHandle,
) -> Result<FirstMentionResult, String> {
    // Normalize: strip leading @, lowercase
    let username = username.trim_start_matches('@').to_lowercase();

    // Resolve peer from bare chat ID
    let init_ref = PeerRef {
        id: PeerId::channel(chat_id).expect("invalid channel id"),
        auth: PeerAuth::default(),
    };
    let peer = client
        .resolve_peer(init_ref)
        .await
        .map_err(|e| e.to_string())?;
    let peer_ref = peer
        .to_ref()
        .await
        .ok_or("Could not obtain peer reference")?;

    // ── Membership check ──────────────────────────────────────────────────────
    let input_peer_check = tl::enums::InputPeer::from(peer_ref.clone());
    if let tl::enums::InputPeer::Channel(c) = input_peer_check {
        let input_channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
            channel_id: c.channel_id,
            access_hash: c.access_hash,
        });
        let search_result = client
            .invoke(&tl::functions::channels::GetParticipants {
                channel: input_channel,
                filter: tl::enums::ChannelParticipantsFilter::ChannelParticipantsSearch(
                    tl::types::ChannelParticipantsSearch {
                        q: username.clone(),
                    },
                ),
                offset: 0,
                limit: 50,
                hash: 0,
            })
            .await
            .map_err(|e| e.to_string())?;

        if let tl::enums::channels::ChannelParticipants::Participants(list) = search_result {
            let is_member = list.users.iter().any(|u| {
                if let tl::enums::User::User(user) = u {
                    user.username
                        .as_ref()
                        .map(|s| s.to_lowercase() == username)
                        .unwrap_or(false)
                } else {
                    false
                }
            });
            if !is_member {
                return Err(format!(
                    "User @{} ist kein Mitglied dieses Chats",
                    username
                ));
            }
        }
        // NotModified → skip check (treat as valid)
    }
    // Regular groups (InputPeer::Chat) → skip membership check

    let mut first_own_message: Option<DateTime<Utc>> = None;
    let mut first_mention: Option<DateTime<Utc>> = None;
    let mut message_context: Option<String> = None;
    let mut message_link: Option<String> = None;

    let mut msg_iter = client.iter_messages(peer_ref);
    let mut scanned: u32 = 0;

    loop {
        // ── Fetch next message with retry on RPC 500 ─────────────────────────
        let msg_opt = {
            let mut attempt = 0u8;
            loop {
                match msg_iter.next().await {
                    ok @ Ok(_) => break ok,
                    Err(e) if is_rpc_500(&e) && attempt < 3 => {
                        attempt += 1;
                        let _ = app.emit(
                            "log",
                            format!("Telegram-Fehler, neuer Versuch in 5s… ({}/3)", attempt),
                        );
                        sleep(Duration::from_secs(5)).await;
                    }
                    Err(e) => {
                        if attempt > 0 {
                            let _ = app.emit(
                                "log",
                                format!("Fehler nach {} Versuchen: {}", attempt, e),
                            );
                        }
                        break Err(e);
                    }
                }
            }
        };

        match msg_opt {
            Ok(Some(msg)) => {
                scanned += 1;

                // ── Progress log + batch pause every 1 000 messages ──────────
                if scanned % 1000 == 0 {
                    let _ = app.emit(
                        "log",
                        format!("Erste Erwähnung: {} Nachrichten durchsucht…", scanned),
                    );
                    sleep(Duration::from_millis(500)).await;
                }

                let msg_date = msg.date();
                let msg_text = msg.text().to_string();

                // Resolve sender username (lowercase)
                let sender_username: Option<String> = msg.sender().and_then(|p| {
                    use grammers_client::peer::Peer;
                    if let Peer::User(u) = p {
                        u.username().map(|s| s.to_lowercase())
                    } else {
                        None
                    }
                });

                let is_own = sender_username.as_deref() == Some(username.as_str());

                // a) Own message — always overwrite (newest→oldest ⇒ last write = oldest)
                if is_own {
                    first_own_message = Some(msg_date);
                }

                // b) @mention in someone else's message — always overwrite
                if !is_own && contains_mention(&msg_text, &username) {
                    first_mention = Some(msg_date);
                    message_context = Some(msg_text.chars().take(200).collect());
                    message_link = Some(build_link(&chat_username, chat_id, msg.id()));
                }
            }
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }

    let _ = app.emit(
        "log",
        format!(
            "Erste Erwähnung: {} Nachrichten insgesamt durchsucht.",
            scanned
        ),
    );

    let first_seen = match (first_own_message, first_mention) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };

    let found_in = match (first_own_message.is_some(), first_mention.is_some()) {
        (true, true) => "both",
        (true, false) => "own_message",
        (false, true) => "mention",
        (false, false) => "not_found",
    }
    .to_string();

    Ok(FirstMentionResult {
        first_own_message: first_own_message.map(|dt| dt.to_rfc3339()),
        first_mention: first_mention.map(|dt| dt.to_rfc3339()),
        first_seen: first_seen.map(|dt| dt.to_rfc3339()),
        message_context,
        message_link,
        found_in,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract (user_id, optional join date) from a channel participant record.
fn participant_join_info(p: &tl::enums::ChannelParticipant) -> (i64, Option<i32>) {
    match p {
        tl::enums::ChannelParticipant::Participant(x) => (x.user_id, Some(x.date)),
        tl::enums::ChannelParticipant::ParticipantSelf(x) => (x.user_id, Some(x.date)),
        tl::enums::ChannelParticipant::Admin(x) => (x.user_id, Some(x.date)),
        tl::enums::ChannelParticipant::Creator(x) => (x.user_id, None),
        tl::enums::ChannelParticipant::Banned(_) => (0, None),
        tl::enums::ChannelParticipant::Left(_) => (0, None),
    }
}

/// Resolve InputChannel from a bare chat_id.
async fn resolve_input_channel(
    client: &Client,
    chat_id: i64,
) -> Result<tl::enums::InputChannel, String> {
    let init_ref = PeerRef {
        id: PeerId::channel(chat_id).expect("invalid channel id"),
        auth: PeerAuth::default(),
    };
    let peer = client
        .resolve_peer(init_ref)
        .await
        .map_err(|e| e.to_string())?;
    let peer_ref = peer
        .to_ref()
        .await
        .ok_or("Could not obtain peer reference")?;
    let input_peer = tl::enums::InputPeer::from(peer_ref);
    match input_peer {
        tl::enums::InputPeer::Channel(c) => Ok(tl::enums::InputChannel::Channel(
            tl::types::InputChannel {
                channel_id: c.channel_id,
                access_hash: c.access_hash,
            },
        )),
        _ => Err("Mitgliederliste ist nur für Channels und Supergroups verfügbar".to_string()),
    }
}

/// Build a human-readable display name from Telegram first/last name fields.
fn build_display_name(first: Option<&str>, last: Option<&str>, id: i64) -> String {
    match (first.filter(|s| !s.is_empty()), last.filter(|s| !s.is_empty())) {
        (Some(f), Some(l)) => format!("{} {}", f, l),
        (Some(f), None) => f.to_string(),
        (None, Some(l)) => l.to_string(),
        (None, None) => format!("User {}", id),
    }
}

/// Returns true for transient Telegram server errors (RPC code 500).
fn is_rpc_500(e: &InvocationError) -> bool {
    matches!(e, InvocationError::Rpc(rpc) if rpc.code == 500)
}

/// Check whether `text` contains `@username` as a standalone mention.
/// Comparison is case-insensitive (both sides already lowercased).
fn contains_mention(text: &str, username: &str) -> bool {
    let text_lower = text.to_lowercase();
    let target = format!("@{}", username);
    if let Some(pos) = text_lower.find(&target) {
        // Ensure the character after the match is not part of a longer username
        let next = text_lower.as_bytes().get(pos + target.len());
        !matches!(next, Some(b) if b.is_ascii_alphanumeric() || *b == b'_')
    } else {
        false
    }
}

/// Build a public message link.
fn build_link(chat_username: &Option<String>, chat_id: i64, msg_id: i32) -> String {
    match chat_username {
        Some(uname) => format!("https://t.me/{}/{}", uname, msg_id),
        None => format!("https://t.me/c/{}/{}", chat_id, msg_id),
    }
}
