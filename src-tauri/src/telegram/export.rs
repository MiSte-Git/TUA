use std::path::Path;

use chrono::Utc;

use super::analysis::{AnalysisResult, ChatInfo};

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
) -> Result<(), ExportError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ExportError::Io(e.to_string()))?;
    }

    // flexible(true): metadata rows have 1 field, data rows have 7 — no mismatch error
    let mut wtr = csv::WriterBuilder::new()
        .flexible(true)
        .from_path(path)?;

    // ── A – B – C calculations ───────────────────────────────────────────────
    let a = result.members_with_messages;
    let b = result
        .members
        .iter()
        .filter(|m| m.message_count <= min_messages)
        .count() as u32;
    let c = result
        .members
        .iter()
        .filter(|m| m.message_count > min_messages && excluded_ids.contains(&m.user_id))
        .count() as u32;
    let active_count = a.saturating_sub(b).saturating_sub(c);

    // ── Metadata comment rows ────────────────────────────────────────────────
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S+00:00");
    wtr.write_record(&[format!("# Export: {}", now)])?;
    wtr.write_record(&[format!("# Chat: {}", chat_info.title)])?;
    if let Some(username) = &chat_info.username {
        wtr.write_record(&[format!("# Username: @{}", username)])?;
    }
    wtr.write_record(&[format!("# Period: {} months", result.period_months)])?;
    wtr.write_record(&[format!("# Total messages scanned: {}", result.total_messages)])?;
    if let Some(mc) = chat_info.member_count {
        wtr.write_record(&[format!("# Gesamtmitglieder: {}", mc)])?;
    }
    wtr.write_record(&[format!("# Mitglieder mit Nachrichten: {}", a)])?;
    wtr.write_record(&[format!(
        "# davon <= Threshold ({}): {}",
        min_messages,
        b
    )])?;
    if c > 0 {
        wtr.write_record(&[format!("# manuell ausgeschlossen (> Threshold): {}", c)])?;
    }
    wtr.write_record(&[format!("# Aktive Mitglieder: {}", active_count)])?;
    wtr.write_record(&[format!("# Min messages threshold: {}", min_messages)])?;
    if min_reactions > 0 {
        wtr.write_record(&[format!("# Min reactions threshold: {}", min_reactions)])?;
    }

    // ── Column header ────────────────────────────────────────────────────────
    wtr.write_record(&[
        "user_id",
        "name",
        "username",
        "message_count",
        "reaction_count",
        "poll_participations",
        "is_bot",
        "active",
        "excluded",
    ])?;

    // ── Data rows — all members (no rows omitted) ────────────────────────────
    for member in &result.members {
        let is_excluded = excluded_ids.contains(&member.user_id);
        // active = above threshold AND not excluded (mirrors UI trulyActive logic)
        let is_active = member.message_count > min_messages && !is_excluded;

        wtr.write_record(&[
            member.user_id.to_string(),
            member.name.clone(),
            member.username.clone().unwrap_or_default(),
            member.message_count.to_string(),
            member.reaction_count.to_string(),
            member.poll_participations.to_string(),
            member.is_bot.to_string(),
            is_active.to_string(),
            is_excluded.to_string(),
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
