import i18n from "../i18n";

/**
 * Texte fuer die Kommentarzeilen im CSV-Export (Abschnitt `csv` der
 * Uebersetzungen) als flache Map fuer das Backend. Platzhalter `{{name}}`
 * ersetzt das Backend. Fehlende Texte fallen auf Deutsch zurueck.
 * `periodMonths` loest die Pluralform fuer "letzte N Monate" schon hier auf.
 */
export function csvLabels(periodMonths?: number): Record<string, string> {
  const lang = i18n.resolvedLanguage ?? "de";
  const base = (i18n.getResource("de", "translation", "csv") ?? {}) as Record<string, string>;
  const own = (i18n.getResource(lang, "translation", "csv") ?? {}) as Record<string, string>;
  const labels: Record<string, string> = { ...base, ...own };
  if (periodMonths !== undefined) {
    labels.period_months = i18n.t("csv.period_months", { count: periodMonths });
  }
  return labels;
}
