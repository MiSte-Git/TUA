import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { translateBackend } from "../utils/backendMessage";

interface Props {
  logs: string[];
}

export default function LogWindow({ logs }: Props) {
  // useTranslation sorgt dafuer, dass die Log-Zeilen beim Sprachwechsel neu
  // uebersetzt werden (sie werden roh gespeichert, siehe backendMessage.ts).
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Nur den Log-Container selbst scrollen. scrollIntoView() wuerde auch das
  // Fenster mitscrollen und beim Start die Seite nach unten ziehen.
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [logs]);

  return (
    <div
      ref={containerRef}
      className="bg-[#111120] rounded-xl p-3 font-mono text-sm text-[#a0ffa0] flex flex-col"
      style={{ resize: "vertical", overflow: "auto", minHeight: "80px", height: "200px" }}
    >
      {logs.length === 0 ? (
        <span className="text-[#3a3a5a] select-none">— {t("log.empty")} —</span>
      ) : (
        logs.map((line, i) => (
          <span key={i} className="leading-5 whitespace-pre-wrap break-all">
            {translateBackend(line)}
          </span>
        ))
      )}
    </div>
  );
}
