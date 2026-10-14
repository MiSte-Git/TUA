//! Sofortiges Abbrechen laufender Telegram-Vorgänge.
//!
//! Die bisherigen AtomicBool-Flags werden nur zwischen zwei Telegram-Anfragen
//! geprüft. Hängt eine einzelne Anfrage (z. B. wegen einer Telegram-Wartezeit
//! nach FLOOD_WAIT), reagiert die App erst nach Minuten. Hier wird der
//! laufende Vorgang stattdessen per `tokio::select!` sofort verworfen.

use once_cell::sync::Lazy;
use std::future::Future;
use tauri::Emitter;
use tokio::sync::watch;

#[derive(Clone, Copy)]
pub enum Kind {
    /// Aktivitäts-Analyse (Tab Analyse)
    Analysis = 0,
    /// Erste Erwähnung und Ein-/Austrittssuche
    Mention = 1,
    /// Laden der Mitgliederliste
    Members = 2,
    /// Chat-URL auflösen (Verbinden)
    Resolve = 3,
}

static CHANNELS: Lazy<[watch::Sender<u64>; 4]> =
    Lazy::new(|| std::array::from_fn(|_| watch::channel(0u64).0));

/// Bricht alle aktuell laufenden Vorgänge dieser Art ab.
pub fn cancel(kind: Kind) {
    CHANNELS[kind as usize].send_modify(|v| *v = v.wrapping_add(1));
}

/// Führt `fut` aus, bis er fertig ist oder `cancel(kind)` aufgerufen wird.
/// Bei Abbruch wird `log_msg` ins Log geschrieben und `i18n::cancelled()` geliefert.
pub async fn run<T, F>(kind: Kind, app: &tauri::AppHandle, log_msg: &str, fut: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let mut rx = CHANNELS[kind as usize].subscribe();
    tokio::select! {
        res = fut => res,
        _ = rx.changed() => {
            let _ = app.emit("log", log_msg.to_string());
            Err(crate::i18n::cancelled())
        }
    }
}
