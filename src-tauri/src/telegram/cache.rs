//! On-disk cache of raw analysis data per chat.
//!
//! Stores every counted activity with its timestamp plus poll records for the
//! largest window scanned so far. Any sub-period can then be derived without
//! a new Telegram scan; only missing parts (older history or new messages)
//! have to be fetched.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use chrono::{DateTime, Duration, NaiveDate, Utc};

use super::analysis::{
    ActivityEvent, AnalysisError, AnalysisResult, BotMember, ChatInfo, MemberActivity, PollRecord,
};

const CACHE_VERSION: u32 = 1;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CachedUser {
    pub name: String,
    pub username: Option<String>,
    pub joined_date: Option<i64>,
    #[serde(default)]
    pub joined_checked: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatCache {
    pub version: u32,
    pub chat: ChatInfo,
    /// Covered window (Unix timestamps, inclusive).
    pub from_ts: i64,
    pub to_ts: i64,
    pub include_reactions: bool,
    pub updated_at: i64,
    pub users: HashMap<i64, CachedUser>,
    pub events: Vec<ActivityEvent>,
    pub polls: Vec<PollRecord>,
    pub all_bots: Vec<BotMember>,
    pub own_is_admin: bool,
    pub own_can_get_participants: bool,
}

/// Short summary for the UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CacheStatus {
    pub from_ts: i64,
    pub to_ts: i64,
    pub updated_at: i64,
    pub include_reactions: bool,
    pub events: usize,
}

/// Raw data of one scan window, merged into the cache.
pub struct ScanPart {
    pub events: Vec<ActivityEvent>,
    pub polls: Vec<PollRecord>,
    pub users: HashMap<i64, (String, Option<String>)>,
}

impl ChatCache {
    pub fn new(chat: ChatInfo, include_reactions: bool, from_ts: i64, to_ts: i64) -> Self {
        Self {
            version: CACHE_VERSION,
            chat,
            from_ts,
            to_ts,
            include_reactions,
            updated_at: Utc::now().timestamp(),
            users: HashMap::new(),
            events: Vec::new(),
            polls: Vec::new(),
            all_bots: Vec::new(),
            own_is_admin: false,
            own_can_get_participants: false,
        }
    }

    pub fn user_ids(&self) -> HashSet<i64> {
        self.users.keys().copied().collect()
    }

    pub fn merge(&mut self, part: ScanPart) {
        for (uid, (name, username)) in part.users {
            match self.users.get_mut(&uid) {
                Some(u) => {
                    // keep a real name over the "ID 123" fallback of poll voters
                    if !name.starts_with("ID ") {
                        u.name = name;
                        u.username = username;
                    }
                }
                None => {
                    self.users.insert(
                        uid,
                        CachedUser { name, username, joined_date: None, joined_checked: false },
                    );
                }
            }
        }
        self.events.extend(part.events);
        self.polls.extend(part.polls);
    }

    pub fn status(&self) -> CacheStatus {
        CacheStatus {
            from_ts: self.from_ts,
            to_ts: self.to_ts,
            updated_at: self.updated_at,
            include_reactions: self.include_reactions,
            events: self.events.len(),
        }
    }
}

// ── File handling ─────────────────────────────────────────────────────────────

/// Directory holding the per-chat cache files.
pub fn cache_dir() -> PathBuf {
    let mut p = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("tua");
    p.push("cache");
    p
}

fn cache_path(chat_id: i64) -> PathBuf {
    cache_dir().join(format!("{}.json", chat_id))
}

pub fn load(chat_id: i64) -> Option<ChatCache> {
    let content = std::fs::read(cache_path(chat_id)).ok()?;
    let c: ChatCache = serde_json::from_slice(&content).ok()?;
    (c.version == CACHE_VERSION && c.chat.id == chat_id).then_some(c)
}

pub fn save(cache: &ChatCache) -> Result<(), String> {
    let path = cache_path(cache.chat.id);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec(cache).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// ── Window computation ────────────────────────────────────────────────────────

/// Requested analysis window: (from_ts, to_ts, period_from, period_to).
/// `to_ts` is never later than now, so later runs can fetch newer messages.
pub fn compute_window(
    months: i32,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<(i64, i64, Option<String>, Option<String>), AnalysisError> {
    let now = Utc::now();
    if months > 0 {
        let from = now - Duration::days(months as i64 * 30);
        return Ok((from.timestamp(), now.timestamp(), None, None));
    }
    let from_str = date_from.ok_or_else(|| AnalysisError::InvalidUrl(tr!("backend.err.date_from_missing")))?;
    let to_str = date_to.unwrap_or_else(|| now.format("%Y-%m-%d").to_string());
    let parse = |s: &str| {
        NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| AnalysisError::InvalidUrl(tr!("backend.err.invalid_date", value = s)))
    };
    let from = parse(&from_str)?
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AnalysisError::InvalidUrl(tr!("backend.err.invalid_date", value = "")))?
        .and_utc();
    let to = parse(&to_str)?
        .and_hms_opt(23, 59, 59)
        .ok_or_else(|| AnalysisError::InvalidUrl(tr!("backend.err.invalid_date", value = "")))?
        .and_utc();
    Ok((from.timestamp(), to.min(now).timestamp(), Some(from_str), Some(to_str)))
}

