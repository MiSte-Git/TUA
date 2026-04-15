use std::path::PathBuf;
use std::sync::Arc;

use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::{Client, SenderPool, SignInError};
use grammers_session::storages::SqliteSession;
use once_cell::sync::OnceCell;
use tokio::sync::Mutex;

// ── Session path ──────────────────────────────────────────────────────────────

pub fn session_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("telegram_user_activities");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.join("telegram_user_activities.session")
}

// ── Global state ──────────────────────────────────────────────────────────────

/// What stage of the auth flow we are currently in.
enum AuthStage {
    CodeRequired {
        token: LoginToken,
        api_hash: String,
    },
    PasswordRequired {
        token: PasswordToken,
    },
    Authorized,
}

struct TelegramState {
    client: Client,
    stage: AuthStage,
    /// Keep the runner task alive for the lifetime of the state.
    _runner: tokio::task::JoinHandle<()>,
}

static TELEGRAM: OnceCell<Mutex<Option<TelegramState>>> = OnceCell::new();

fn global() -> &'static Mutex<Option<TelegramState>> {
    TELEGRAM.get_or_init(|| Mutex::new(None))
}

// ── Error and result types ────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, serde::Serialize)]
pub enum AuthError {
    #[error("Verbindungsfehler: {0}")]
    Connection(String),
    #[error("Falscher Code")]
    WrongCode,
    #[error("Falsches Passwort")]
    WrongPassword,
    #[error("Session ungültig")]
    SessionInvalid,
    #[error("Unbekannter Fehler: {0}")]
    Unknown(String),
}

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ConnectResult {
    Ok,
    CodeRequired,
    PasswordRequired,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn normalize_phone(phone: &str) -> String {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.starts_with("00") {
        format!("+{}", &digits[2..])
    } else {
        format!("+{}", digits)
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Connect to Telegram.
///
/// - If a valid session exists → returns `ConnectResult::Ok` immediately.
/// - Otherwise → sends an SMS code and returns `ConnectResult::CodeRequired`.
pub async fn connect(api_id: i32, api_hash: &str, phone: &str) -> Result<ConnectResult, AuthError> {
    let phone = normalize_phone(phone);
    let path = session_path();
    log::info!("Session-Datei wird geöffnet: {}", path.display());

    let session = Arc::new(
        SqliteSession::open(&path)
            .await
            .map_err(|e| AuthError::Connection(e.to_string()))?,
    );

    let SenderPool { runner, handle, .. } = SenderPool::new(Arc::clone(&session), api_id);
    let client = Client::new(handle);
    let runner_handle = tokio::spawn(runner.run());

    if client
        .is_authorized()
        .await
        .map_err(|e| AuthError::Connection(e.to_string()))?
    {
        log::info!("Session bereits autorisiert");
        let mut guard = global().lock().await;
        *guard = Some(TelegramState {
            client,
            stage: AuthStage::Authorized,
            _runner: runner_handle,
        });
        return Ok(ConnectResult::Ok);
    }

    log::info!("Nicht autorisiert – Login-Code wird angefordert für {}", phone);
    let token = client
        .request_login_code(&phone, api_hash)
        .await
        .map_err(|e| AuthError::Connection(e.to_string()))?;

    let mut guard = global().lock().await;
    *guard = Some(TelegramState {
        client,
        stage: AuthStage::CodeRequired {
            token,
            api_hash: api_hash.to_string(),
        },
        _runner: runner_handle,
    });
    Ok(ConnectResult::CodeRequired)
}

/// Submit the SMS/app code received after `connect()`.
pub async fn submit_code(code: &str) -> Result<ConnectResult, AuthError> {
    let mut guard = global().lock().await;
    let state = guard.as_mut().ok_or(AuthError::SessionInvalid)?;

    let token = match &state.stage {
        AuthStage::CodeRequired { token, .. } => {
            // We need to take ownership; swap stage out temporarily.
            let AuthStage::CodeRequired { token, .. } =
                std::mem::replace(&mut state.stage, AuthStage::Authorized)
            else {
                unreachable!()
            };
            token
        }
        _ => return Err(AuthError::Unknown("Kein Code angefordert".into())),
    };

    match state.client.sign_in(&token, code).await {
        Ok(_user) => {
            log::info!("Erfolgreich per Code eingeloggt");
            state.stage = AuthStage::Authorized;
            Ok(ConnectResult::Ok)
        }
        Err(SignInError::PasswordRequired(password_token)) => {
            log::info!("2FA-Passwort erforderlich");
            state.stage = AuthStage::PasswordRequired {
                token: password_token,
            };
            Ok(ConnectResult::PasswordRequired)
        }
        Err(SignInError::InvalidCode) => {
            // Put the token back so the user can try again.
            // We consumed the token above, so we need to request a new code.
            Err(AuthError::WrongCode)
        }
        Err(e) => Err(AuthError::Unknown(e.to_string())),
    }
}

/// Submit the 2FA cloud password after `submit_code()` returned `PasswordRequired`.
pub async fn submit_password(password: &str) -> Result<(), AuthError> {
    let mut guard = global().lock().await;
    let state = guard.as_mut().ok_or(AuthError::SessionInvalid)?;

    let password_token = match std::mem::replace(&mut state.stage, AuthStage::Authorized) {
        AuthStage::PasswordRequired { token } => token,
        other => {
            state.stage = other;
            return Err(AuthError::Unknown("Kein Passwort angefordert".into()));
        }
    };

    match state.client.check_password(password_token, password).await {
        Ok(_user) => {
            log::info!("2FA-Passwort akzeptiert");
            state.stage = AuthStage::Authorized;
            Ok(())
        }
        Err(SignInError::InvalidPassword(token)) => {
            // Put the token back so the user can retry.
            state.stage = AuthStage::PasswordRequired { token };
            Err(AuthError::WrongPassword)
        }
        Err(e) => Err(AuthError::Unknown(e.to_string())),
    }
}

/// Returns a clone of the `Client` if currently in the `Authorized` state, or `None`.
pub async fn get_client() -> Option<Client> {
    let guard = global().lock().await;
    match &*guard {
        Some(state) if matches!(state.stage, AuthStage::Authorized) => Some(state.client.clone()),
        _ => None,
    }
}

/// Returns `true` if the client is in the `Authorized` state.
pub async fn is_authorized() -> Result<bool, AuthError> {
    let guard = global().lock().await;
    match &*guard {
        Some(state) => Ok(matches!(state.stage, AuthStage::Authorized)),
        None => Ok(false),
    }
}
