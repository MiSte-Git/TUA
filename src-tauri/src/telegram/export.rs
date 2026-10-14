use std::collections::HashMap;
use std::path::{Path, PathBuf};

use chrono::{Datelike, Local};

use super::analysis::{AnalysisResult, ChatInfo, MemberActivity};
use super::mention::JoinLeaveEvent;

fn fmt_date(ts: Option<i64>) -> String {
    ts.and_then(|t| chrono::DateTime::from_timestamp(t, 0))
        .map(|dt| dt.format("%d.%m.%Y").to_string())
        .unwrap_or_default()
}

fn fmt_datetime(ts: Option<i64>) -> String {
    ts.and_then(|t| chrono::DateTime::from_timestamp(t, 0))
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

// ── Error type ────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum ExportError {
    Io(String),
    Csv(String),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Io(d) => tr!("backend.err.write", detail = d),
            Self::Csv(d) => tr!("backend.err.csv", detail = d),
        };
        f.write_str(&s)
    }
}

impl std::error::Error for ExportError {}

// ── Labels ────────────────────────────────────────────────────────────────────

/// Texte fuer die Kommentarzeilen im CSV in der gewaehlten UI-Sprache.
/// Kommen aus dem Frontend (Abschnitt `csv` der Uebersetzungsdateien),
/// Platzhalter im i18next-Format `{{name}}`. Fehlt ein Text, steht der Schluessel.
#[derive(serde::Deserialize, Debug, Default)]
#[serde(transparent)]
pub struct Labels(HashMap<String, String>);

impl Labels {
    fn t(&self, key: &str) -> String {
        self.0.get(key).cloned().unwrap_or_else(|| key.to_string())
    }

    fn tp(&self, key: &str, params: &[(&str, &dyn std::fmt::Display)]) -> String {
        let mut s = self.t(key);
        for (name, value) in params {
            s = s.replace(&format!("{{{{{}}}}}", name), &value.to_string());
        }
        s
    }

    /// Kommentarzeile `# <text>`
    fn line(&self, key: &str, params: &[(&str, &dyn std::fmt::Display)]) -> [String; 1] {
        [format!("# {}", self.tp(key, params))]
    }
}

