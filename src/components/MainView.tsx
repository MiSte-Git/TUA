import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AppPhase, AnalysisResult, ChatInfo } from "../types";
import PeriodSelector from "./PeriodSelector";
import Controls from "./Controls";
import ResultsTable from "./ResultsTable";

interface Props {
  chatInfo: ChatInfo | null;
  chatUrl: string;
  result: AnalysisResult | null;
  setResult: (r: AnalysisResult | null) => void;
  setProgress: (p: number) => void;
  setScannedMessages: (n: number) => void;
  phase: AppPhase;
  setPhase: (p: AppPhase) => void;
}

const EXCLUDED_KEY = (chatId: number) => `excluded_members_${chatId}`;

function loadExcluded(chatId: number): Map<number, string> {
  try {
    const stored = localStorage.getItem(EXCLUDED_KEY(chatId));
    if (!stored) return new Map();
    const arr: { user_id: number; name: string }[] = JSON.parse(stored);
    return new Map(arr.map((e) => [e.user_id, e.name]));
  } catch {
    return new Map();
  }
}

function saveExcluded(chatId: number, map: Map<number, string>) {
  const arr = Array.from(map.entries()).map(([user_id, name]) => ({ user_id, name }));
  localStorage.setItem(EXCLUDED_KEY(chatId), JSON.stringify(arr));
}

function fmt(n: number) {
  return n.toLocaleString("de-CH");
}

function StatRow({
  label,
  value,
  badge,
  highlight,
}: {
  label: string;
  value: string | number;
  badge?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className={`text-sm ${highlight ? "text-[#e0e0f0] font-medium" : "text-[#888aaa]"}`}>
        {label}
      </span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className={`text-sm font-semibold ${highlight ? "text-[#7c6af7]" : "text-[#e0e0f0]"}`}>
          {value}
        </span>
        {badge && (
          <span className="text-[#888aaa] text-xs whitespace-nowrap">{badge}</span>
        )}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#3a3a5a] my-1" />;
}

export default function MainView({
  chatInfo,
  chatUrl,
  result,
  setResult,
  setProgress,
  setScannedMessages,
  setPhase,
}: Props) {
  const [months, setMonths] = useState(3);
  const [includeReactions, setIncludeReactions] = useState(true);
  const [minMessages, setMinMessages] = useState(1);
  const [minReactions, setMinReactions] = useState(0);
  const [excludedMembers, setExcludedMembers] = useState<Map<number, string>>(new Map());
  const [analyzing, setAnalyzing] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!chatInfo) return;
    setExcludedMembers(loadExcluded(chatInfo.id));
  }, [chatInfo?.id]);

  function handleToggleExcluded(userId: number, name: string) {
    setExcludedMembers((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.set(userId, name);
      }
      if (chatInfo) {
        saveExcluded(chatInfo.id, next);
      }
      return next;
    });
  }

  async function handleStart() {
    cancelledRef.current = false;
    setAnalyzing(true);
    setPhase("analyzing");
    setProgress(0);
    try {
      const res = await invoke<AnalysisResult>("run_analysis", {
        chatUrl,
        months,
        includeReactions,
      });
      if (!cancelledRef.current) {
        setResult(res);
      }
    } catch (_e) {
      // errors arrive via Rust → 'log' event
    } finally {
      if (!cancelledRef.current) {
        setAnalyzing(false);
        setPhase("main");
        setProgress(0);
        setScannedMessages(0);
      }
    }
  }

  function handleStop() {
    cancelledRef.current = true;
    setAnalyzing(false);
    setPhase("main");
    setProgress(0);
    setScannedMessages(0);
  }

  async function handleExport() {
    if (!result || !chatInfo) return;
    try {
      const suggested = await invoke<string>("suggested_filename", {
        chatInfo,
      });
      const path = await save({
        defaultPath: suggested,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path) {
        await invoke("export_csv", {
          result,
          chatInfo,
          path,
          minMessages,
          minReactions,
          excludedIds: Array.from(excludedMembers.keys()),
        });
      }
    } catch (_e) {
      // ignore cancel
    }
  }

  // ── Statistics calculations (A – B – C) ─────────────────────────────────────
  const members = result?.members ?? [];
  const totalMembers = chatInfo?.member_count ?? members.length;

  const A = result?.members_with_messages ?? 0;
  const B = members.filter((m) => m.message_count <= minMessages).length;
  const C = members.filter(
    (m) => m.message_count > minMessages && excludedMembers.has(m.user_id)
  ).length;
  const trulyActive = A - B - C;

  const activePercent =
    totalMembers > 0 ? ((trulyActive / totalMembers) * 100).toFixed(1) : "0.0";
  const writtenPercent =
    totalMembers > 0 ? ((A / totalMembers) * 100).toFixed(1) : "0.0";
  const totalMessages = members.reduce((sum, m) => sum + m.message_count, 0);

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      {/* Period selector */}
      <div className="bg-[#2a2a3e] rounded-xl p-4">
        <PeriodSelector value={months} onChange={setMonths} disabled={analyzing} />
      </div>

      {/* Controls + Statistik */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#2a2a3e] rounded-xl p-4">
          <Controls
            chatInfo={chatInfo}
            months={months}
            onStart={handleStart}
            onStop={handleStop}
            analyzing={analyzing}
            includeReactions={includeReactions}
            onToggleReactions={setIncludeReactions}
            minMessages={minMessages}
            minReactions={minReactions}
            onChangeMinMessages={setMinMessages}
            onChangeMinReactions={setMinReactions}
          />
        </div>

        {/* Statistik */}
        <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-2">
          <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
            Statistik
          </p>
          {result ? (
            <>
              <Divider />
              <StatRow label="Mitglieder gesamt" value={fmt(totalMembers)} />
              <Divider />
              <StatRow
                label="Haben geschrieben"
                value={fmt(A)}
                badge={`(${writtenPercent}%)`}
              />
              {B > 0 && (
                <StatRow
                  label={`≤ ${minMessages} Nachrichten`}
                  value={`–${fmt(B)}`}
                  badge="(→ inaktiv)"
                />
              )}
              {C > 0 && (
                <StatRow
                  label="Manuell ausgeschlossen"
                  value={`–${fmt(C)}`}
                  badge="(→ inaktiv)"
                />
              )}
              <Divider />
              <StatRow
                label="Wirklich aktiv"
                value={fmt(trulyActive)}
                badge={`(${activePercent}%)`}
                highlight
              />
              <Divider />
              <StatRow label="Nachrichten gesamt" value={fmt(totalMessages)} />
              <StatRow label="Zeitraum" value={`${result.period_months} Monate`} />
              <button
                onClick={handleExport}
                className="mt-auto bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
              >
                ↓ CSV exportieren
              </button>
            </>
          ) : (
            <p className="text-[#3a3a5a] text-sm">Noch keine Analyse durchgeführt</p>
          )}
        </div>
      </div>

      {/* Results table */}
      <ResultsTable
        result={result}
        includeReactions={includeReactions}
        minMessages={minMessages}
        minReactions={minReactions}
        excludedMembers={excludedMembers}
        onToggleExcluded={handleToggleExcluded}
      />
    </div>
  );
}
