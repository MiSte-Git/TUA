import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { AppPhase, AnalysisResult, ChatInfo } from "../types";
import ChatInput from "./ChatInput";
import PeriodSelector from "./PeriodSelector";
import Controls from "./Controls";
import ResultsTable from "./ResultsTable";

interface Props {
  chatInfo: ChatInfo | null;
  setChatInfo: (c: ChatInfo | null) => void;
  result: AnalysisResult | null;
  setResult: (r: AnalysisResult | null) => void;
  setLogs: React.Dispatch<React.SetStateAction<string[]>>;
  setProgress: (p: number) => void;
  phase: AppPhase;
  setPhase: (p: AppPhase) => void;
}

export default function MainView({
  setChatInfo,
  result,
  setResult,
  setProgress,
  setPhase,
}: Props) {
  const [localChatInfo, setLocalChatInfo] = useState<ChatInfo | null>(null);
  const [chatUrl, setChatUrl] = useState("");
  const [months, setMonths] = useState(3);
  const [includeReactions, setIncludeReactions] = useState(true);
  const [minMessages, setMinMessages] = useState(1);
  const [minReactions, setMinReactions] = useState(0);
  const [excludedUserIds, setExcludedUserIds] = useState<Set<number>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const cancelledRef = useRef(false);

  function handleResolved(chat: ChatInfo, url: string) {
    setLocalChatInfo(chat);
    setChatInfo(chat);
    setChatUrl(url);
    // Clear previous results when switching chats
    setResult(null);
    setExcludedUserIds(new Set());
  }

  function handleToggleExcluded(userId: number) {
    setExcludedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function handleStart() {
    cancelledRef.current = false;
    setAnalyzing(true);
    setPhase("analyzing");
    setProgress(0);
    setExcludedUserIds(new Set());
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
      }
    }
  }

  function handleStop() {
    cancelledRef.current = true;
    setAnalyzing(false);
    setPhase("main");
    setProgress(0);
  }

  async function handleExport() {
    if (!result || !localChatInfo) return;
    try {
      const suggested = await invoke<string>("suggested_filename", {
        chatInfo: localChatInfo,
      });
      const path = await save({
        defaultPath: suggested,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path) {
        await invoke("export_csv", {
          result,
          chatInfo: localChatInfo,
          path,
          minMessages,
          minReactions,
          excludedUserIds: Array.from(excludedUserIds),
        });
      }
    } catch (_e) {
      // ignore cancel
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      {/* Chat input */}
      <div className="bg-[#2a2a3e] rounded-xl p-4">
        <ChatInput onResolved={handleResolved} disabled={analyzing} />
      </div>

      {/* Period selector */}
      <div className="bg-[#2a2a3e] rounded-xl p-4">
        <PeriodSelector value={months} onChange={setMonths} disabled={analyzing} />
      </div>

      {/* Controls + Statistik */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#2a2a3e] rounded-xl p-4">
          <Controls
            chatInfo={localChatInfo}
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
        <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-2">
          <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
            Statistik
          </p>
          {result ? (
            <>
              <p className="text-[#e0e0f0] text-sm">
                <span className="text-[#7c6af7] font-semibold">
                  {result.total_messages.toLocaleString("de-CH")}
                </span>
                {" Nachrichten"}
              </p>
              <p className="text-[#888aaa] text-sm">
                {result.members.length} aktive Mitglieder
              </p>
              <p className="text-[#888aaa] text-sm">
                Zeitraum: {result.period_months} Monate
              </p>
              {excludedUserIds.size > 0 && (
                <p className="text-[#e05555] text-sm">
                  {excludedUserIds.size} ausgeschlossen
                </p>
              )}
              <button
                onClick={handleExport}
                className="mt-auto bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
              >
                ↓ CSV exportieren
              </button>
            </>
          ) : (
            <p className="text-[#3a3a5a] text-sm">—</p>
          )}
        </div>
      </div>

      {/* Results table */}
      <ResultsTable
        result={result}
        includeReactions={includeReactions}
        minMessages={minMessages}
        minReactions={minReactions}
        excludedUserIds={excludedUserIds}
        onToggleExcluded={handleToggleExcluded}
      />
    </div>
  );
}