impl From<std::io::Error> for ExportError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl From<csv::Error> for ExportError {
    fn from(e: csv::Error) -> Self {
        Self::Csv(e.to_string())
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Options for the activity export (all filter settings of the UI).
#[derive(serde::Deserialize, Debug, Default)]
pub struct ActivityExportOptions {
    pub min_messages: u32,
    pub min_reactions: u32,
    pub min_poll_participations: u32,
    pub include_reactions: bool,
    pub excluded_ids: Vec<i64>,
    pub st_ids: Vec<i64>,
}

fn period_text(result: &AnalysisResult, l: &Labels) -> String {
    if result.period_months > 0 {
        let span = match (&result.scan_from, &result.scan_to) {
            (Some(f), Some(t)) => format!(" ({})", l.tp("range", &[("from", f), ("to", t)])),
            _ => String::new(),
        };
        // `period_months` liefert das Frontend bereits mit aufgeloester Pluralform
        format!("{}{}", l.t("period_months"), span)
    } else {
        l.tp(
            "range",
            &[
                ("from", &result.period_from.as_deref().unwrap_or("?")),
                ("to", &result.period_to.as_deref().unwrap_or("?")),
            ],
        )
    }
}

fn kind_label(kind: &str, l: &Labels) -> String {
    match kind {
        "message" | "reaction" | "poll" | "quiz" => l.t(&format!("activity_{}", kind)),
        other => other.to_string(),
    }
}

/// ISO calendar week, e.g. `2026-KW41` (prefix from the labels).
fn iso_week(dt: &chrono::DateTime<chrono::Utc>, l: &Labels) -> String {
    let w = dt.iso_week();
    format!("{}-{}{:02}", w.year(), l.t("week_prefix"), w.week())
}

fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("export");
    let name = format!("{}_{}.csv", stem, suffix);
    match path.parent() {
        Some(p) => p.join(name),
        None => PathBuf::from(name),
    }
}

/// Write the activity export. Always writes
///  - `<path>`: summary, one row per member (totals over the analysed period)
///  - `<path>_Einzeldaten.csv`: one row per activity with date, so the period
///    can be narrowed later in LibreOffice/Excel (AutoFilter, pivot table).
/// Returns the paths of all written files.
///
/// Active = message_count >= min_messages AND NOT in excluded_ids (same as UI).
pub fn export_csv(
    result: &AnalysisResult,
    chat_info: &ChatInfo,
    path: &Path,
    opts: &ActivityExportOptions,
    l: &Labels,
) -> Result<Vec<String>, ExportError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ExportError::Io(e.to_string()))?;
    }

    let min_messages = opts.min_messages;
    let excluded_ids = &opts.excluded_ids;
    let st_ids = &opts.st_ids;
    let members = &result.members;
    let mut written = Vec::new();

    // flexible(true): metadata rows have 1 field, data rows have more
    let mut wtr = csv::WriterBuilder::new().flexible(true).from_path(path)?;

    // ── Header stat calculations (current members only) ──────────────────────
    let cur = || members.iter().filter(|m| m.is_current_member);
    let a = cur().filter(|m| m.message_count > 0 && !excluded_ids.contains(&m.user_id)).count();
    let b = cur()
        .filter(|m| m.message_count > 0 && m.message_count < min_messages && !excluded_ids.contains(&m.user_id))
        .count();
    let c_total = cur().filter(|m| excluded_ids.contains(&m.user_id)).count();
    let c_above = cur()
        .filter(|m| excluded_ids.contains(&m.user_id) && m.message_count >= min_messages)
        .count();
    let active_count = cur()
        .filter(|m| m.message_count >= min_messages && !excluded_ids.contains(&m.user_id))
        .count();

    let details_suffix = sanitize_filename_part(&l.t("details_suffix"));
    let details_suffix = if details_suffix.is_empty() { "details".to_string() } else { details_suffix };

    write_chat_header(&mut wtr, chat_info, &l.t("kind_summary"), l)?;
    write_activity_filter_block(&mut wtr, result, opts, l)?;

    wtr.write_record(&l.line("section_result", &[]))?;
    wtr.write_record(&l.line("scanned", &[("value", &result.total_messages)]))?;
    if let Some(mc) = chat_info.member_count {
        wtr.write_record(&l.line("total_members", &[("value", &mc)]))?;
    }
    wtr.write_record(&l.line("with_messages", &[("value", &a)]))?;
    wtr.write_record(&l.line("below_threshold", &[("threshold", &min_messages), ("value", &b)]))?;
    if c_total > 0 {
        wtr.write_record(&l.line("excluded_total", &[("value", &c_total)]))?;
    }
    if c_above > 0 {
        wtr.write_record(&l.line("excluded_above", &[("value", &c_above)]))?;
    }
    wtr.write_record(&l.line("active", &[("value", &active_count)]))?;
    if !result.events.is_empty() {
        wtr.write_record(&l.line("details_hint", &[("suffix", &details_suffix)]))?;
    }

    wtr.write_record(&[
        "user_id",
        "name",
        "username",
        "joined_date",
        "first_message_date",
        "last_message_date",
        "message_count",
        "last_reaction_date",
        "reaction_count",
        "poll_participations",
        "quiz_participations",
        "last_poll_date",
        "is_bot",
        "active",
        "excluded",
        "servant_team",
    ])?;

    // all members, no rows omitted
    for member in members {
        let is_excluded = excluded_ids.contains(&member.user_id);
        let is_st = st_ids.contains(&member.user_id);
        let is_active = member.message_count >= min_messages && !is_excluded;
        wtr.write_record(&[
            member.user_id.to_string(),
            member.name.clone(),
            member.username.clone().unwrap_or_default(),
            member
                .joined_date
                .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default(),
            fmt_datetime(member.first_message_date),
            fmt_date(member.last_message_date),
            member.message_count.to_string(),
            fmt_date(member.last_reaction_date),
            member.reaction_count.to_string(),
            member.poll_participations.to_string(),
            member.quiz_participations.to_string(),
            fmt_date(member.last_poll_date),
            member.is_bot.to_string(),
            is_active.to_string(),
            is_excluded.to_string(),
            is_st.to_string(),
        ])?;
    }
    wtr.flush()?;
    written.push(path.display().to_string());

    // ── Single activities (always all of the analysed period) ───────────────
    if !result.events.is_empty() {
        let info: HashMap<i64, &MemberActivity> =
            members.iter().map(|m| (m.user_id, m)).collect();

        let dpath = sibling_path(path, &details_suffix);
        let mut w = csv::WriterBuilder::new().flexible(true).from_path(&dpath)?;
        write_chat_header(&mut w, chat_info, &l.t("kind_details"), l)?;
        write_activity_filter_block(&mut w, result, opts, l)?;
        w.write_record(&l.line("details_intro", &[]))?;
        w.write_record(&l.line("details_reactions_hint", &[]))?;
        w.write_record(&l.line("rows", &[("value", &result.events.len())]))?;
        w.write_record(&[
            "date",
            "time_utc",
            "week",
            "month",
            "user_id",
            "name",
            "username",
            "activity",
            "is_bot",
            "excluded",
            "servant_team",
        ])?;
        let mut sorted: Vec<_> = result.events.iter().collect();
        sorted.sort_by_key(|e| e.ts);
        for ev in sorted {
            let dt = chrono::DateTime::from_timestamp(ev.ts, 0).unwrap_or_default();
            let (name, uname, is_bot) = info
                .get(&ev.user_id)
                .map(|m| (m.name.clone(), m.username.clone().unwrap_or_default(), m.is_bot))
                .unwrap_or_else(|| (format!("ID {}", ev.user_id), String::new(), false));
            w.write_record(&[
                dt.format("%Y-%m-%d").to_string(),
                dt.format("%H:%M:%S").to_string(),
                iso_week(&dt, l),
                dt.format("%Y-%m").to_string(),
                ev.user_id.to_string(),
                name,
                uname,
                kind_label(&ev.kind, l),
                is_bot.to_string(),
                excluded_ids.contains(&ev.user_id).to_string(),
                st_ids.contains(&ev.user_id).to_string(),
            ])?;
        }
        w.flush()?;
        written.push(dpath.display().to_string());
    }

    Ok(written)
}