pub fn ts_to_dt(ts: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(ts, 0).unwrap_or_default()
}

// ── Derive a result for a sub-window ──────────────────────────────────────────

pub fn derive(
    c: &ChatCache,
    from_ts: i64,
    to_ts: i64,
    months: i32,
    period_from: Option<String>,
    period_to: Option<String>,
    include_reactions: bool,
) -> AnalysisResult {
    let from_eff = from_ts.max(c.from_ts);
    let to_eff = to_ts.min(c.to_ts);
    let bot_ids: HashSet<i64> = c.all_bots.iter().map(|b| b.user_id).collect();

    let events: Vec<ActivityEvent> = c
        .events
        .iter()
        .filter(|e| e.ts >= from_eff && e.ts <= to_eff)
        .filter(|e| include_reactions || e.kind != "reaction")
        .cloned()
        .collect();

    let mut agg: HashMap<i64, MemberActivity> = HashMap::new();
    for ev in &events {
        let m = agg.entry(ev.user_id).or_insert_with(|| {
            let u = c.users.get(&ev.user_id);
            MemberActivity {
                user_id: ev.user_id,
                name: u.map(|u| u.name.clone()).unwrap_or_else(|| format!("ID {}", ev.user_id)),
                username: u.and_then(|u| u.username.clone()),
                joined_date: u.and_then(|u| u.joined_date),
                message_count: 0,
                reaction_count: 0,
                poll_participations: 0,
                quiz_participations: 0,
                first_message_date: None,
                last_message_date: None,
                last_reaction_date: None,
                last_poll_date: None,
                is_bot: bot_ids.contains(&ev.user_id),
                is_current_member: true,
            }
        });
        let ts = ev.ts;
        match ev.kind.as_str() {
            "message" => {
                m.message_count += 1;
                m.first_message_date = Some(m.first_message_date.map_or(ts, |p| p.min(ts)));
                m.last_message_date = Some(m.last_message_date.map_or(ts, |p| p.max(ts)));
            }
            "reaction" => {
                m.reaction_count += 1;
                m.last_reaction_date = Some(m.last_reaction_date.map_or(ts, |p| p.max(ts)));
            }
            "poll" => {
                m.poll_participations += 1;
                m.last_poll_date = Some(m.last_poll_date.map_or(ts, |p| p.max(ts)));
            }
            "quiz" => {
                m.quiz_participations += 1;
                m.last_poll_date = Some(m.last_poll_date.map_or(ts, |p| p.max(ts)));
            }
            _ => {}
        }
    }

    let mut members: Vec<MemberActivity> = agg.into_values().collect();
    members.sort_by(|a, b| b.message_count.cmp(&a.message_count).then_with(|| a.name.cmp(&b.name)));

    let members_with_messages = members.iter().filter(|m| m.message_count > 0).count() as u32;
    let total_messages = events.iter().filter(|e| e.kind == "message").count() as u32;

    let polls_in: Vec<&PollRecord> =
        c.polls.iter().filter(|p| p.ts >= from_eff && p.ts <= to_eff).collect();
    let total_polls = polls_in.iter().filter(|p| !p.is_quiz).count() as u32;
    let total_quizzes = polls_in.iter().filter(|p| p.is_quiz).count() as u32;
    let poll_voters: u32 = polls_in.iter().filter(|p| !p.is_quiz).map(|p| p.voters).sum();
    let quiz_participations: u32 = members.iter().map(|m| m.quiz_participations).sum();

    AnalysisResult {
        chat: c.chat.clone(),
        members,
        members_with_messages,
        total_messages,
        period_months: months,
        period_from,
        period_to,
        total_polls_in_period: total_polls,
        total_quizzes_in_period: total_quizzes,
        all_bots: c.all_bots.clone(),
        own_is_admin: c.own_is_admin,
        own_can_get_participants: c.own_can_get_participants,
        avg_poll_participants: if total_polls > 0 { poll_voters as f32 / total_polls as f32 } else { 0.0 },
        avg_quiz_participation: if total_quizzes > 0 {
            quiz_participations as f32 / total_quizzes as f32
        } else {
            0.0
        },
        scan_from: Some(ts_to_dt(from_eff).format("%Y-%m-%d").to_string()),
        scan_to: Some(ts_to_dt(to_eff).format("%Y-%m-%d").to_string()),
        events,
    }
}
