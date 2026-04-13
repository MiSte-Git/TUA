mod telegram;

use telegram::{
    AnalysisError, AnalysisResult, AuthError, ChatInfo, ChatMember, ConnectResult, ExportError,
    FirstMentionResult,
};

// ── Auth commands ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn connect(phone: String) -> Result<ConnectResult, String> {
    let api_id: i32 = std::env::var("TELEGRAM_API_ID")
        .map_err(|_| "TELEGRAM_API_ID not set".to_string())?
        .parse()
        .map_err(|_| "TELEGRAM_API_ID must be a number".to_string())?;
    let api_hash = std::env::var("TELEGRAM_API_HASH")
        .map_err(|_| "TELEGRAM_API_HASH not set".to_string())?;
    telegram::auth::connect(api_id, &api_hash, &phone)
        .await
        .map_err(|e: AuthError| e.to_string())
}

#[tauri::command]
async fn submit_code(code: String) -> Result<ConnectResult, String> {
    telegram::auth::submit_code(&code)
        .await
        .map_err(|e: AuthError| e.to_string())
}

#[tauri::command]
async fn submit_password(password: String) -> Result<(), String> {
    telegram::auth::submit_password(&password)
        .await
        .map_err(|e: AuthError| e.to_string())
}

#[tauri::command]
async fn get_auth_status() -> Result<bool, String> {
    telegram::auth::is_authorized()
        .await
        .map_err(|e: AuthError| e.to_string())
}

// ── Analysis commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn resolve_chat(chat_url: String) -> Result<ChatInfo, String> {
    telegram::analysis::resolve_chat(&chat_url)
        .await
        .map_err(|e: AnalysisError| e.to_string())
}

#[tauri::command]
async fn run_analysis(
    chat_url: String,
    months: i32,
    include_reactions: bool,
    app: tauri::AppHandle,
) -> Result<AnalysisResult, String> {
    telegram::analysis::run_analysis(&chat_url, months, include_reactions, app)
        .await
        .map_err(|e: AnalysisError| e.to_string())
}

// ── Export commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn export_csv(
    result: AnalysisResult,
    chat_info: ChatInfo,
    path: String,
    min_messages: u32,
    min_reactions: u32,
    excluded_ids: Vec<i64>,
) -> Result<(), String> {
    telegram::export::export_csv(
        &result,
        &chat_info,
        std::path::Path::new(&path),
        min_messages,
        min_reactions,
        &excluded_ids,
    )
    .map_err(|e: ExportError| e.to_string())
}

#[tauri::command]
fn suggested_filename(chat_info: ChatInfo) -> String {
    telegram::export::suggested_filename(&chat_info)
}

// ── Member list command ───────────────────────────────────────────────────────

#[tauri::command]
async fn load_chat_members(
    chat_id: i64,
    app: tauri::AppHandle,
) -> Result<Vec<ChatMember>, String> {
    let client = telegram::auth::get_client()
        .await
        .ok_or("Not authorized")?;
    telegram::mention::load_chat_members(&client, chat_id, &app).await
}

// ── First-mention command ─────────────────────────────────────────────────────

#[tauri::command]
async fn find_first_mention(
    chat_id: i64,
    chat_username: Option<String>,
    username: String,
    app: tauri::AppHandle,
) -> Result<FirstMentionResult, String> {
    let client = telegram::auth::get_client()
        .await
        .ok_or("Not authorized")?;
    telegram::mention::find_first_mention(&client, chat_id, chat_username, username, &app).await
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            connect,
            submit_code,
            submit_password,
            get_auth_status,
            resolve_chat,
            run_analysis,
            export_csv,
            suggested_filename,
            load_chat_members,
            find_first_mention,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