fn write_activity_filter_block<W: std::io::Write>(
    wtr: &mut csv::Writer<W>,
    result: &AnalysisResult,
    opts: &ActivityExportOptions,
    l: &Labels,
) -> Result<(), ExportError> {
    wtr.write_record(&l.line("section_filter", &[]))?;
    wtr.write_record(&l.line("analysed_period", &[("value", &period_text(result, l))]))?;
    wtr.write_record(&l.line("reactions_included", &[("value", &yes_no(opts.include_reactions, l))]))?;
    wtr.write_record(&l.line("min_messages", &[("value", &opts.min_messages)]))?;
    wtr.write_record(&l.line("min_reactions", &[("value", &opts.min_reactions)]))?;
    wtr.write_record(&l.line("min_polls", &[("value", &opts.min_poll_participations)]))?;
    wtr.write_record(&l.line("excluded_members", &[("value", &opts.excluded_ids.len())]))?;
    wtr.write_record(&l.line("st_marked", &[("value", &opts.st_ids.len())]))?;
    Ok(())
}

// ── Join/leave export ─────────────────────────────────────────────────────────

/// Filter options of a join/leave search, written into the CSV header.
#[derive(serde::Deserialize, Debug, Default)]
pub struct JoinLeaveExportFilter {
    pub search: String,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub event_types: Vec<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

fn event_label(event_type: &str, l: &Labels) -> String {
    match event_type {
        "added" | "joined" | "left" | "removed" => l.t(&format!("event_{}", event_type)),
        other => other.to_string(),
    }
}

/// Write join/leave search results incl. the used filter options as CSV.
pub fn export_join_leave_csv(
    events: &[JoinLeaveEvent],
    chat_info: &ChatInfo,
    path: &Path,
    filter: &JoinLeaveExportFilter,
    l: &Labels,
) -> Result<(), ExportError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ExportError::Io(e.to_string()))?;
    }

    let mut wtr = csv::WriterBuilder::new()
        .flexible(true)
        .from_path(path)?;

    write_chat_header(&mut wtr, chat_info, &l.t("kind_join_leave"), l)?;

    wtr.write_record(&l.line("section_filter", &[]))?;
    wtr.write_record(&l.line("search_term", &[("value", &filter.search)]))?;
    if let Some(uid) = filter.user_id {
        let name = filter.display_name.as_deref().unwrap_or("");
        let uname = filter
            .username
            .as_deref()
            .map(|u| format!(" @{}", u))
            .unwrap_or_default();
        wtr.write_record(&l.line("member", &[("name", &name), ("username", &uname), ("id", &uid)]))?;
    }
    let types = filter
        .event_types
        .iter()
        .map(|t| event_label(t, l))
        .collect::<Vec<_>>()
        .join(" / ");
    wtr.write_record(&l.line("event_types", &[("value", &types)]))?;
    let from = filter
        .date_from
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| l.t("from_start"));
    let to = filter
        .date_to
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| l.t("today"));
    let range = l.tp("range", &[("from", &from), ("to", &to)]);
    wtr.write_record(&l.line("period", &[("value", &range)]))?;

    wtr.write_record(&l.line("section_result", &[]))?;
    wtr.write_record(&l.line("hits", &[("value", &events.len())]))?;

    wtr.write_record(&[
        "event",
        "date",
        "time_utc",
        "affected_user",
        "affected_user_id",
        "affected_username",
        "actor",
        "actor_user_id",
        "chat_id",
        "message_id",
    ])?;

    for ev in events {
        let date = chrono::DateTime::parse_from_rfc3339(&ev.date)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|_| ev.date.chars().take(10).collect());
        wtr.write_record(&[
            event_label(&ev.event_type, l),
            date,
            ev.time.clone(),
            ev.affected_user.clone(),
            ev.affected_user_id.map(|v| v.to_string()).unwrap_or_default(),
            ev.affected_username.clone().unwrap_or_default(),
            ev.actor.clone().unwrap_or_default(),
            ev.actor_user_id.map(|v| v.to_string()).unwrap_or_default(),
            ev.chat_id.to_string(),
            ev.message_id.to_string(),
        ])?;
    }

    wtr.flush()?;
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn yes_no(v: bool, l: &Labels) -> String {
    l.t(if v { "yes" } else { "no" })
}

