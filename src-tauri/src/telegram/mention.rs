use chrono::{DateTime, Utc};
use grammers_client::{tl, Client};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use grammers_session::types::{PeerAuth, PeerId, PeerRef};
use tauri::Emitter;

static CANCEL: AtomicBool = AtomicBool::new(false);

/// Signal the running find_first_mention to abort.
pub fn cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

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
    pub first_seen: Option<String>,        // ISO 8601, min() of all three
    pub message_context: Option<String>,   // message text, max 200 chars
    pub message_link: Option<String>,      // https://t.me/USERNAME/ID or https://t.me/c/CHAT_ID/ID
    pub found_in: String,                  // "own_message" | "mention" | "both" | "not_found"
    pub joined_at: Option<String>,         // ISO 8601, current join date
    pub joined_at_is_rejoin: bool,         // true when user was active before current join
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
    // Reset any leftover cancel flag from a previous aborted search
    CANCEL.store(false, Ordering::Relaxed);

    // Normalize: strip leading @, lowercase
    let username = username.trim_start_matches('@').to_lowercase();

    // Resolve chat peer
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

    // ── Resolve user and extract InputPeer + user_id ──────────────────────────
    let user_peer = client
        .resolve_username(&username)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Benutzer @{} nicht gefunden", username))?;
    let user_peer_ref = user_peer
        .to_ref()
        .await
        .ok_or("Could not obtain user peer reference")?;
    let user_input_peer = tl::enums::InputPeer::from(user_peer_ref);
    let user_id: i64 = match &user_input_peer {
        tl::enums::InputPeer::User(u) => u.user_id,
        _ => return Err(format!("@{} ist kein Benutzer", username)),
    };

    // ── Get participant join date via GetParticipant ───────────────────────────
    let joined_at: Option<DateTime<Utc>> = {
        let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
        if let tl::enums::InputPeer::Channel(c) = input_peer {
            let input_channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id: c.channel_id,
                access_hash: c.access_hash,
            });
            match client
                .invoke(&tl::functions::channels::GetParticipant {
                    channel: input_channel,
                    participant: user_input_peer.clone(),
                })
                .await
            {
                Ok(tl::enums::channels::ChannelParticipant::Participant(cp)) => {
                    match &cp.participant {
                        tl::enums::ChannelParticipant::Participant(p) => {
                            DateTime::from_timestamp(p.date as i64, 0)
                        }
                        tl::enums::ChannelParticipant::Admin(a) => {
                            DateTime::from_timestamp(a.date as i64, 0)
                        }
                        tl::enums::ChannelParticipant::ParticipantSelf(p) => {
                            DateTime::from_timestamp(p.date as i64, 0)
                        }
                        _ => None,
                    }
                }
                _ => None,
            }
        } else {
            None
        }
    };

    // ── Search 1: own messages via server-side sender filter ─────────────────
    let first_own_message =
        find_oldest_own_message(client, peer_ref.clone(), user_input_peer.clone(), &username, app).await?;

    // ── Search 2: mentions via server-side text search ────────────────────────
    let _ = app.emit("log", format!("Suche Erwähnungen von @{}…", username));
    let (first_mention, message_context, message_link) =
        find_oldest_mention(client, peer_ref, &chat_username, chat_id, &username, user_id, app)
            .await?;

    let _ = app.emit("log", "Suche abgeschlossen.".to_string());

    let mut candidates: Vec<DateTime<Utc>> = vec![];
    if let Some(d) = first_own_message { candidates.push(d); }
    if let Some(d) = first_mention     { candidates.push(d); }
    if let Some(d) = joined_at         { candidates.push(d); }
    let first_seen = candidates.iter().min().copied();

    let joined_at_is_rejoin = match (joined_at, first_seen) {
        (Some(j), Some(e)) => j > e,
        _ => false,
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
        joined_at: joined_at.map(|dt| dt.to_rfc3339()),
        joined_at_is_rejoin,
    })
}

