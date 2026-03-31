use std::collections::HashMap;

use chrono::{Duration, Utc};
use grammers_client::{tl, InvocationError};
use grammers_session::types::{PeerAuth, PeerId, PeerKind, PeerRef};
use tauri::Emitter;

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatInfo {
    pub id: i64,
    pub title: String,
    pub username: Option<String>,
    pub member_count: Option<i32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemberActivity {
    pub user_id: i64,
    pub name: String,
    pub username: Option<String>,
    pub message_count: u32,
    pub reaction_count: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnalysisResult {
    pub chat: ChatInfo,
    pub members: Vec<MemberActivity>,
    pub members_with_messages: u32,
    pub total_messages: u32,
    pub period_months: i32,
}

#[derive(thiserror::Error, Debug, serde::Serialize)]
pub enum AnalysisError {
    #[error("Not authorized")]
    NotAuthorized,
    #[error("Chat not found: {0}")]
    ChatNotFound(String),
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Telegram error: {0}")]
    Telegram(String),
}

// ── URL parsing ───────────────────────────────────────────────────────────────

enum ChatIdentifier {
    Username(String),
    ChannelId(i64),
}

fn parse_chat_identifier(url: &str) -> Result<ChatIdentifier, AnalysisError> {
    let url = url.trim();
    let path = if let Some(s) = url.strip_prefix("https://t.me/") {
        s
    } else if let Some(s) = url.strip_prefix("http://t.me/") {
        s
    } else if let Some(s) = url.strip_prefix("t.me/") {
        s
    } else {
        url
    };
    let path = path.trim_end_matches('/');

    // Private channel link: t.me/c/CHANNEL_ID or t.me/c/CHANNEL_ID/MESSAGE_ID
    if let Some(rest) = path.strip_prefix("c/") {
        let id_str = rest.split('/').next().unwrap_or("");
        let id: i64 = id_str.parse().map_err(|_| {
            AnalysisError::InvalidUrl(format!("Invalid channel ID in URL: {}", url))
        })?;
        return Ok(ChatIdentifier::ChannelId(id));
    }

    let username = path.split('/').next().unwrap_or("").trim();
    if username.is_empty() {
        return Err(AnalysisError::InvalidUrl(format!(
            "No username found in: {}",
            url
        )));
    }
    Ok(ChatIdentifier::Username(username.to_string()))
}

// ── Peer helpers ──────────────────────────────────────────────────────────────

fn chat_info_from_peer(peer: &grammers_client::peer::Peer) -> ChatInfo {
    use grammers_client::peer::Peer;
    match peer {
        Peer::Channel(channel) => ChatInfo {
            id: channel.id().bare_id(),
            title: channel.title().to_string(),
            username: channel.username().map(str::to_string),
            member_count: channel.raw.participants_count,
        },
        Peer::Group(group) => ChatInfo {
            id: group.id().bare_id(),
            title: group.title().unwrap_or("Unknown").to_string(),
            username: group.username().map(str::to_string),
            member_count: None,
        },
        Peer::User(user) => ChatInfo {
            id: user.id().bare_id(),
            title: user.full_name(),
            username: user.username().map(str::to_string),
            member_count: None,
        },
    }
}

/// Fetch participants_count from GetFullChannel when it is absent in the basic Channel object.
/// Returns None silently on failure (e.g. insufficient permissions).
async fn fetch_participants_count(
    client: &grammers_client::Client,
    peer: &grammers_client::peer::Peer,
) -> Option<i32> {
    let peer_ref = peer.to_ref().await?;
    let result = client
        .invoke(&tl::functions::channels::GetFullChannel {
            channel: peer_ref.into(),
        })
        .await
        .ok()?;
    let tl::enums::messages::ChatFull::Full(full) = result;
    match full.full_chat {
        tl::enums::ChatFull::ChannelFull(cf) => cf.participants_count,
        _ => None,
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Resolve a t.me URL or @username or t.me/c/ID to basic chat information.
pub async fn resolve_chat(chat_url: &str) -> Result<ChatInfo, AnalysisError> {
    let client = super::auth::get_client()
        .await
        .ok_or(AnalysisError::NotAuthorized)?;

    let peer = match parse_chat_identifier(chat_url)? {
        ChatIdentifier::Username(name) => client
            .resolve_username(&name)
            .await
            .map_err(|e| AnalysisError::Telegram(e.to_string()))?
            .ok_or_else(|| AnalysisError::ChatNotFound(name))?,
        ChatIdentifier::ChannelId(id) => {
            let peer_ref = PeerRef {
                id: PeerId::channel(id),
                auth: PeerAuth::default(),
            };
            client
                .resolve_peer(peer_ref)
                .await
                .map_err(|e| AnalysisError::Telegram(e.to_string()))?
        }
    };

    let mut info = chat_info_from_peer(&peer);
    if info.member_count.is_none() {
        info.member_count = fetch_participants_count(&client, &peer).await;
    }
    Ok(info)
}

/// Scan messages for the given chat over the last `months` months and compute
/// per-user activity.  Progress and log events are emitted to the frontend.
pub async fn run_analysis(
    chat_url: &str,
    months: i32,
    include_reactions: bool,
    app: tauri::AppHandle,
) -> Result<AnalysisResult, AnalysisError> {
    let client = super::auth::get_client()
        .await
        .ok_or(AnalysisError::NotAuthorized)?;

    let (peer, label) = match parse_chat_identifier(chat_url)? {
        ChatIdentifier::Username(name) => {
            let _ = app.emit("log", format!("Resolving @{}…", name));
            let peer = client
                .resolve_username(&name)
                .await
                .map_err(|e| AnalysisError::Telegram(e.to_string()))?
                .ok_or_else(|| AnalysisError::ChatNotFound(name.clone()))?;
            (peer, format!("@{}", name))
        }
        ChatIdentifier::ChannelId(id) => {
            let _ = app.emit("log", format!("Resolving channel {}…", id));
            let peer_ref = PeerRef {
                id: PeerId::channel(id),
                auth: PeerAuth::default(),
            };
            let peer = client
                .resolve_peer(peer_ref)
                .await
                .map_err(|e| AnalysisError::Telegram(e.to_string()))?;
            (peer, format!("channel {}", id))
        }
    };

    let mut chat_info = chat_info_from_peer(&peer);
    if chat_info.member_count.is_none() {
        chat_info.member_count = fetch_participants_count(&client, &peer).await;
    }

    let peer_ref: PeerRef = peer
        .to_ref()
        .await
        .ok_or_else(|| AnalysisError::Telegram("Could not obtain peer reference".into()))?;

    let cutoff = Utc::now() - Duration::days(months as i64 * 30);
    let _ = app.emit(
        "log",
        format!(
            "Scanning messages since {} for {}…",
            cutoff.format("%Y-%m-%d"),
            label
        ),
    );

    // user_id → (display_name, username, message_count, reaction_count)
    let mut activity: HashMap<i64, (String, Option<String>, u32, u32)> = HashMap::new();
    let mut total_messages: u32 = 0;
    let mut scanned: u32 = 0;

    let mut msg_iter = client.iter_messages(peer_ref.clone());

    loop {
        match msg_iter.next().await {
            Ok(Some(msg)) => {
                if msg.date() < cutoff {
                    break;
                }
                scanned += 1;

                if scanned % 100 == 0 {
                    let _ = app.emit("message_count", scanned);
                }
                if scanned % 500 == 0 {
                    let _ = app.emit("progress", scanned);
                    let _ = app.emit("log", format!("Scanned {} messages…", scanned));
                }

                if let Some(sender_id) = msg.sender_id() {
                    // Only count actual user messages, not channel-signed posts
                    if matches!(sender_id.kind(), PeerKind::User | PeerKind::UserSelf) {
                        let uid = sender_id.bare_id();
                        let name = msg
                            .sender()
                            .and_then(|p| p.name())
                            .unwrap_or("Unknown")
                            .to_string();
                        let username = msg.sender().and_then(|p| {
                            use grammers_client::peer::Peer;
                            if let Peer::User(u) = p {
                                u.username().map(|s| s.to_string())
                            } else {
                                None
                            }
                        });

                        let entry = activity.entry(uid).or_insert((name, username, 0, 0));
                        entry.2 += 1;
                        total_messages += 1;

                        // Fetch per-message reactions
                        if include_reactions {
                            let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
                            if let Ok(raw) = fetch_reactions(&client, input_peer, msg.id()).await {
                                // Count reactions whose author is a known member
                                for reaction_peer in raw {
                                    if let tl::enums::Peer::User(u) = reaction_peer {
                                        let reacting_uid = u.user_id;
                                        if let Some(e) = activity.get_mut(&reacting_uid) {
                                            e.3 += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => return Err(AnalysisError::Telegram(e.to_string())),
        }
    }

    let _ = app.emit("log", format!("Done. {} messages scanned.", scanned));
    let _ = app.emit("progress", scanned);

    let mut members: Vec<MemberActivity> = activity
        .into_iter()
        .map(|(user_id, (name, username, message_count, reaction_count))| MemberActivity {
            user_id,
            name,
            username,
            message_count,
            reaction_count,
        })
        .collect();
    members.sort_by(|a, b| b.message_count.cmp(&a.message_count));
    let members_with_messages = members.len() as u32;

    Ok(AnalysisResult {
        chat: chat_info,
        members_with_messages,
        members,
        total_messages,
        period_months: months,
    })
}

/// Fetch all reaction peers for a single message.
async fn fetch_reactions(
    client: &grammers_client::Client,
    input_peer: tl::enums::InputPeer,
    msg_id: i32,
) -> Result<Vec<tl::enums::Peer>, InvocationError> {
    let mut peers = Vec::new();
    let mut offset: Option<String> = None;

    loop {
        let result = client
            .invoke(&tl::functions::messages::GetMessageReactionsList {
                peer: input_peer.clone(),
                id: msg_id,
                reaction: None,
                offset: offset.clone(),
                limit: 100,
            })
            .await?;

        let tl::enums::messages::MessageReactionsList::List(list) = result;

        for reaction in list.reactions {
            let tl::enums::MessagePeerReaction::Reaction(r) = reaction;
            peers.push(r.peer_id);
        }

        match list.next_offset {
            Some(next) => offset = Some(next),
            None => break,
        }
    }

    Ok(peers)
}