fn write_chat_header<W: std::io::Write>(
    wtr: &mut csv::Writer<W>,
    chat_info: &ChatInfo,
    kind: &str,
    l: &Labels,
) -> Result<(), ExportError> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S %:z").to_string();
    wtr.write_record(&l.line("header_export", &[("value", &now)]))?;
    wtr.write_record(&l.line("header_kind", &[("value", &kind)]))?;
    wtr.write_record(&l.line("header_chat", &[("value", &chat_info.title)]))?;
    if let Some(username) = &chat_info.username {
        wtr.write_record(&l.line("header_username", &[("value", &username)]))?;
    }
    wtr.write_record(&l.line("header_chat_id", &[("value", &chat_info.id)]))?;
    Ok(())
}

/// Replace characters that are problematic in filenames and collapse repeats.
fn sanitize_filename_part(s: &str) -> String {
    let mapped: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '.' { c } else { '_' })
        .collect();
    let mut out = String::with_capacity(mapped.len());
    for c in mapped.chars() {
        if c == '_' && out.ends_with('_') {
            continue;
        }
        out.push(c);
    }
    out.trim_matches(|c| c == '_' || c == '.').to_string()
}

/// Suggest a filename: `<Chat>_<Zeitraum>_<Exportdatum>.csv`.
pub fn suggested_filename(chat_info: &ChatInfo, period: &str) -> String {
    let title = sanitize_filename_part(&chat_info.title);
    let title = if title.is_empty() { "Chat".to_string() } else { title };
    let period = sanitize_filename_part(period);
    let today = Local::now().format("%Y-%m-%d");
    if period.is_empty() {
        format!("{}_{}.csv", title, today)
    } else {
        format!("{}_{}_{}.csv", title, period, today)
    }
}