/// Search for the oldest message sent by `user_input_peer` using server-side
/// sender filtering (`messages.Search` with `from_id`). Messages come newest-
/// first; always overwriting `oldest` means the final value is the oldest match.
async fn find_oldest_own_message(
    client: &Client,
    chat_peer_ref: PeerRef,
    user_input_peer: tl::enums::InputPeer,
    username: &str,
    app: &tauri::AppHandle,
) -> Result<Option<DateTime<Utc>>, String> {
    let _ = app.emit(
        "log",
        format!("Starte Nachrichtensuche für @{}…", username),
    );

    let chat_input_peer = tl::enums::InputPeer::from(chat_peer_ref);
    let mut oldest: Option<DateTime<Utc>> = None;
    let mut count: u32 = 0;
    let mut offset_id = 0i32;

    loop {
        if CANCEL.load(Ordering::Relaxed) {
            CANCEL.store(false, Ordering::Relaxed);
            return Err("Abgebrochen".into());
        }

        let result = client
            .invoke(&tl::functions::messages::Search {
                peer: chat_input_peer.clone(),
                q: String::new(),
                from_id: Some(user_input_peer.clone()),
                saved_peer_id: None,
                saved_reaction: None,
                top_msg_id: None,
                filter: tl::enums::MessagesFilter::InputMessagesFilterEmpty,
                min_date: 0,
                max_date: 0,
                offset_id,
                add_offset: 0,
                limit: 100,
                max_id: 0,
                min_id: 0,
                hash: 0,
            })
            .await
            .map_err(|e| e.to_string())?;

        let messages: Vec<tl::enums::Message> = match result {
            tl::enums::messages::Messages::Messages(m) => m.messages,
            tl::enums::messages::Messages::Slice(m) => m.messages,
            tl::enums::messages::Messages::ChannelMessages(m) => m.messages,
            tl::enums::messages::Messages::NotModified(_) => break,
        };

        if messages.is_empty() {
            break;
        }

        let batch_len = messages.len();
        let mut last_id = offset_id;

        for msg in &messages {
            if let tl::enums::Message::Message(m) = msg {
                count += 1;
                last_id = m.id;
                if let Some(dt) = DateTime::from_timestamp(m.date as i64, 0) {
                    oldest = Some(dt);
                }
                if count % 50 == 0 {
                    let date_str = DateTime::from_timestamp(m.date as i64, 0)
                        .map(|d| d.format("%Y-%m-%d").to_string())
                        .unwrap_or_default();
                    let _ = app.emit(
                        "log",
                        format!(
                            "Geprüft: {} Nachrichten, aktuelles Datum: {}",
                            count, date_str,
                        ),
                    );
                }
            }
        }

        if batch_len < 100 {
            break;
        }
        offset_id = last_id;
    }

    let _ = app.emit(
        "log",
        format!("Suche beendet. {} eigene Nachrichten gefunden.", count),
    );

    Ok(oldest)
}

/// Find the oldest mention of `@username` by someone else using server-side
/// text search (search_messages with query). Messages come newest-first;
/// we always overwrite so the last assignment holds the oldest mention.
async fn find_oldest_mention(
    client: &Client,
    chat_peer_ref: PeerRef,
    chat_username: &Option<String>,
    chat_id: i64,
    username: &str,
    user_id: i64,
    app: &tauri::AppHandle,
) -> Result<(Option<DateTime<Utc>>, Option<String>, Option<String>), String> {
    let mut oldest: Option<DateTime<Utc>> = None;
    let mut context: Option<String> = None;
    let mut link: Option<String> = None;
    let mut total: u32 = 0;

    let mut iter = client
        .search_messages(chat_peer_ref)
        .query(&format!("@{}", username));

    loop {
        if CANCEL.load(Ordering::Relaxed) {
            CANCEL.store(false, Ordering::Relaxed);
            return Err("Abgebrochen".into());
        }

        match iter.next().await {
            Ok(Some(msg)) => {
                // Skip messages sent by the searched user themselves
                let is_own = msg
                    .sender_id()
                    .and_then(|p| p.bare_id())
                    .map(|id| id == user_id)
                    .unwrap_or(false);
                if is_own {
                    continue;
                }

                let text = msg.text().to_string();
                if !contains_mention(&text, username) {
                    continue;
                }

                // Newest-first → always overwrite; final value = oldest mention
                oldest = Some(msg.date());
                context = Some(text.chars().take(200).collect());
                link = Some(build_link(chat_username, chat_id, msg.id()));

                total += 1;
                if total % 500 == 0 {
                    let _ = app.emit("log", format!("Erwähnungen: {} gefunden…", total));
                }
            }
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok((oldest, context, link))
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
