import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Status = "idle" | "available" | "downloading" | "restarting" | "error" | "dismissed";

/**
 * Checks for app updates once on mount (GitHub Releases via tauri.conf.json
 * plugins.updater.endpoints) and, if one is found, shows a small dismissible
 * banner offering to download, install and relaunch. Failures (offline, no
 * release yet, dev build without a bundled pubkey) are swallowed silently -
 * this must never block normal use of the app.
 */
export default function UpdateBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    check()
      .then((found) => {
        if (found) {
          setUpdate(found);
          setStatus("available");
        }
      })
      .catch(() => {
        // Offline, no release published yet, etc. - not worth bothering the user.
      });
  }, []);

  async function install() {
    if (!update) return;
    setStatus("downloading");
    setError(null);
    try {
      await update.downloadAndInstall();
      setStatus("restarting");
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  if (status === "idle" || status === "dismissed") return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#7c6af7] text-white px-4 py-2 flex items-center gap-3 text-sm shadow-lg">
      {status === "available" && (
        <>
          <span className="flex-1">{t("update.available", { version: update?.version })}</span>
          <button
            onClick={install}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-md font-medium transition-colors"
          >
            {t("update.install")}
          </button>
          <button
            onClick={() => setStatus("dismissed")}
            className="text-white/80 hover:text-white px-2"
          >
            {t("update.dismiss")}
          </button>
        </>
      )}
      {status === "downloading" && <span>{t("update.downloading")}</span>}
      {status === "restarting" && <span>{t("update.restarting")}</span>}
      {status === "error" && (
        <span className="flex-1">
          {t("update.error")}
          {error ? `: ${error}` : ""}
        </span>
      )}
    </div>
  );
}
