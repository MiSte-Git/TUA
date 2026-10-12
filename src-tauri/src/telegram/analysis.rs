use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;
use grammers_client::{tl, InvocationError};
use grammers_session::types::{PeerAuth, PeerId, PeerKind, PeerRef};
use tauri::Emitter;

use super::cache;

static CANCEL: AtomicBool = AtomicBool::new(false);

/// Signal the running run_analysis to abort at the next checkpoint.
pub fn cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BotMember {
    pub user_id: i64,
    pub name: String,
    pub username: Option<String>,
}

/// A single dated activity, kept so exports can re-aggregate any sub-period.
/// `kind`: "message" | "reaction" | "poll" | "quiz".
/// For reactions `ts` is the date of the message reacted to (Telegram does not
/// expose the reaction time).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ActivityEvent {
    pub user_id: i64,
    pub ts: i64,
    pub kind: String,
}

/// A poll or quiz in the chat with its number of unique voters.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PollRecord {
    pub ts: i64,
    pub is_quiz: bool,
    pub voters: u32,
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
    pub joined_date: Option<i64>,       // Unix timestamp; filled via GetParticipant after analysis
    pub message_count: u32,
    pub reaction_count: u32,
    pub poll_participations: u32,
    pub quiz_participations: u32,
    pub first_message_date: Option<i64>, // Unix timestamp; earliest message in analysis period
    pub last_message_date: Option<i64>,
    pub last_reaction_date: Option<i64>,
    pub last_poll_date: Option<i64>,
    pub is_bot: bool,
    pub is_current_member: bool,
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
    pub avg_poll_participants: f32,    // Ø eindeutige Voter pro Umfrage (nur echte Polls, keine Quizze)
    pub avg_quiz_participation: f32,   // Ø Quiz-Teilnahmen pro aktivem Teilnehmer
    #[serde(default)]
    pub scan_from: Option<String>,     // ISO date (UTC), effective start of the scan window
    #[serde(default)]
    pub scan_to: Option<String>,       // ISO date (UTC), effective end of the scan window
    #[serde(default)]
    pub events: Vec<ActivityEvent>,    // every counted activity with its date
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UserOnlineStatus {
    /// "online" | "offline" | "recently" | "last_week" | "last_month" | "unknown"
    pub kind: String,
    /// Unix timestamp; only set when kind == "offline"
    pub was_online: Option<i64>,
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
    #[error("Abgebrochen")]
    Cancelled,
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

fn chat_info_from_peer(peer: &grammers_client::peer::Peer) -> Result<ChatInfo, AnalysisError> {
    use grammers_client::peer::Peer;
    let invalid = || AnalysisError::Telegram("Ungültige Chat-ID vom Server erhalten".into());
    Ok(match peer {
        Peer::Channel(channel) => ChatInfo {
            id: channel.id().bare_id().ok_or_else(invalid)?,
            title: channel.title().to_string(),
            username: channel.username().map(str::to_string),
            member_count: channel.raw.participants_count,
        },
        Peer::Group(group) => ChatInfo {
            id: group.id().bare_id().ok_or_else(invalid)?,
            title: group.title().unwrap_or("Unknown").to_string(),
            username: group.username().map(str::to_string),
            member_count: None,
        },
        Peer::User(user) => ChatInfo {
            id: user.id().bare_id().ok_or_else(invalid)?,
            title: user.full_name(),
            username: user.username().map(str::to_string),
            member_count: None,
        },
    })
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
                id: PeerId::channel(id).ok_or_else(|| AnalysisError::InvalidUrl(format!("Ungültige Kanal-ID: {}", id)))?,
                auth: PeerAuth::default(),
            };
            client
                .resolve_peer(peer_ref)
                .await
                .map_err(|e| AnalysisError::Telegram(e.to_string()))?
        }
    };

    let mut info = chat_info_from_peer(&peer)?;
    if info.member_count.is_none() {
        info.member_count = fetch_participants_count(&client, &peer).await;
    }
    Ok(info)
}

