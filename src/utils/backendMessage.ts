import i18n from "../i18n";

/**
 * Meldungen aus dem Rust-Backend (Log-Zeilen, Fehler) kommen als JSON
 * `{"k": "<i18n-Schluessel>", "p": {<Parameter>}}` und werden hier in der
 * aktuellen Sprache dargestellt. Parameter, die selbst so kodiert sind,
 * werden rekursiv uebersetzt. Alles andere (z. B. Fehlertexte von Telegram)
 * bleibt unveraendert.
 */
interface Encoded {
  k: string;
  p?: Record<string, unknown>;
}

function decode(s: string): Encoded | null {
  if (!s.startsWith('{"k":')) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o.k === "string" ? (o as Encoded) : null;
  } catch {
    return null;
  }
}

export function translateBackend(raw: unknown): string {
  const s = typeof raw === "string" ? raw : String(raw);
  const enc = decode(s);
  if (!enc) return s;
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(enc.p ?? {})) {
    params[key] = typeof value === "string" ? translateBackend(value) : value;
  }
  return i18n.t(enc.k, params);
}

/** true, wenn der Fehler ein vom Benutzer abgebrochener Vorgang ist. */
export function isCancelled(raw: unknown): boolean {
  return decode(typeof raw === "string" ? raw : String(raw))?.k === "backend.cancelled";
}
