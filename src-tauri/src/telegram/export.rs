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

#[derive(thiserror::Error, Debug)]
pub enum ExportError {
    #[error("Schreibfehler: {0}")]
    Io(String),
    #[error("CSV-Fehler: {0}")]
    Csv(String),
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

fn period_text(result: &AnalysisResult) -> String {
    let span = match (&result.scan_from, &result.scan_to) {
        (Some(f), Some(t)) => format!(" ({} bis {})", f, t),
        _ => String::new(),
    };
    if result.period_months > 0 {
        format!("letzte {} Monate{}", result.period_months, span)
    } else {
        format!(
            "{} bis {}",
            result.period_from.as_deref().unwrap_or("?"),
            result.period_to.as_deref().unwrap_or("?")
        )
    }
}

fn kind_label(kind: &str) -> &str {
    match kind {
        "message" => "Nachricht",
        "reaction" => "Reaktion",
        "poll" => "Umfrage",
        "quiz" => "Quiz",
        other => other,
    }
}

/// ISO calendar week as `2026-KW41`.
fn iso_week(dt: &chrono::DateTime<chrono::Utc>) -> String {
    let w = dt.iso_week();
    format!("{}-KW{:02}", w.year(), w.week())
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

    write_chat_header(&mut wtr, chat_info, "Aktivitaets-Analyse - Zusammenfassung pro Mitglied")?;
    write_activity_filter_block(&mut wtr, result, opts)?;

    wtr.write_record(&["# --- Ergebnis ---".to_string()])?;
    wtr.write_record(&[format!("# Nachrichten gescannt: {}", result.total_messages)])?;
    if let Some(mc) = chat_info.member_count {
        wtr.write_record(&[format!("# Gesamtmitglieder: {}", mc)])?;
    }
    wtr.write_record(&[format!("# Mitglieder mit Nachrichten: {}", a)])?;
    wtr.write_record(&[format!("# davon < Schwellenwert ({}): {}", min_messages, b)])?;
    if c_total > 0 {
        wtr.write_record(&[format!("# manuell ausgeschlossen (gesamt): {}", c_total)])?;
    }
    if c_above > 0 {
        wtr.write_record(&[format!("# manuell ausgeschlossen (>= Schwellenwert): {}", c_above)])?;
    }
    wtr.write_record(&[format!("# Aktive Mitglieder: {}", active_count)])?;
    if !result.events.is_empty() {
        wtr.write_record(&["# Fuer kuerzere Zeitraeume die Datei mit Endung _Einzeldaten verwenden.".to_string()])?;
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

        let dpath = sibling_path(path, "Einzeldaten");
        let mut w = csv::WriterBuilder::new().flexible(true).from_path(&dpath)?;
        write_chat_header(&mut w, chat_info, "Aktivitaets-Analyse - Einzeldaten")?;
        write_activity_filter_block(&mut w, result, opts)?;
        w.write_record(&["# Alle Aktivitaeten des analysierten Zeitraums. Eine Zeile pro Aktivitaet. Zeiten in UTC.".to_string()])?;
        w.write_record(&["# Reaktionen tragen das Datum der zugehoerigen Nachricht.".to_string()])?;
        w.write_record(&[format!("# Zeilen: {}", result.events.len())])?;
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
                iso_week(&dt),
                dt.format("%Y-%m").to_string(),
                ev.user_id.to_string(),
                name,
                uname,
                kind_label(&ev.kind).to_string(),
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
) -> Result<(), ExportError> {
    wtr.write_record(&["# --- Filter-Optionen ---".to_string()])?;
    wtr.write_record(&[format!("# Analysierter Zeitraum: {}", period_text(result))])?;
    wtr.write_record(&[format!("# Reaktionen einbezogen: {}", ja_nein(opts.include_reactions))])?;
    wtr.write_record(&[format!("# Mindest-Nachrichten: {}", opts.min_messages)])?;
    wtr.write_record(&[format!("# Mindest-Reaktionen: {}", opts.min_reactions)])?;
    wtr.write_record(&[format!("# Mindest-Umfrageteilnahmen: {}", opts.min_poll_participations)])?;
    wtr.write_record(&[format!("# Manuell ausgeschlossene Mitglieder: {}", opts.excluded_ids.len())])?;
    wtr.write_record(&[format!("# Als Servant-Team markiert: {}", opts.st_ids.len())])?;
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

fn event_label(event_type: &str) -> &str {
    match event_type {
        "added" => "hinzugefügt",
        "joined" => "beigetreten",
        "left" => "verlassen",
        "removed" => "entfernt",
        other => other,
    }
}

/// Write join/leave search results incl. the used filter options as CSV.
pub fn export_join_leave_csv(
    events: &[JoinLeaveEvent],
    chat_info: &ChatInfo,
    path: &Path,
    filter: &JoinLeaveExportFilter,
) -> Result<(), ExportError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ExportError::Io(e.to_string()))?;
    }

    let mut wtr = csv::WriterBuilder::new()
        .flexible(true)
        .from_path(path)?;

    write_chat_header(&mut wtr, chat_info, "Ein-/Austritt")?;

    wtr.write_record(&["# --- Filter-Optionen ---".to_string()])?;
    wtr.write_record(&[format!("# Suchbegriff: {}", filter.search)])?;
    if let Some(uid) = filter.user_id {
        let name = filter.display_name.as_deref().unwrap_or("");
        let uname = filter
            .username
            .as_deref()
            .map(|u| format!(" @{}", u))
            .unwrap_or_default();
        wtr.write_record(&[format!("# Mitglied: {}{} (ID {})", name, uname, uid)])?;
    }
    let types = filter
        .event_types
        .iter()
        .map(|t| event_label(t))
        .collect::<Vec<_>>()
        .join(" / ");
    wtr.write_record(&[format!("# Ereignistypen: {}", types)])?;
    let from = filter
        .date_from
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Anfang des Chatverlaufs");
    let to = filter
        .date_to
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("heute");
    wtr.write_record(&[format!("# Zeitraum: {} bis {}", from, to)])?;

    wtr.write_record(&["# --- Ergebnis ---".to_string()])?;
    wtr.write_record(&[format!("# Treffer: {}", events.len())])?;

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
            event_label(&ev.event_type).to_string(),
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

fn ja_nein(v: bool) -> &'static str {
    if v { "ja" } else { "nein" }
}

fn write_chat_header<W: std::io::Write>(
    wtr: &mut csv::Writer<W>,
    chat_info: &ChatInfo,
    kind: &str,
) -> Result<(), ExportError> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S %:z");
    wtr.write_record(&[format!("# Export: {}", now)])?;
    wtr.write_record(&[format!("# Auswertung: {}", kind)])?;
    wtr.write_record(&[format!("# Chat: {}", chat_info.title)])?;
    if let Some(username) = &chat_info.username {
        wtr.write_record(&[format!("# Username: @{}", username)])?;
    }
    wtr.write_record(&[format!("# Chat-ID: {}", chat_info.id)])?;
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
