//! Uebersetzbare Meldungen fuer das Frontend.
//!
//! Das Backend uebersetzt nicht selbst. Log-Zeilen und Fehlermeldungen werden
//! als JSON `{"k": "<i18n-Schluessel>", "p": {<Parameter>}}` geliefert und im
//! Frontend in der gewaehlten Sprache dargestellt (src/utils/backendMessage.ts).
//! Parameter, die selbst so kodiert sind, werden dort ebenfalls uebersetzt.

pub fn msg(key: &str, params: serde_json::Value) -> String {
    serde_json::json!({ "k": key, "p": params }).to_string()
}

/// Meldung fuer einen abgebrochenen Vorgang.
pub fn cancelled() -> String {
    msg("backend.cancelled", serde_json::json!({}))
}

pub fn is_cancelled(s: &str) -> bool {
    s.contains("\"backend.cancelled\"")
}

/// `tr!("backend.key")` oder `tr!("backend.key", name = wert, ...)`
macro_rules! tr {
    ($key:expr) => {
        $crate::i18n::msg($key, serde_json::json!({}))
    };
    ($key:expr, $($name:ident = $val:expr),+ $(,)?) => {{
        let mut p = serde_json::Map::new();
        $( p.insert(stringify!($name).to_string(), serde_json::json!($val)); )+
        $crate::i18n::msg($key, serde_json::Value::Object(p))
    }};
}