/// Run (or update) the analysis for a chat.
///
/// Raw data is cached on disk per chat. Only missing parts of the requested
/// window are fetched from Telegram: older history if the window starts
/// before the cached data, and new messages since the last scan.
/// `force_full` discards the cache and rescans the whole window.
pub async fn run_analysis(
    chat_url: &str,
    months: i32,
    include_reactions: bool,
    date_from: Option<String>,
    date_to: Option<String>,
    force_full: bool,
    app: tauri::AppHandle,
) -> Result<AnalysisResult, AnalysisError> {
    let client = super::auth::get_client()
        .await
        .ok_or(AnalysisError::NotAuthorized)?;

    // Reset any leftover cancel flag from a previous aborted run
    CANCEL.store(false, Ordering::Relaxed);

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
                id: PeerId::channel(id).ok_or_else(|| AnalysisError::InvalidUrl(format!("Ungültige Kanal-ID: {}", id)))?,
                auth: PeerAuth::default(),
            };
            let peer = client
                .resolve_peer(peer_ref)
                .await
                .map_err(|e| AnalysisError::Telegram(e.to_string()))?;
            (peer, format!("channel {}", id))
        }
    };

    let mut chat_info = chat_info_from_peer(&peer)?;
    if chat_info.member_count.is_none() {
        chat_info.member_count = fetch_participants_count(&client, &peer).await;
    }

    let peer_ref: PeerRef = peer
        .to_ref()
        .await
        .ok_or_else(|| AnalysisError::Telegram("Could not obtain peer reference".into()))?;

    // Collect bots from participant list (independent of message time window)
    let all_bots = collect_bots(&client, &peer_ref).await.unwrap_or_default();
    if !all_bots.is_empty() {
        let _ = app.emit("log", format!("{} Bots im Kanal gefunden.", all_bots.len()));
    }

    // Check own admin rights
    let (own_is_admin, own_can_get_participants) =
        check_own_permissions(&client, &peer_ref).await;

    let (from_ts, to_ts, period_from_str, period_to_str) =
        cache::compute_window(months, date_from, date_to)?;
    let fmt = |ts: i64| cache::ts_to_dt(ts).format("%Y-%m-%d %H:%M").to_string();
    let _ = app.emit(
        "log",
        format!("Analyse für {} | Zeitraum: {} bis {}", label, fmt(from_ts), fmt(to_ts)),
    );

    let cached = if force_full {
        let _ = app.emit("log", "Komplett neu einlesen: gespeicherte Daten werden ersetzt.".to_string());
        None
    } else {
        cache::load(chat_info.id).filter(|c| c.include_reactions || !include_reactions)
    };

    let mut c = match cached {
        Some(mut c) => {
            let _ = app.emit(
                "log",
                format!(
                    "Gespeicherte Daten gefunden: {} bis {} ({} Aktivitäten).",
                    fmt(c.from_ts),
                    fmt(c.to_ts),
                    c.events.len()
                ),
            );
            // Older history missing?
            if from_ts < c.from_ts {
                let _ = app.emit("log", "Lade ältere Nachrichten nach…".to_string());
                let known = c.user_ids();
                let res = scan_window(&client, &peer_ref, from_ts, c.from_ts - 1, c.include_reactions, &known, &app).await?;
                let new_from = if res.complete { from_ts } else { res.oldest_ts.unwrap_or(c.from_ts) };
                c.merge(res.part);
                c.from_ts = new_from.min(c.from_ts);
            }
            // New messages since the last scan?
            if to_ts > c.to_ts + 60 {
                let _ = app.emit("log", "Lade neue Nachrichten seit dem letzten Stand…".to_string());
                let known = c.user_ids();
                let res = scan_window(&client, &peer_ref, c.to_ts + 1, to_ts, c.include_reactions, &known, &app).await?;
                if res.complete {
                    c.merge(res.part);
                    c.to_ts = to_ts;
                } else {
                    let _ = app.emit(
                        "log",
                        "Warnung: Neue Nachrichten konnten nicht vollständig geladen werden. Es werden die gespeicherten Daten angezeigt.".to_string(),
                    );
                }
            }
            if from_ts >= c.from_ts && to_ts <= c.to_ts + 60 {
                let _ = app.emit("log", "Keine weiteren Nachrichten nötig, Ergebnis aus gespeicherten Daten.".to_string());
            }
            c
        }
        None => {
            let res = scan_window(&client, &peer_ref, from_ts, to_ts, include_reactions, &HashSet::new(), &app).await?;
            let start = if res.complete { from_ts } else { res.oldest_ts.unwrap_or(to_ts) };
            let mut c = cache::ChatCache::new(chat_info.clone(), include_reactions, start, to_ts);
            c.merge(res.part);
            c
        }
    };

    c.chat = chat_info;
    c.all_bots = all_bots;
    c.own_is_admin = own_is_admin;
    c.own_can_get_participants = own_can_get_participants;
    c.updated_at = Utc::now().timestamp();
    if let Err(e) = cache::save(&c) {
        let _ = app.emit("log", format!("Warnung: Daten konnten nicht gespeichert werden: {}", e));
    }

    // ── Joined date for members active in the window (only once per user) ────
    let need: Vec<i64> = {
        let active: HashSet<i64> = c
            .events
            .iter()
            .filter(|e| e.ts >= from_ts && e.ts <= to_ts && (e.kind == "message" || e.kind == "reaction"))
            .map(|e| e.user_id)
            .collect();
        active
            .into_iter()
            .filter(|uid| c.users.get(uid).map_or(false, |u| !u.joined_checked))
            .collect()
    };
    if !need.is_empty() {
        let joined = fetch_joined_dates(&client, &peer_ref, &need, &app).await?;
        for uid in &need {
            if let Some(u) = c.users.get_mut(uid) {
                u.joined_checked = true;
                if let Some(d) = joined.get(uid) {
                    u.joined_date = Some(*d);
                }
            }
        }
        if let Err(e) = cache::save(&c) {
            let _ = app.emit("log", format!("Warnung: Daten konnten nicht gespeichert werden: {}", e));
        }
    }

    Ok(cache::derive(&c, from_ts, to_ts, months, period_from_str, period_to_str, include_reactions))
}

