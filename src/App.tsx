import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import LoginFlow from "./components/LoginFlow";
import LogWindow from "./components/LogWindow";
import MainView from "./components/MainView";
import FirstMentionView from "./components/FirstMentionView";
import BotList from "./components/BotList";
import ChatUrlInput from "./components/ChatUrlInput";
import StatusBar from "./components/StatusBar";
import LanguageSelector from "./components/LanguageSelector";
import type { AppPhase, AnalysisResult, ChatInfo } from "./types";
import { invoke } from "@tauri-apps/api/core";

type ActiveTab = "analysis" | "first_mention" | "bots";

export default function App() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<AppPhase>("checking");
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);
  const [chatUrl, setChatUrl] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [scannedMessages, setScannedMessages] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>("analysis");
  const [notABot, setNotABot] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!chatInfo) { setNotABot(new Map()); return; }
    try {
      const stored = localStorage.getItem(`not_a_bot_${chatInfo.id}`);
      if (stored) {
        const arr: { user_id: number; name: string }[] = JSON.parse(stored);
        setNotABot(new Map(arr.map((e) => [e.user_id, e.name])));
      } else {
        setNotABot(new Map());
      }
    } catch {
      setNotABot(new Map());
    }
  }, [chatInfo?.id]);

  function toggleNotABot(userId: number, name: string) {
    if (!chatInfo) return;
    const id = chatInfo.id;
    setNotABot((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) next.delete(userId);
      else next.set(userId, name);
      const arr = Array.from(next.entries()).map(([user_id, n]) => ({ user_id, name: n }));
      localStorage.setItem(`not_a_bot_${id}`, JSON.stringify(arr));
      return next;
    });
  }

  useEffect(() => {
    invoke<boolean>("get_auth_status")
      .then((authorized) => setPhase(authorized ? "main" : "login"))
      .catch(() => setPhase("login"));
  }, []);

  useEffect(() => {
    const unlisten1 = listen<string>("log", (e) =>
      setLogs((prev) => [...prev.slice(-499), e.payload])
    );
    const unlisten2 = listen<number>("progress", (e) =>
      setProgress(e.payload)
    );
    const unlisten3 = listen<number>("message_count", (e) =>
      setScannedMessages(e.payload)
    );
    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlisten3.then((f) => f());
    };
  }, []);

  function handleChatResolved(chat: ChatInfo, url: string) {
    setChatInfo(chat);
    setChatUrl(url);
    setResult(null);
  }

  const connected = phase === "main" || phase === "analyzing";

  if (phase === "checking") {
    return (
      <div className="min-h-screen bg-[#1e1e2e] flex items-center justify-center">
        <p className="text-[#888aaa] animate-pulse">Verbinde…</p>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="min-h-screen bg-[#1e1e2e] flex flex-col pb-9">
        <div className="flex-1 flex items-center justify-center p-6">
          <LoginFlow onSuccess={() => setPhase("main")} />
        </div>
        <StatusBar connected={false} progress={0} scannedMessages={0} />
      </div>
    );
  }

  const tabBase =
    "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px";
  const tabActive = "text-[#7c6af7] border-[#7c6af7]";
  const tabInactive = "text-[#888aaa] border-transparent hover:text-[#e0e0f0]";

  return (
    <div className="min-h-screen bg-[#1e1e2e] flex flex-col text-[#e0e0f0] pb-9">
      <main className="flex-1 flex flex-col gap-4 p-4 overflow-hidden">

        {/* Shared Chat-URL input — always visible */}
        <div className="bg-[#2a2a3e] rounded-xl p-4">
          <ChatUrlInput
            onChatResolved={handleChatResolved}
            disabled={phase === "analyzing"}
          />
        </div>

        {/* Tab bar + language selector */}
        <div className="flex items-center border-b border-[#3a3a5a]">
          <button
            onClick={() => setActiveTab("analysis")}
            className={`${tabBase} ${activeTab === "analysis" ? tabActive : tabInactive}`}
          >
            {t("tabs.analysis")}
          </button>
          <button
            onClick={() => setActiveTab("first_mention")}
            className={`${tabBase} ${activeTab === "first_mention" ? tabActive : tabInactive}`}
          >
            {t("tabs.first_mention")}
          </button>
          {result && result.all_bots.length > 0 && (
            <button
              onClick={() => setActiveTab("bots")}
              className={`${tabBase} ${activeTab === "bots" ? tabActive : tabInactive}`}
            >
              {t("tabs.bots")}
            </button>
          )}
          <div className="ml-auto pr-1">
            <LanguageSelector />
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "analysis" && (
          <MainView
            chatInfo={chatInfo}
            chatUrl={chatUrl}
            result={result}
            setResult={setResult}
            setProgress={setProgress}
            setScannedMessages={setScannedMessages}
            phase={phase}
            setPhase={setPhase}
            notABot={notABot}
            clearLogs={() => setLogs([])}
            onSwitchToBotsTab={
              result && result.all_bots.length > 0
                ? () => setActiveTab("bots")
                : undefined
            }
          />
        )}
        {activeTab === "first_mention" && (
          <FirstMentionView
            chatId={chatInfo?.id}
            chatUsername={chatInfo?.username}
          />
        )}
        {activeTab === "bots" && (
          <BotList
            bots={result?.all_bots ?? []}
            notABot={notABot}
            onToggleNotABot={toggleNotABot}
          />
        )}

        <LogWindow logs={logs} />
      </main>
      <StatusBar connected={connected} progress={progress} scannedMessages={scannedMessages} analyzing={phase === "analyzing"} />
    </div>
  );
}
