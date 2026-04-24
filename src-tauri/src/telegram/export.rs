use std::path::Path;

use chrono::Utc;

use super::analysis::{AnalysisResult, ChatInfo};

fn fmt_date(ts: Option<i64>) -> String {
    ts.and_then(|t| chrono::NaiveDateTime::from_timestamp_opt(t, 0))
        .map(|dt| dt.format("%d.%m.%Y").to_string())
        .unwrap_or_default()
}

fn fmt_datetime(ts: Option<i64>) -> String {
    ts.and_then(|t| chrono::NaiveDateTime::from_timestamp_opt(t, 0))
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

/// Write `result` as a CSV file to `path`.
///
/// Active = message_count >= min_messages AND NOT in excluded_ids.
/// Uses the same A – B – C formula as the UI:
///   A = members_with_messages
///   B = message_count < min_messages  (below threshold, regardless of excluded)
///   C = message_count >= min_messages AND excluded  (no overlap with B)
///   active = A – B – C
pub fn export_csv(
    result: &AnalysisResult,
    chat_info: &ChatInfo,
    path: &Path,
    min_messages: u32,
    min_reactions: u32,
    excluded_ids: &[i64],
    st_ids: &[i64],
) -> Result<(), ExportError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ExportError::Io(e.to_string()))?;
    }

    // flexible(true): metadata rows have 1 field, data rows have 7 — no mismatch error
    let mut wtr = csv::WriterBuilder::new()
        .flexible(true)
        .from_path(path)?;

    // ── Header stat calculations (current members only) ──────────────────────
    let a = result
        .members
        .iter()
        .filter(|m| m.is_current_member && m.message_count > 0 && !excluded_ids.contains(&m.user_id))
        .count() as u32;
    let b = result
        .members
        .iter()
        .filter(|m| m.is_current_member && m.message_count > 0 && m.message_count < min_messages && !excluded_ids.contains(&m.user_id))
        .count() as u32;
    let c_total = result
        .members
        .iter()
        .filter(|m| m.is_current_member && excluded_ids.contains(&m.user_id))
        .count() as u32;
    let c_above = result
        .members
        .iter()
        .filter(|m| m.is_current_member && excluded_ids.contains(&m.user_id) && m.message_count >= min_messages)
        .count() as u32;
    let active_count = result
        .members
        .iter()
        .filter(|m| m.is_current_member && m.message_count >= min_messages && !excluded_ids.contains(&m.user_id))
        .count() as u32;

    // ── Metadata comment rows ────────────────────────────────────────────────
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S+00:00");
    wtr.write_record(&[format!("# Export: {}", now)])?;
    wtr.write_record(&[format!("# Chat: {}", chat_info.title)])?;
    if let Some(username) = &chat_info.username {
        wtr.write_record(&[format!("# Username: @{}", username)])?;
    }
    if result.period_months > 0 {
        wtr.write_record(&[format!("# Zeitraum: {} Monate", result.period_months)])?;
    } else {
        let from = result.period_from.as_deref().unwrap_or("?");
        let to = result.period_to.as_deref().unwrap_or("?");
        wtr.write_record(&[format!("# Zeitraum: {} bis {}", from, to)])?;
    }
    wtr.write_record(&[format!("# Nachrichten gescannt: {}", result.total_messages)])?;
    if let Some(mc) = chat_info.member_count {
        wtr.write_record(&[format!("# Gesamtmitglieder: {}", mc)])?;
    }
    wtr.write_record(&[format!("# Mitglieder mit Nachrichten: {}", a)])?;
    wtr.write_record(&[format!(
        "# davon < Schwellenwert ({}): {}",
        min_messages, b
    )])?;
    if c_total > 0 {
        wtr.write_record(&[format!("# manuell ausgeschlossen (gesamt): {}", c_total)])?;
    }
    if c_above > 0 {
        wtr.write_record(&[format!("# manuell ausgeschlossen (>= Schwellenwert): {}", c_above)])?;
    }
    wtr.write_record(&[format!("# Aktive Mitglieder: {}", active_count)])?;
    wtr.write_record(&[format!("# Mindest-Nachrichten: {}", min_messages)])?;
    if min_reactions > 0 {
        wtr.write_record(&[format!("# Mindest-Reaktionen: {}", min_reactions)])?;
    }

    // ── Column header ────────────────────────────────────────────────────────
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
        "last_poll_date",
        "is_bot",
        "active",
        "excluded",
        "servant_team",
    ])?;

    // ── Data rows — all members (no rows omitted) ────────────────────────────
    for member in &result.members {
        let is_excluded = excluded_ids.contains(&member.user_id);
        let is_st = st_ids.contains(&member.user_id);
        // active = above threshold AND not excluded (mirrors UI trulyActive logic)
        let is_active = member.message_count >= min_messages && !is_excluded;

        wtr.write_record(&[
            member.user_id.to_string(),
            member.name.clone(),
            member.username.clone().unwrap_or_default(),
            member.joined_date
                .and_then(|ts| chrono::NaiveDateTime::from_timestamp_opt(ts, 0))
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default(),
            fmt_datetime(member.first_message_date),
            fmt_date(member.last_message_date),
            member.message_count.to_string(),
            fmt_date(member.last_reaction_date),
            member.reaction_count.to_string(),
            member.poll_participations.to_string(),
            fmt_date(member.last_poll_date),
            member.is_bot.to_string(),
            is_active.to_string(),
            is_excluded.to_string(),
            is_st.to_string(),
        ])?;
    }

    wtr.flush()?;
    Ok(())
}

/// Suggest a filename for the export based on chat title and current time.
pub fn suggested_filename(chat_info: &ChatInfo) -> String {
    let title = chat_info
        .title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect::<String>();
    let now = Utc::now();
    format!("{}_{}.csv", title, now.format("%Y-%m-%d_%H%M"))
}
