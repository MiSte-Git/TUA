use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, NaiveDate, Utc};
use grammers_client::{tl, InvocationError};
use grammers_session::types::{PeerAuth, PeerId, PeerKind, PeerRef};
use tauri::Emitter;

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BotMember {
    pub user_id: i64,
    pub name: String,
    pub username: Option<String>,
}

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
    pub poll_participations: u32,
    pub quiz_participations: u32,
    pub is_bot: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnalysisResult {
    pub chat: ChatInfo,
    pub members: Vec<MemberActivity>,
    pub members_with_messages: u32,
    pub total_messages: u32,
    pub period_months: i32,            // 0 = custom date range
    pub period_from: Option<String>,   // ISO date, set when period_months == 0
    pub period_to: Option<String>,     // ISO date, set when period_months == 0
    pub total_polls_in_period: u32,    // Umfragen (quiz=false) im Zeitraum
    pub total_quizzes_in_period: u32,  // Quizze (quiz=true) im Zeitraum
    pub all_bots: Vec<BotMember>,
    pub own_is_admin: bool,
    pub own_can_get_participants: bool,
    pub avg_poll_participation: f32,   // Ø Umfrage-Teilnahmen pro aktivem Teilnehmer
    pub avg_quiz_participation: f32,   // Ø Quiz-Teilnahmen pro aktivem Teilnehmer
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

/// Scan messages for the given chat over the last `months` months (or a custom
/// date range) and compute per-user activity.  Progress and log events are
/// emitted to the frontend.
pub async fn run_analysis(
    chat_url: &str,
    months: i32,
    include_reactions: bool,
    include_polls: bool,
    include_quizzes: bool,
    date_from: Option<String>,
    date_to: Option<String>,
    app: tauri::AppHandle,
) -> Result<AnalysisResult, AnalysisError> {
    let client = super::auth::get_client()
        .await
        .ok_or(AnalysisError::NotAuthorized)?;

    let (peer, label) = match parse_chat_identifier(chat_url)? {
        ChatIdentifier::Username(name) => {
            let _ = app.emit("log", format!("Kanal @{} wird aufgelöst…", name));
            let peer = client
                .resolve_username(&name)
                .await
                .map_err(|e| AnalysisError::Telegram(e.to_string()))?
                .ok_or_else(|| AnalysisError::ChatNotFound(name.clone()))?;
            (peer, format!("@{}", name))
        }
        ChatIdentifier::ChannelId(id) => {
            let _ = app.emit("log", format!("Kanal {} wird aufgelöst…", id));
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

    // Collect bots from participant list (independent of message time window)
    let all_bots = collect_bots(&client, &peer_ref).await.unwrap_or_default();
    let bot_ids: HashSet<i64> = all_bots.iter().map(|b| b.user_id).collect();
    if !all_bots.is_empty() {
        let _ = app.emit("log", format!("{} Bots im Kanal gefunden.", all_bots.len()));
    }

    // Check own admin rights
    let (own_is_admin, own_can_get_participants) =
        check_own_permissions(&client, &peer_ref).await;

    // Determine the scan window [cutoff, end_date]
    let (cutoff, end_date, period_from_str, period_to_str): (
        DateTime<Utc>,
        DateTime<Utc>,
        Option<String>,
        Option<String>,
    ) = if months > 0 {
        (Utc::now() - Duration::days(months as i64 * 30), Utc::now(), None, None)
    } else {
        let from_str = date_from
            .ok_or_else(|| AnalysisError::InvalidUrl("date_from fehlt".into()))?;
        let to_str = date_to
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let from_naive = NaiveDate::parse_from_str(&from_str, "%Y-%m-%d")
            .map_err(|_| AnalysisError::InvalidUrl(format!("Ungültiges Datum: {}", from_str)))?;
        let to_naive = NaiveDate::parse_from_str(&to_str, "%Y-%m-%d")
            .map_err(|_| AnalysisError::InvalidUrl(format!("Ungültiges Datum: {}", to_str)))?;
        let cutoff_dt = from_naive
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| AnalysisError::InvalidUrl("Ungültiges Datum".into()))?
            .and_utc();
        let end_dt = to_naive
            .and_hms_opt(23, 59, 59)
            .ok_or_else(|| AnalysisError::InvalidUrl("Ungültiges Datum".into()))?
            .and_utc();
        (cutoff_dt, end_dt, Some(from_str), Some(to_str))
    };

    let _ = app.emit(
        "log",
        format!(
            "Scanne Nachrichten für {} | Zeitraum: {} bis {}",
            label,
            cutoff.format("%Y-%m-%d"),
            end_date.format("%Y-%m-%d"),
        ),
    );

    // user_id → (name, username, message_count, reaction_count, poll_participations, quiz_participations)
    let mut activity: HashMap<i64, (String, Option<String>, u32, u32, u32, u32)> = HashMap::new();
    let mut total_messages: u32 = 0;
    let mut total_polls: u32 = 0;
    let mut total_quizzes: u32 = 0;
    let mut scanned: u32 = 0;
    let mut first_poll_date: Option<DateTime<Utc>> = None;
    let mut last_poll_date: Option<DateTime<Utc>> = None;

    let mut msg_iter = client.iter_messages(peer_ref.clone());

    loop {
        match msg_iter.next().await {
            Ok(Some(msg)) => {
                if msg.date() < cutoff {
                    break;
                }
                if msg.date() > end_date {
                    continue;
                }
                scanned += 1;

                if scanned % 100 == 0 {
                    let _ = app.emit("message_count", scanned);
                }
                if scanned % 500 == 0 {
                    let _ = app.emit("progress", scanned);
                    let _ = app.emit("log", format!("Bisher {} Nachrichten gescannt…", scanned));
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

                        let entry = activity.entry(uid).or_insert((name, username, 0, 0, 0, 0));
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
                // Umfragen / Quizze erfassen und Teilnahmen zuordnen
                if let tl::enums::Message::Message(raw_msg) = &msg.raw {
                    if let Some(tl::enums::MessageMedia::Poll(poll_media)) = &raw_msg.media {
                        let is_quiz = match &poll_media.poll {
                            tl::enums::Poll::Poll(p) => p.quiz,
                        };

                        if is_quiz {
                            total_quizzes += 1;
                        } else {
                            total_polls += 1;
                        }

                        let poll_dt = msg.date();
                        if first_poll_date.map_or(true, |d| poll_dt > d) {
                            first_poll_date = Some(poll_dt);
                        }
                        if last_poll_date.map_or(true, |d| poll_dt < d) {
                            last_poll_date = Some(poll_dt);
                        }

                        // Stimmen nur abrufen wenn der jeweilige Toggle aktiv ist
                        let should_fetch = if is_quiz { include_quizzes } else { include_polls };
                        if should_fetch {
                            let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
                            if let Ok(voter_ids) =
                                fetch_poll_votes(&client, input_peer, msg.id()).await
                            {
                                // Deduplizieren: jeder Nutzer zählt max. 1× pro Abstimmung
                                let unique: HashSet<i64> = voter_ids.into_iter().collect();
                                for uid in unique {
                                    if let Some(e) = activity.get_mut(&uid) {
                                        if is_quiz {
                                            e.5 += 1; // quiz_participations
                                        } else {
                                            e.4 += 1; // poll_participations
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

    let _ = app.emit("log", format!("Fertig. {} Nachrichten gescannt.", scanned));
    if total_polls + total_quizzes > 0 {
        let first_str = first_poll_date
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "?".into());
        let last_str = last_poll_date
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "?".into());
        let _ = app.emit(
            "log",
            format!(
                "Umfragen: {} | Quizze: {} | Erste: {} | Letzte: {}",
                total_polls, total_quizzes, first_str, last_str
            ),
        );
    }
    let _ = app.emit("progress", scanned);

    let mut members: Vec<MemberActivity> = activity
        .into_iter()
        .map(
            |(
                user_id,
                (name, username, message_count, reaction_count, poll_participations, quiz_participations),
            )| MemberActivity {
                user_id,
                name,
                username,
                message_count,
                reaction_count,
                poll_participations,
                quiz_participations,
                is_bot: bot_ids.contains(&user_id),
            },
        )
        .collect();
    members.sort_by(|a, b| b.message_count.cmp(&a.message_count));
    let members_with_messages = members.len() as u32;

    // Ø Teilnehmer pro Umfrage = Gesamtstimmen / Anzahl Umfragen
    let total_poll_participations: u32 = members.iter().map(|m| m.poll_participations).sum();
    let avg_poll_participation: f32 = if total_polls > 0 {
        total_poll_participations as f32 / total_polls as f32
    } else {
        0.0
    };

    // Ø Teilnehmer pro Quiz = Gesamtstimmen / Anzahl Quizze
    let total_quiz_participations: u32 = members.iter().map(|m| m.quiz_participations).sum();
    let avg_quiz_participation: f32 = if total_quizzes > 0 {
        total_quiz_participations as f32 / total_quizzes as f32
    } else {
        0.0
    };

    Ok(AnalysisResult {
        chat: chat_info,
        members_with_messages,
        members,
        total_messages,
        total_polls_in_period: total_polls,
        total_quizzes_in_period: total_quizzes,
        period_months: months,
        period_from: period_from_str,
        period_to: period_to_str,
        all_bots,
        own_is_admin,
        own_can_get_participants,
        avg_poll_participation,
        avg_quiz_participation,
    })
}

/// Check whether the signed-in account is an admin (or creator) of the channel.
/// Returns `(is_admin, can_get_participants)` — both flags are identical since
/// participant-list access is gated on admin status in Telegram.
async fn check_own_permissions(
    client: &grammers_client::Client,
    peer_ref: &PeerRef,
) -> (bool, bool) {
    let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
    let input_channel = match input_peer {
        tl::enums::InputPeer::Channel(c) => tl::enums::InputChannel::Channel(
            tl::types::InputChannel {
                channel_id: c.channel_id,
                access_hash: c.access_hash,
            },
        ),
        _ => return (false, false),
    };

    match client
        .invoke(&tl::functions::channels::GetParticipant {
            channel: input_channel,
            participant: tl::enums::InputPeer::PeerSelf,
        })
        .await
    {
        Ok(tl::enums::channels::ChannelParticipant::Participant(cp)) => {
            let is_admin = matches!(
                cp.participant,
                tl::enums::ChannelParticipant::Creator(_)
                    | tl::enums::ChannelParticipant::Admin(_)
            );
            (is_admin, is_admin)
        }
        _ => (false, false),
    }
}

/// Collect all bot members of a channel/supergroup via GetParticipants with
/// the ChannelParticipantsBots filter.  Returns an empty Vec silently for
/// regular groups (non-channel peers) or on API errors.
async fn collect_bots(
    client: &grammers_client::Client,
    peer_ref: &PeerRef,
) -> Result<Vec<BotMember>, AnalysisError> {
    let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
    let input_channel = match input_peer {
        tl::enums::InputPeer::Channel(c) => tl::enums::InputChannel::Channel(
            tl::types::InputChannel {
                channel_id: c.channel_id,
                access_hash: c.access_hash,
            },
        ),
        _ => return Ok(Vec::new()),
    };

    let mut bots = Vec::new();
    let mut offset = 0i32;
    let limit = 200i32;

    loop {
        let result = client
            .invoke(&tl::functions::channels::GetParticipants {
                channel: input_channel.clone(),
                filter: tl::enums::ChannelParticipantsFilter::ChannelParticipantsBots,
                offset,
                limit,
                hash: 0,
            })
            .await
            .map_err(|e| AnalysisError::Telegram(e.to_string()))?;

        let (batch_count, users) = match result {
            tl::enums::channels::ChannelParticipants::Participants(list) => {
                (list.participants.len(), list.users)
            }
            tl::enums::channels::ChannelParticipants::NotModified => break,
        };

        if batch_count == 0 {
            break;
        }

        for user in users {
            if let tl::enums::User::User(u) = user {
                let name = match (
                    u.first_name.as_deref().filter(|s| !s.is_empty()),
                    u.last_name.as_deref().filter(|s| !s.is_empty()),
                ) {
                    (Some(f), Some(l)) => format!("{} {}", f, l),
                    (Some(f), None) => f.to_string(),
                    (None, Some(l)) => l.to_string(),
                    (None, None) => format!("Bot {}", u.id),
                };
                bots.push(BotMember {
                    user_id: u.id,
                    name,
                    username: u.username,
                });
            }
        }

        if batch_count < limit as usize {
            break;
        }
        offset += batch_count as i32;
    }

    Ok(bots)
}

/// Fetch all user IDs who voted in a poll message.  Errors are silently ignored
/// by the caller — not all chats / poll types support GetPollVotes.
async fn fetch_poll_votes(
    client: &grammers_client::Client,
    input_peer: tl::enums::InputPeer,
    msg_id: i32,
) -> Result<Vec<i64>, InvocationError> {
    let mut voter_ids = Vec::new();
    let mut offset: Option<String> = None;

    loop {
        let result = client
            .invoke(&tl::functions::messages::GetPollVotes {
                peer: input_peer.clone(),
                id: msg_id,
                option: None,
                offset: offset.clone(),
                limit: 100,
            })
            .await?;

        let tl::enums::messages::VotesList::List(list) = result;

        for vote in list.votes {
            let peer = match vote {
                tl::enums::MessagePeerVote::Vote(v) => v.peer,
                tl::enums::MessagePeerVote::InputOption(v) => v.peer,
                tl::enums::MessagePeerVote::Multiple(v) => v.peer,
            };
            if let tl::enums::Peer::User(u) = peer {
                voter_ids.push(u.user_id);
            }
        }

        match list.next_offset {
            Some(next) => offset = Some(next),
            None => break,
        }
    }

    Ok(voter_ids)
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
