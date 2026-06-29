use chrono::{DateTime, NaiveDate, Utc};
use grammers_client::{tl, Client};
use grammers_session::types::{PeerAuth, PeerId, PeerRef};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
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

#[derive(serde::Serialize)]
pub struct JoinLeaveEvent {
    pub event_type: String, // "added" | "joined" | "left" | "removed"
    pub date: String,       // ISO 8601
    pub time: String,       // HH:MM:SS UTC
    pub affected_user: String,
    pub affected_user_id: Option<i64>,
    pub affected_username: Option<String>,
    pub actor: Option<String>,
    pub actor_user_id: Option<i64>,
    pub chat_id: i64,
    pub message_id: i32,
}

#[derive(serde::Serialize)]
pub struct JoinLeaveSearchResult {
    pub events: Vec<JoinLeaveEvent>,
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

pub async fn find_join_leave_events(
    client: &Client,
    chat_id: i64,
    user_id: Option<i64>,
    username: Option<String>,
    display_name: Option<String>,
    event_types: Vec<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    app: &tauri::AppHandle,
) -> Result<JoinLeaveSearchResult, String> {
    CANCEL.store(false, Ordering::Relaxed);

    let started_at = Instant::now();
    let filters: HashSet<String> = event_types.into_iter().collect();
    let from_dt = parse_search_date(date_from.as_deref(), false)?;
    let to_dt = parse_search_date(date_to.as_deref(), true)?;
    let mut target_user_id = user_id;
    let mut target_username = username
        .map(|s| s.trim().trim_start_matches('@').to_lowercase())
        .filter(|s| !s.is_empty());
    let target_display_name = display_name
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    if target_user_id.is_none() {
        if let Some(un) = &target_username {
            if let Some(peer) = client
                .resolve_username(un)
                .await
                .map_err(|e| e.to_string())?
            {
                if let grammers_client::peer::Peer::User(user) = peer {
                    target_user_id = user.id().bare_id();
                    target_username = user
                        .username()
                        .map(|s| s.to_lowercase())
                        .or(target_username);
                }
            }
        }
    }

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

    let _ = app.emit("log", "Starte Ein-/Austritt-Suche…".to_string());
    let _ = app.emit(
        "log",
        format!("Zeitraum: {}.", format_date_range(from_dt, to_dt)),
    );

    match find_join_leave_events_admin_log(
        client,
        chat_id,
        &filters,
        target_user_id,
        target_username.as_deref(),
        target_display_name.as_deref(),
        from_dt,
        to_dt,
        app,
    )
    .await
    {
        Ok(result) if !result.events.is_empty() => {
            let _ = app.emit(
                "log",
                format!(
                    "Ein-/Austritt-Suche abgeschlossen. {} Treffer gefunden. Dauer: {}.",
                    result.events.len(),
                    format_elapsed(started_at)
                ),
            );
            return Ok(result);
        }
        Ok(_) => {
            let _ = app.emit(
                "log",
                "Keine Treffer im Admin-Log. Suche in Chat-Historie…".to_string(),
            );
        }
        Err(e) if e.contains("Abgebrochen") => {
            let _ = app.emit(
                "log",
                format!("Ein-/Austritt-Suche abgebrochen. Dauer: {}.", format_elapsed(started_at)),
            );
            return Err(e);
        }
        Err(e) => {
            let _ = app.emit(
                "log",
                format!("Admin-Log nicht verfügbar ({}). Suche in Chat-Historie…", e),
            );
        }
    }

    let mut events = Vec::new();
    let mut scanned: u32 = 0;
    let mut service_scanned: u32 = 0;
    let mut msg_iter = client.iter_messages(peer_ref);

    loop {
        if CANCEL.load(Ordering::Relaxed) {
            CANCEL.store(false, Ordering::Relaxed);
            let _ = app.emit(
                "log",
                format!("Ein-/Austritt-Suche abgebrochen. Dauer: {}.", format_elapsed(started_at)),
            );
            return Err("Abgebrochen".into());
        }

        match msg_iter.next().await {
            Ok(Some(msg)) => {
                scanned += 1;
                let msg_date = msg.date();
                if let Some(from) = from_dt {
                    if msg_date < from {
                        let _ = app.emit(
                            "log",
                            format!(
                                "Datumsgrenze erreicht: {} Historieneinträge geprüft, davon {} Service-Messages.",
                                scanned,
                                service_scanned
                            ),
                        );
                        break;
                    }
                }
                if let Some(to) = to_dt {
                    if msg_date > to {
                        continue;
                    }
                }
                if scanned % 500 == 0 {
                    let _ = app.emit(
                        "log",
                        format!(
                            "Ein-/Austritt-Suche: {} Historieneinträge geprüft, aktuelles Datum: {}…",
                            scanned,
                            msg_date.format("%Y-%m-%d")
                        ),
                    );
                }

                let service = match &msg.raw {
                    tl::enums::Message::Service(service) => {
                        service_scanned += 1;
                        service
                    }
                    _ => continue,
                };

                match &service.action {
                    tl::enums::MessageAction::ChatAddUser(action) => {
                        if !filters.contains("added") {
                            continue;
                        }
                        for affected_id in &action.users {
                            if !target_matches(
                                Some(*affected_id),
                                None,
                                None,
                                target_user_id,
                                target_username.as_deref(),
                                target_display_name.as_deref(),
                            ) {
                                continue;
                            }
                            events.push(build_join_leave_event(
                                "added",
                                &msg,
                                chat_id,
                                Some(*affected_id),
                                None,
                                None,
                                affected_label(
                                    *affected_id,
                                    target_username.as_deref(),
                                    target_display_name.as_deref(),
                                ),
                                cached_sender_label(&msg),
                                service_sender_user_id(service),
                            ));
                        }
                    }
                    tl::enums::MessageAction::ChatJoinedByLink(action) => {
                        if !filters.contains("joined") {
                            continue;
                        }
                        let affected_id = service_sender_user_id(service);
                        let (sender_name, sender_username) = sender_details(&msg);
                        if !target_matches(
                            affected_id,
                            sender_username.as_deref(),
                            sender_name.as_deref(),
                            target_user_id,
                            target_username.as_deref(),
                            target_display_name.as_deref(),
                        ) {
                            continue;
                        }
                        events.push(build_join_leave_event(
                            "joined",
                            &msg,
                            chat_id,
                            affected_id,
                            sender_username,
                            sender_name.clone(),
                            sender_name.unwrap_or_else(|| {
                                affected_id
                                    .map(|id| format!("User {}", id))
                                    .unwrap_or_else(|| "Unbekannt".to_string())
                            }),
                            Some(format!("User {}", action.inviter_id)),
                            Some(action.inviter_id),
                        ));
                    }
                    tl::enums::MessageAction::ChatJoinedByRequest => {
                        if !filters.contains("joined") {
                            continue;
                        }
                        let affected_id = service_sender_user_id(service);
                        let (sender_name, sender_username) = sender_details(&msg);
                        if !target_matches(
                            affected_id,
                            sender_username.as_deref(),
                            sender_name.as_deref(),
                            target_user_id,
                            target_username.as_deref(),
                            target_display_name.as_deref(),
                        ) {
                            continue;
                        }
                        events.push(build_join_leave_event(
                            "joined",
                            &msg,
                            chat_id,
                            affected_id,
                            sender_username,
                            sender_name.clone(),
                            sender_name.unwrap_or_else(|| {
                                affected_id
                                    .map(|id| format!("User {}", id))
                                    .unwrap_or_else(|| "Unbekannt".to_string())
                            }),
                            None,
                            None,
                        ));
                    }
                    tl::enums::MessageAction::ChatDeleteUser(action) => {
                        let actor_id = service_sender_user_id(service);
                        let event_type = if actor_id == Some(action.user_id) {
                            "left"
                        } else {
                            "removed"
                        };
                        if !filters.contains(event_type) {
                            continue;
                        }
                        if !target_matches(
                            Some(action.user_id),
                            None,
                            None,
                            target_user_id,
                            target_username.as_deref(),
                            target_display_name.as_deref(),
                        ) {
                            continue;
                        }
                        events.push(build_join_leave_event(
                            event_type,
                            &msg,
                            chat_id,
                            Some(action.user_id),
                            None,
                            None,
                            affected_label(
                                action.user_id,
                                target_username.as_deref(),
                                target_display_name.as_deref(),
                            ),
                            cached_sender_label(&msg),
                            actor_id,
                        ));
                    }
                    _ => {}
                }
            }
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }

    let _ = app.emit(
        "log",
        format!(
            "Ein-/Austritt-Suche abgeschlossen. {} Historieneinträge geprüft, davon {} Service-Messages, {} Treffer gefunden. Dauer: {}.",
            scanned,
            service_scanned,
            events.len(),
            format_elapsed(started_at)
        ),
    );

    Ok(JoinLeaveSearchResult { events })
}

async fn find_join_leave_events_admin_log(
    client: &Client,
    chat_id: i64,
    filters: &HashSet<String>,
    target_user_id: Option<i64>,
    target_username: Option<&str>,
    target_display_name: Option<&str>,
    from_dt: Option<DateTime<Utc>>,
    to_dt: Option<DateTime<Utc>>,
    app: &tauri::AppHandle,
) -> Result<JoinLeaveSearchResult, String> {
    let input_channel = resolve_input_channel(client, chat_id).await?;
    let _ = app.emit(
        "log",
        "Prüfe Ein-/Austritt-Ereignisse über Telegram-Admin-Log…".to_string(),
    );

    let mut max_id = 0i64;
    let mut scanned = 0u32;
    let mut events = Vec::new();

    loop {
        if CANCEL.load(Ordering::Relaxed) {
            CANCEL.store(false, Ordering::Relaxed);
            return Err("Abgebrochen".into());
        }

        let result = client
            .invoke(&tl::functions::channels::GetAdminLog {
                channel: input_channel.clone(),
                q: String::new(),
                events_filter: None,
                admins: None,
                max_id,
                min_id: 0,
                limit: 100,
            })
            .await
            .map_err(|e| e.to_string())?;

        let data = match result {
            tl::enums::channels::AdminLogResults::Results(data) => data,
        };
        if data.events.is_empty() {
            break;
        }

        let batch_len = data.events.len();
        let users = admin_log_user_map(&data.users);
        let mut last_id = max_id;
        let mut reached_from_date = false;

        for raw_event in &data.events {
            if CANCEL.load(Ordering::Relaxed) {
                CANCEL.store(false, Ordering::Relaxed);
                return Err("Abgebrochen".into());
            }

            let event = match raw_event {
                tl::enums::ChannelAdminLogEvent::Event(event) => event,
            };

            scanned += 1;
            last_id = event.id;

            let Some(event_dt) = DateTime::from_timestamp(event.date as i64, 0) else {
                continue;
            };
            if let Some(from) = from_dt {
                if event_dt < from {
                    reached_from_date = true;
                    break;
                }
            }
            if let Some(to) = to_dt {
                if event_dt > to {
                    continue;
                }
            }
            if scanned % 500 == 0 {
                let _ = app.emit(
                    "log",
                    format!(
                        "Ein-/Austritt-Suche: {} Admin-Log-Ereignisse geprüft, aktuelles Datum: {}…",
                        scanned,
                        event_dt.format("%Y-%m-%d")
                    ),
                );
            }

            if let Some(join_leave_event) = admin_log_join_leave_event(
                event,
                event_dt,
                chat_id,
                &users,
                filters,
                target_user_id,
                target_username,
                target_display_name,
            ) {
                events.push(join_leave_event);
            }
        }

        if reached_from_date || batch_len < 100 || last_id == max_id {
            if reached_from_date {
                let _ = app.emit(
                    "log",
                    format!(
                        "Datumsgrenze im Admin-Log erreicht: {} Ereignisse geprüft.",
                        scanned
                    ),
                );
            }
            break;
        }
        max_id = last_id;
    }

    if scanned == 0 {
        return Err("keine Admin-Log-Ereignisse geliefert".to_string());
    }

    Ok(JoinLeaveSearchResult { events })
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
    let _ = app.emit("log", format!("Starte Nachrichtensuche für @{}…", username));

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

fn parse_search_date(
    value: Option<&str>,
    end_of_day: bool,
) -> Result<Option<DateTime<Utc>>, String> {
    let Some(value) = value.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| format!("Ungültiges Datum: {}", value))?;
    let time = if end_of_day {
        date.and_hms_opt(23, 59, 59)
    } else {
        date.and_hms_opt(0, 0, 0)
    }
    .ok_or_else(|| format!("Ungültiges Datum: {}", value))?;
    Ok(Some(time.and_utc()))
}

fn format_elapsed(started_at: Instant) -> String {
    let elapsed = started_at.elapsed();
    let total_seconds = elapsed.as_secs();
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    if minutes > 0 {
        format!("{}m {}s", minutes, seconds)
    } else {
        format!("{:.1}s", elapsed.as_secs_f32())
    }
}

fn format_date_range(from_dt: Option<DateTime<Utc>>, to_dt: Option<DateTime<Utc>>) -> String {
    let from = from_dt
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "kein Zurück-bis-Datum".to_string());
    let to = to_dt
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "Heute".to_string());
    format!("{} bis {}", from, to)
}

