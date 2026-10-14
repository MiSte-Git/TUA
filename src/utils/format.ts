import i18n from "../i18n";

/** Locale for number formatting, following the selected UI language. */
export function numberLocale(): string {
  const lang = i18n.resolvedLanguage ?? "de";
  return lang === "de" ? "de-CH" : lang;
}

export function fmtNum(n: number): string {
  return n.toLocaleString(numberLocale());
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

/** Datum in der UI-Sprache, z. B. 14.10.2026 (de) oder 14/10/2026 (fr). */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString(numberLocale(), DATE_OPTS);
}

/** Datum und Uhrzeit in der UI-Sprache. */
export function fmtDateTime(d: Date): string {
  return `${fmtDate(d)} ${d.toLocaleTimeString(numberLocale(), TIME_OPTS)}`;
}

/** ISO-Datum (YYYY-MM-DD) ohne Zeitzonenverschiebung formatieren. */
export function fmtIsoDate(iso?: string | null): string {
  if (!iso) return "?";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return fmtDate(new Date(y, m - 1, d));
}
