import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getTauriVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { open } from "@tauri-apps/plugin-shell";

const REPO_URL = "https://github.com/MiSte-Git/TUA";
const RELEASES_URL = `${REPO_URL}/releases`;

interface AppPaths {
  config: string;
  session: string;
  cache: string;
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string }
  | { kind: "error"; message: string };

interface Props {
  version: string;
  onClose: () => void;
}

export default function AboutDialog({ version, onClose }: Props) {
  const { t } = useTranslation();
  const [tauriVersion, setTauriVersion] = useState<string>("");
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    getTauriVersion().then(setTauriVersion).catch(() => {});
    invoke<AppPaths>("app_paths").then(setPaths).catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function checkForUpdate() {
    setUpdate({ kind: "checking" });
    try {
      const found = await check();
      setUpdate(found ? { kind: "available", version: found.version } : { kind: "latest" });
    } catch (e) {
      setUpdate({ kind: "error", message: String(e) });
    }
  }

  const link = "text-[#7c6af7] hover:text-[#a090ff] underline";

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#2a2a3e] border border-[#3a3a5a] rounded-xl p-6 w-[34rem] max-w-full max-h-[90vh] overflow-auto shadow-2xl flex flex-col gap-4 text-sm text-[#c8c8e0]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#7c6af7]">Telegram User Activities</h2>
            <p className="text-[#e0e0f0] mt-0.5">
              {t("about.version")} <span className="font-semibold tabular-nums">{version || "–"}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#888aaa] hover:text-[#e0e0f0] text-lg leading-none px-1"
            aria-label={t("about.close")}
          >
            ✕
          </button>
        </div>

        <p>{t("about.description")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={checkForUpdate}
            disabled={update.kind === "checking"}
            className="bg-[#7c6af7] hover:bg-[#6a58e0] text-white font-semibold text-sm py-1.5 px-3 rounded-lg transition-colors disabled:opacity-50"
          >
            {update.kind === "checking" ? t("about.checking") : t("about.check_update")}
          </button>
          {update.kind === "latest" && (
            <span className="text-green-400 text-xs">{t("about.up_to_date")}</span>
          )}
          {update.kind === "available" && (
            <span className="text-amber-400 text-xs">
              {t("about.update_available", { version: update.version })}{" "}
              <button className={link} onClick={() => open(RELEASES_URL)}>
                {t("about.download")}
              </button>
            </span>
          )}
          {update.kind === "error" && (
            <span className="text-[#e05555] text-xs">{t("about.check_failed")}</span>
          )}
        </div>

        <div className="border-t border-[#3a3a5a] pt-3 flex flex-col gap-1">
          <div className="flex gap-4">
            <button className={link} onClick={() => open(REPO_URL)}>
              {t("about.source")}
            </button>
            <button className={link} onClick={() => open(RELEASES_URL)}>
              {t("about.releases")}
            </button>
            <button className={link} onClick={() => open(`${REPO_URL}/issues`)}>
              {t("about.issues")}
            </button>
          </div>
        </div>

        {paths && (
          <div className="border-t border-[#3a3a5a] pt-3 flex flex-col gap-1.5">
            <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
              {t("about.storage")}
            </p>
            {(
              [
                ["about.path_config", paths.config],
                ["about.path_session", paths.session],
                ["about.path_cache", paths.cache],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="text-xs">
                <span className="text-[#888aaa]">{t(key)}: </span>
                <span className="font-mono break-all select-text text-[#e0e0f0]">{value}</span>
              </div>
            ))}
            <p className="text-[#888aaa] text-xs mt-1">{t("about.privacy")}</p>
          </div>
        )}

        <p className="border-t border-[#3a3a5a] pt-3 text-[#888aaa] text-xs">
          {t("about.built_with")}
          {tauriVersion ? ` (Tauri ${tauriVersion})` : ""}
        </p>
      </div>
    </div>
  );
}