fn target_matches(
    candidate_user_id: Option<i64>,
    candidate_username: Option<&str>,
    candidate_display_name: Option<&str>,
    target_user_id: Option<i64>,
    target_username: Option<&str>,
    target_display_name: Option<&str>,
) -> bool {
    if let Some(target_id) = target_user_id {
        return candidate_user_id == Some(target_id);
    }
    if let Some(target_un) = target_username {
        if candidate_username
            .map(|un| un.trim_start_matches('@').eq_ignore_ascii_case(target_un))
            .unwrap_or(false)
        {
            return true;
        }
    }
    if let Some(target_name) = target_display_name {
        return candidate_display_name
            .map(|name| name.trim().eq_ignore_ascii_case(target_name))
            .unwrap_or(false);
    }
    false
}

fn service_sender_user_id(service: &tl::types::MessageService) -> Option<i64> {
    service.from_id.as_ref().and_then(peer_user_id)
}

fn peer_user_id(peer: &tl::enums::Peer) -> Option<i64> {
    match peer {
        tl::enums::Peer::User(user) => Some(user.user_id),
        _ => None,
    }
}

fn channel_participant_user_id(participant: &tl::enums::ChannelParticipant) -> Option<i64> {
    match participant {
        tl::enums::ChannelParticipant::Participant(p) => Some(p.user_id),
        tl::enums::ChannelParticipant::ParticipantSelf(p) => Some(p.user_id),
        tl::enums::ChannelParticipant::Creator(p) => Some(p.user_id),
        tl::enums::ChannelParticipant::Admin(p) => Some(p.user_id),
        tl::enums::ChannelParticipant::Banned(p) => peer_user_id(&p.peer),
        tl::enums::ChannelParticipant::Left(p) => peer_user_id(&p.peer),
    }
}

