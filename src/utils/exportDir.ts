const LAST_EXPORT_DIR_KEY = "last_csv_export_dir";

export function loadLastExportDir(): string | null {
  try {
    return localStorage.getItem(LAST_EXPORT_DIR_KEY);
  } catch {
    return null;
  }
}

export function saveLastExportDir(filePath: string) {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (lastSep > 0) {
    try {
      localStorage.setItem(LAST_EXPORT_DIR_KEY, filePath.substring(0, lastSep));
    } catch {
      // ignore
    }
  }
}

/** Heutiges Datum als YYYY-MM-DD (lokale Zeit). */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Wandelt TT.MM.JJJJ oder YYYY-MM-DD in YYYY-MM-DD um, sonst null. */
export function normalizeDate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const de = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
  if (de) return `${de[3]}-${de[2]}-${de[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}
