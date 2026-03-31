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
/// Columns: user_id, name, username, message_count, reaction_count, active, excluded
/// Active = message_count ≥ min_messages OR (min_reactions > 0 AND reaction_count ≥ min_reactions)
/// Excluded members appear in both the main section and a separate section at the end.
pub fn export_csv(
    result: &AnalysisResult,
    chat_info: &ChatInfo,
    path: &Path,
    min_messages: u32,
    min_reactions: u32,
    excluded_user_ids: &[i64],
) -> Result<(), ExportError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ExportError::Io(e.to_string()))?;
    }

    let mut wtr = csv::Writer::from_path(path)?;

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
        wtr.write_record(&[format!("# Total members: {}", mc)])?;
    }
    wtr.write_record(&[format!("# Active members: {}", result.members.len())])?;
    wtr.write_record(&[format!("# Min messages (active threshold): {}", min_messages)])?;
    if min_reactions > 0 {
        wtr.write_record(&[format!("# Min reactions (active threshold): {}", min_reactions)])?;
    }
    let excluded_count = result
        .members
        .iter()
        .filter(|m| excluded_user_ids.contains(&m.user_id))
        .count();
    if excluded_count > 0 {
        wtr.write_record(&[format!("# Excluded members: {}", excluded_count)])?;
    }

    // ── Column header ────────────────────────────────────────────────────────
    wtr.write_record(&[
        "user_id",
        "name",
        "username",
        "message_count",
        "reaction_count",
        "active",
        "excluded",
    ])?;

    // ── Main data rows (non-excluded first, then excluded) ────────────────────
    let is_active = |msg: u32, react: u32| -> bool {
        msg >= min_messages || (min_reactions > 0 && react >= min_reactions)
    };

    let (included, excluded): (Vec<_>, Vec<_>) = result
        .members
        .iter()
        .partition(|m| !excluded_user_ids.contains(&m.user_id));

    for member in &included {
        wtr.write_record(&[
            member.user_id.to_string(),
            member.name.clone(),
            member.username.clone().unwrap_or_default(),
            member.message_count.to_string(),
            member.reaction_count.to_string(),
            is_active(member.message_count, member.reaction_count).to_string(),
            "false".to_string(),
        ])?;
    }

    // ── Excluded section ─────────────────────────────────────────────────────
    if !excluded.is_empty() {
        wtr.write_record(&[""])?; // blank separator row
        wtr.write_record(&["# Excluded members:"])?;
        wtr.write_record(&[
            "user_id",
            "name",
            "username",
            "message_count",
            "reaction_count",
            "active",
            "excluded",
        ])?;
        for member in &excluded {
            wtr.write_record(&[
                member.user_id.to_string(),
                member.name.clone(),
                member.username.clone().unwrap_or_default(),
                member.message_count.to_string(),
                member.reaction_count.to_string(),
                is_active(member.message_count, member.reaction_count).to_string(),
                "true".to_string(),
            ])?;
        }
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