fn channel_participant_kicked_by(participant: &tl::enums::ChannelParticipant) -> Option<i64> {
    match participant {
        tl::enums::ChannelParticipant::Banned(p) => Some(p.kicked_by),
        _ => None,
    }
}

fn channel_participant_is_removed(participant: &tl::enums::ChannelParticipant) -> bool {
    matches!(
        participant,
        tl::enums::ChannelParticipant::Banned(_) | tl::enums::ChannelParticipant::Left(_)
    )
}

fn admin_log_user_map(users: &[tl::enums::User]) -> HashMap<i64, (String, Option<String>)> {
    users
        .iter()
        .filter_map(|user| match user {
            tl::enums::User::User(user) => Some((
                user.id,
                (
                    build_display_name(
                        user.first_name.as_deref(),
                        user.last_name.as_deref(),
                        user.id,
                    ),
                    user.username.clone(),
                ),
            )),
            tl::enums::User::Empty(_) => None,
        })
        .collect()
}

fn admin_log_user_details(
    user_id: i64,
    users: &HashMap<i64, (String, Option<String>)>,
    target_username: Option<&str>,
    target_display_name: Option<&str>,
) -> (String, Option<String>) {
    users.get(&user_id).cloned().unwrap_or_else(|| {
        (
            affected_label(user_id, target_username, target_display_name),
            target_username.map(|s| s.to_string()),
        )
    })
}