/// Derive a result purely from the disk cache, without contacting Telegram.
/// Returns None if no cache exists or the requested window starts before the
/// cached data (or needs reactions the cache does not have).
pub fn analysis_from_cache(
    chat_id: i64,
    months: i32,
    include_reactions: bool,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Option<AnalysisResult>, AnalysisError> {
    let Some(c) = cache::load(chat_id) else { return Ok(None) };
    if include_reactions && !c.include_reactions {
        return Ok(None);
    }
    let (from_ts, to_ts, pf, pt) = cache::compute_window(months, date_from, date_to)?;
    if from_ts < c.from_ts {
        return Ok(None);
    }
    Ok(Some(cache::derive(&c, from_ts, to_ts, months, pf, pt, include_reactions)))
}

pub fn cache_status(chat_id: i64) -> Option<cache::CacheStatus> {
    cache::load(chat_id).map(|c| c.status())
}

struct ScanResult {
    part: cache::ScanPart,
    oldest_ts: Option<i64>,
    complete: bool,
}

/// Scan all messages in [from_ts, to_ts] (newest first) and collect raw activity.
async fn scan_window(
    client: &grammers_client::Client,
    peer_ref: &PeerRef,
    from_ts: i64,
    to_ts: i64,
    include_reactions: bool,
    known_users: &HashSet<i64>,
    app: &tauri::AppHandle,
) -> Result<ScanResult, AnalysisError> {
    let from = cache::ts_to_dt(from_ts);
    let to = cache::ts_to_dt(to_ts);
    let _ = app.emit(
        "log",
        format!(
            "Scanne Nachrichten von {} bis {}",
            from.format("%Y-%m-%d %H:%M"),
            to.format("%Y-%m-%d %H:%M")
        ),
    );

    let mut events: Vec<ActivityEvent> = Vec::new();
    let mut polls: Vec<PollRecord> = Vec::new();
    let mut users: HashMap<i64, (String, Option<String>)> = HashMap::new();
    let mut total_polls: u32 = 0;
    let mut total_quizzes: u32 = 0;
    let mut unsupported_media_count: u32 = 0;
    let mut scanned: u32 = 0;
    let mut oldest_ts: Option<i64> = None;
    let mut complete = true;

    let mut msg_iter = client
        .iter_messages(peer_ref.clone())
        .max_date(to_ts as i32 + 1);

    loop {
        if CANCEL.load(Ordering::Relaxed) {
            CANCEL.store(false, Ordering::Relaxed);
            let _ = app.emit("log", "Analyse abgebrochen.".to_string());
            return Err(AnalysisError::Cancelled);
        }
        match msg_iter.next().await {
            Ok(Some(msg)) => {
                if msg.date() < from {
                    break;
                }
                if msg.date() > to {
                    continue;
                }
                scanned += 1;
                let msg_ts = msg.date().timestamp();
                oldest_ts = Some(msg_ts);

                if scanned % 100 == 0 {
                    let _ = app.emit("message_count", scanned);
                }
                if scanned % 500 == 0 {
                    let _ = app.emit("progress", scanned);
                    let _ = app.emit("log", format!("Bisher {} Nachrichten gescannt…", scanned));
                }

                if let Some(sender_id) = msg.sender_id() {
                    // Only count actual user messages, not channel-signed posts
                    if matches!(sender_id.kind(), PeerKind::User) {
                        let Some(uid) = sender_id.bare_id() else { continue };
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
                        users.entry(uid).or_insert((name, username));
                        events.push(ActivityEvent { user_id: uid, ts: msg_ts, kind: "message".into() });

                        // Fetch per-message reactions
                        if include_reactions {
                            let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
                            if let Ok(raw) = fetch_reactions(client, input_peer, msg.id()).await {
                                // Count reactions whose author is a known member
                                for reaction_peer in raw {
                                    if let tl::enums::Peer::User(u) = reaction_peer {
                                        let r = u.user_id;
                                        if users.contains_key(&r) || known_users.contains(&r) {
                                            events.push(ActivityEvent { user_id: r, ts: msg_ts, kind: "reaction".into() });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                // Umfragen / Quizze erfassen und Teilnahmen zuordnen
                if let tl::enums::Message::Message(raw_msg) = &msg.raw {
                    if matches!(&raw_msg.media, Some(tl::enums::MessageMedia::Unsupported)) {
                        unsupported_media_count += 1;
                    }

                    if let Some(tl::enums::MessageMedia::Poll(poll_media)) = &raw_msg.media {
                        let (is_quiz, answers) = match &poll_media.poll {
                            tl::enums::Poll::Poll(p) => (p.quiz, p.answers.clone()),
                        };

                        if is_quiz {
                            total_quizzes += 1;
                            // Quiz: alle Voter mit option=None abrufen
                            let mut voters = 0u32;
                            let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
                            if let Ok((voter_ids, voter_names)) =
                                fetch_poll_votes(client, input_peer, msg.id(), None).await
                            {
                                let unique: HashSet<i64> = voter_ids.into_iter().collect();
                                voters = unique.len() as u32;
                                for uid in &unique {
                                    users.entry(*uid).or_insert_with(|| {
                                        voter_names
                                            .get(uid)
                                            .cloned()
                                            .unwrap_or_else(|| (format!("ID {}", uid), None))
                                    });
                                    events.push(ActivityEvent { user_id: *uid, ts: msg_ts, kind: "quiz".into() });
                                }
                            }
                            polls.push(PollRecord { ts: msg_ts, is_quiz: true, voters });
                        } else {
                            total_polls += 1;
                            // Echte Umfrage: pro Antwortoption Voter abrufen und in einem
                            // gemeinsamen Set deduplizieren (Multi-Choice).
                            let mut poll_voters: HashSet<i64> = HashSet::new();
                            let mut all_voter_names: HashMap<i64, (String, Option<String>)> =
                                HashMap::new();
                            for answer in &answers {
                                let opt_bytes = match answer {
                                    tl::enums::PollAnswer::Answer(a) => a.option.clone(),
                                    tl::enums::PollAnswer::InputPollAnswer(_) => continue,
                                };
                                let input_peer = tl::enums::InputPeer::from(peer_ref.clone());
                                if let Ok((ids, names)) =
                                    fetch_poll_votes(client, input_peer, msg.id(), Some(opt_bytes))
                                        .await
                                {
                                    poll_voters.extend(ids);
                                    all_voter_names.extend(names);
                                }
                            }
                            for uid in &poll_voters {
                                users.entry(*uid).or_insert_with(|| {
                                    all_voter_names
                                        .get(uid)
                                        .cloned()
                                        .unwrap_or_else(|| (format!("ID {}", uid), None))
                                });
                                events.push(ActivityEvent { user_id: *uid, ts: msg_ts, kind: "poll".into() });
                            }
                            polls.push(PollRecord { ts: msg_ts, is_quiz: false, voters: poll_voters.len() as u32 });
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                // A transient API error (e.g. rate limiting) on a long scan should not
                // discard everything gathered so far.
                if scanned == 0 {
                    return Err(AnalysisError::Telegram(e.to_string()));
                }
                let _ = app.emit(
                    "log",
                    format!(
                        "Warnung: Scan nach {} Nachrichten mit Fehler abgebrochen ({}). Der Zeitraum ist ggf. unvollständig.",
                        scanned, e
                    ),
                );
                complete = false;
                break;
            }
        }
    }

    let _ = app.emit("log", format!("Fertig. {} Nachrichten gescannt.", scanned));
    if total_polls + total_quizzes > 0 {
        let _ = app.emit(
            "log",
            format!("Umfragen: {} | Quizze: {}", total_polls, total_quizzes),
        );
    }
    if unsupported_media_count > 0 {
        let _ = app.emit(
            "log",
            format!(
                "⚠ {} Nachricht(en) mit unbekanntem Medienformat erkannt (möglicherweise Umfragen \
                 mit Bild/Link). Diese konnten nicht ausgewertet werden. \
                 Bitte die grammers-Bibliothek aktualisieren.",
                unsupported_media_count
            ),
        );
    }
    let _ = app.emit("progress", scanned);

    Ok(ScanResult {
        part: cache::ScanPart { events, polls, users },
        oldest_ts,
        complete,
    })
}

/// Fetch the join date of the given users via individual GetParticipant calls.
async fn fetch_joined_dates(
    client: &grammers_client::Client,
    peer_ref: &PeerRef,
    user_ids: &[i64],
    app: &tauri::AppHandle,
) -> Result<HashMap<i64, i64>, AnalysisError> {
    let mut out = HashMap::new();
    let input_channel = match tl::enums::InputPeer::from(peer_ref.clone()) {
        tl::enums::InputPeer::Channel(c) => {
            tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id: c.channel_id,
                access_hash: c.access_hash,
            })
        }
        _ => return Ok(out),
    };

    let _ = app.emit(
        "log",
        format!("Hole Beitrittsdaten für {} Mitglieder…", user_ids.len()),
    );

    for (count, &user_id) in user_ids.iter().enumerate() {
        if CANCEL.load(Ordering::Relaxed) {
            CANCEL.store(false, Ordering::Relaxed);
            let _ = app.emit("log", "Analyse abgebrochen.".to_string());
            return Err(AnalysisError::Cancelled);
        }
        let user_ref = PeerRef {
            id: PeerId::user_unchecked(user_id),
            auth: PeerAuth::default(),
        };
        if let Ok(peer) = client.resolve_peer(user_ref).await {
            if let Some(pr) = peer.to_ref().await {
                let user_input_peer = tl::enums::InputPeer::from(pr);
                if let Ok(tl::enums::channels::ChannelParticipant::Participant(cp)) = client
                    .invoke(&tl::functions::channels::GetParticipant {
                        channel: input_channel.clone(),
                        participant: user_input_peer,
                    })
                    .await
                {
                    let date = match &cp.participant {
                        tl::enums::ChannelParticipant::Participant(p) => Some(p.date as i64),
                        tl::enums::ChannelParticipant::Admin(a) => Some(a.date as i64),
                        tl::enums::ChannelParticipant::ParticipantSelf(p) => Some(p.date as i64),
                        _ => None,
                    };
                    if let Some(d) = date {
                        out.insert(user_id, d);
                    }
                }
            }
        }
        if (count + 1) % 20 == 0 {
            let _ = app.emit(
                "log",
                format!("Beitrittsdaten: {}/{} geholt…", count + 1, user_ids.len()),
            );
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let _ = app.emit("log", "Beitrittsdaten vollständig.".to_string());
    Ok(out)
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

/// Fetch all user IDs (and their names) who voted for a specific poll option
/// (or all options when `option` is None).  Errors are silently ignored by the caller.
/// Returns `(voter_ids, name_map)` where `name_map` maps each user_id to
/// `(display_name, username)` using the user data included in the API response.
async fn fetch_poll_votes(
    client: &grammers_client::Client,
    input_peer: tl::enums::InputPeer,
    msg_id: i32,
    option: Option<Vec<u8>>,
) -> Result<(Vec<i64>, HashMap<i64, (String, Option<String>)>), InvocationError> {
    let mut voter_ids = Vec::new();
    let mut voter_names: HashMap<i64, (String, Option<String>)> = HashMap::new();
    let mut offset: Option<String> = None;

    loop {
        let result = client
            .invoke(&tl::functions::messages::GetPollVotes {
                peer: input_peer.clone(),
                id: msg_id,
                option: option.clone(),
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

        // Collect display name + username from the user objects in this page
        for user in list.users {
            if let tl::enums::User::User(u) = user {
                let name = match (
                    u.first_name.as_deref().filter(|s| !s.is_empty()),
                    u.last_name.as_deref().filter(|s| !s.is_empty()),
                ) {
                    (Some(f), Some(l)) => format!("{} {}", f, l),
                    (Some(f), None) => f.to_string(),
                    (None, Some(l)) => l.to_string(),
                    (None, None) => format!("ID {}", u.id),
                };
                voter_names.insert(u.id, (name, u.username));
            }
        }

        match list.next_offset {
            Some(next) => offset = Some(next),
            None => break,
        }
    }

    Ok((voter_ids, voter_names))
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


// ── Single-user online status (on-demand, e.g. after filtering by name) ───────

/// Fetches a single user's current Telegram status ("last seen"). Called
/// on-demand per member (e.g. on click in the filtered results table) -
/// deliberately NOT batched over all members, to avoid the rate-limit risk
/// a per-member call for potentially thousands of members would bring.
pub async fn fetch_user_status(user_id: i64) -> Result<UserOnlineStatus, AnalysisError> {
    let client = super::auth::get_client()
        .await
        .ok_or(AnalysisError::NotAuthorized)?;

    let user_ref = PeerRef {
        id: PeerId::user_unchecked(user_id),
        auth: PeerAuth::default(),
    };
    let peer = client
        .resolve_peer(user_ref)
        .await
        .map_err(|e| AnalysisError::Telegram(e.to_string()))?;
    let pr = peer
        .to_ref()
        .await
        .ok_or_else(|| AnalysisError::Telegram("Could not obtain peer reference".into()))?;

    let input_user = match tl::enums::InputPeer::from(pr) {
        tl::enums::InputPeer::User(u) => tl::enums::InputUser::User(tl::types::InputUser {
            user_id: u.user_id,
            access_hash: u.access_hash,
        }),
        _ => return Err(AnalysisError::Telegram("Kein Benutzer-Peer".into())),
    };

    let users = client
        .invoke(&tl::functions::users::GetUsers {
            id: vec![input_user],
        })
        .await
        .map_err(|e| AnalysisError::Telegram(e.to_string()))?;

    let Some(tl::enums::User::User(u)) = users.into_iter().next() else {
        return Err(AnalysisError::Telegram("Nutzer nicht gefunden".into()));
    };

    let (kind, was_online) = match u.status {
        Some(tl::enums::UserStatus::Online(_)) => ("online".to_string(), None),
        Some(tl::enums::UserStatus::Offline(s)) => {
            ("offline".to_string(), Some(s.was_online as i64))
        }
        Some(tl::enums::UserStatus::Recently(_)) => ("recently".to_string(), None),
        Some(tl::enums::UserStatus::LastWeek(_)) => ("last_week".to_string(), None),
        Some(tl::enums::UserStatus::LastMonth(_)) => ("last_month".to_string(), None),
        _ => ("unknown".to_string(), None),
    };

    Ok(UserOnlineStatus { kind, was_online })
}
