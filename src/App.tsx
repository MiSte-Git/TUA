import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import LoginFlow from "./components/LoginFlow";
import LogWindow from "./components/LogWindow";
import MainView from "./components/MainView";
import StatusBar from "./components/StatusBar";
import type { AppPhase, AnalysisResult, ChatInfo } from "./types";

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("checking");
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [scannedMessages, setScannedMessages] = useState<number>(0);

  // Check auth status on mount
  useEffect(() => {
    invoke<boolean>("get_auth_status")
      .then((authorized) => setPhase(authorized ? "main" : "login"))
      .catch(() => setPhase("login"));
  }, []);

  // Listen to backend events
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

  return (
    <div className="min-h-screen bg-[#1e1e2e] flex flex-col text-[#e0e0f0] pb-9">
      <main className="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
        <MainView
          chatInfo={chatInfo}
          setChatInfo={setChatInfo}
          result={result}
          setResult={setResult}
          setLogs={setLogs}
          setProgress={setProgress}
          setScannedMessages={setScannedMessages}
          phase={phase}
          setPhase={setPhase}
        />
        <LogWindow logs={logs} />
      </main>
      <StatusBar connected={connected} progress={progress} scannedMessages={scannedMessages} />
    </div>
  );
}