fn admin_log_user_label(user_id: i64, users: &HashMap<i64, (String, Option<String>)>) -> String {
    users
        .get(&user_id)
        .map(|(name, username)| {
            username
                .as_ref()
                .map(|un| format!("@{}", un))
                .unwrap_or_else(|| name.clone())
        })
        .unwrap_or_else(|| format!("User {}", user_id))
}

fn admin_log_join_leave_event(
    event: &tl::types::ChannelAdminLogEvent,
    event_dt: DateTime<Utc>,
    chat_id: i64,
    users: &HashMap<i64, (String, Option<String>)>,
    filters: &HashSet<String>,
    target_user_id: Option<i64>,
    target_username: Option<&str>,
    target_display_name: Option<&str>,
) -> Option<JoinLeaveEvent> {
    let (event_type, affected_user_id, actor_user_id) = match &event.action {
        tl::enums::ChannelAdminLogEventAction::ParticipantInvite(action) => (
            "added",
            channel_participant_user_id(&action.participant)?,
            Some(event.user_id),
        ),
        tl::enums::ChannelAdminLogEventAction::ParticipantJoin => {
            ("joined", event.user_id, Some(event.user_id))
        }
        tl::enums::ChannelAdminLogEventAction::ParticipantJoinByInvite(_) => {
            ("joined", event.user_id, Some(event.user_id))
        }
        tl::enums::ChannelAdminLogEventAction::ParticipantJoinByRequest(action) => {
            ("joined", event.user_id, Some(action.approved_by))
        }
        tl::enums::ChannelAdminLogEventAction::ParticipantLeave => {
            ("left", event.user_id, Some(event.user_id))
        }
        tl::enums::ChannelAdminLogEventAction::ParticipantToggleBan(action) => {
            if !channel_participant_is_removed(&action.new_participant) {
                return None;
            }
            (
                "removed",
                channel_participant_user_id(&action.new_participant)
                    .or_else(|| channel_participant_user_id(&action.prev_participant))?,
                channel_participant_kicked_by(&action.new_participant).or(Some(event.user_id)),
            )
        }
        _ => return None,
    };

    if !filters.contains(event_type) {
        return None;
    }

    let (affected_user, affected_username) = admin_log_user_details(
        affected_user_id,
        users,
        target_username,
        target_display_name,
    );

    if !target_matches(
        Some(affected_user_id),
        affected_username.as_deref(),
        Some(&affected_user),
        target_user_id,
        target_username,
        target_display_name,
    ) {
        return None;
    }

    let actor = actor_user_id.map(|id| admin_log_user_label(id, users));

    Some(build_join_leave_event_from_parts(
        event_type,
        event_dt,
        chat_id,
        admin_log_message_id(event.id),
        Some(affected_user_id),
        affected_username,
        affected_user,
        actor,
        actor_user_id,
    ))
}

