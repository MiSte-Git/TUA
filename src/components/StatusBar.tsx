
interface Props {
  connected: boolean;
  progress: number;
  scannedMessages: number;
}

function fmt(n: number) {
  return n.toLocaleString("de-CH");
}

export default function StatusBar({ connected, progress, scannedMessages }: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#2a2a3e] border-t border-[#3a3a5a] px-4 py-1.5 flex items-center gap-3">
      {/* Connection indicator */}
      <span className={connected ? "text-green-400" : "text-red-400"}>
        {connected ? "●" : "○"}
      </span>
      <span className="text-[#888aaa] text-xs">
        {connected ? "Verbunden" : "Nicht verbunden"}
      </span>

      {/* Live message counter (visible while scanning) */}
      {scannedMessages > 0 && (
        <span className="text-[#888aaa] text-xs">
          Scanne Nachrichten… {fmt(scannedMessages)} bisher
        </span>
      )}

      {/* Progress bar (visible only when progress > 0) */}
      {progress > 0 && (
        <div className="flex-1 flex items-center gap-2 ml-2">
          <div className="flex-1 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#7c6af7] transition-all duration-300"
              style={{ width: `${Math.min(progress / 10, 100)}%` }}
            />
          </div>
          <span className="text-[#888aaa] text-xs tabular-nums">{progress}</span>
        </div>
      )}
    </div>
  );
}