fn sender_details(msg: &grammers_client::message::Message) -> (Option<String>, Option<String>) {
    match msg.sender() {
        Some(grammers_client::peer::Peer::User(user)) => {
            let name = user.full_name();
            (
                (!name.trim().is_empty()).then_some(name),
                user.username().map(|s| s.to_string()),
            )
        }
        Some(peer) => (peer.name().map(|s| s.to_string()), None),
        None => (None, None),
    }
}

fn cached_sender_label(msg: &grammers_client::message::Message) -> Option<String> {
    let (name, username) = sender_details(msg);
    name.or_else(|| username.map(|un| format!("@{}", un)))
}

fn affected_label(
    user_id: i64,
    target_username: Option<&str>,
    target_display_name: Option<&str>,
) -> String {
    target_display_name
        .map(|s| s.to_string())
        .or_else(|| target_username.map(|s| format!("@{}", s)))
        .unwrap_or_else(|| format!("User {}", user_id))
}

fn build_join_leave_event(
    event_type: &str,
    msg: &grammers_client::message::Message,
    chat_id: i64,
    affected_user_id: Option<i64>,
    affected_username: Option<String>,
    affected_name: Option<String>,
    affected_fallback: String,
    actor: Option<String>,
    actor_user_id: Option<i64>,
) -> JoinLeaveEvent {
    let dt = msg.date();
    build_join_leave_event_from_parts(
        event_type,
        dt,
        chat_id,
        msg.id(),
        affected_user_id,
        affected_username,
        affected_name.unwrap_or(affected_fallback),
        actor,
        actor_user_id,
    )
}

fn build_join_leave_event_from_parts(
    event_type: &str,
    dt: DateTime<Utc>,
    chat_id: i64,
    message_id: i32,
    affected_user_id: Option<i64>,
    affected_username: Option<String>,
    affected_user: String,
    actor: Option<String>,
    actor_user_id: Option<i64>,
) -> JoinLeaveEvent {
    JoinLeaveEvent {
        event_type: event_type.to_string(),
        date: dt.to_rfc3339(),
        time: dt.format("%H:%M:%S").to_string(),
        affected_user,
        affected_user_id,
        affected_username,
        actor,
        actor_user_id,
        chat_id,
        message_id,
    }
}

fn admin_log_message_id(event_id: i64) -> i32 {
    event_id.clamp(i32::MIN as i64, i32::MAX as i64) as i32
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
        tl::enums::InputPeer::Channel(c) => {
            Ok(tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id: c.channel_id,
                access_hash: c.access_hash,
            }))
        }
        _ => Err("Mitgliederliste ist nur für Channels und Supergroups verfügbar".to_string()),
    }
}

/// Build a human-readable display name from Telegram first/last name fields.
fn build_display_name(first: Option<&str>, last: Option<&str>, id: i64) -> String {
    match (
        first.filter(|s| !s.is_empty()),
        last.filter(|s| !s.is_empty()),
    ) {
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
