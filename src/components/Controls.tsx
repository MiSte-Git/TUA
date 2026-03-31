import type { ChatInfo } from "../types";

interface Props {
  chatInfo: ChatInfo | null;
  months: number;
  onStart: () => void;
  onStop: () => void;
  analyzing: boolean;
  includeReactions: boolean;
  onToggleReactions: (v: boolean) => void;
  minMessages: number;
  minReactions: number;
  onChangeMinMessages: (v: number) => void;
  onChangeMinReactions: (v: number) => void;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`relative w-11 h-6 rounded-full border border-[#3a3a5a] transition-colors cursor-pointer ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      } ${checked ? "bg-[#7c6af7]" : "bg-[#2a2a3e]"}`}
      onClick={disabled ? undefined : onChange}
    >
      <div
        className={`absolute top-0.5 h-5 w-5 rounded-full transition-transform duration-200 ${
          checked ? "translate-x-5 bg-white" : "translate-x-0.5 bg-[#888aaa]"
        }`}
      />
    </div>
  );
}

const numInputClass =
  "bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-2 py-1 rounded text-[#e0e0f0] text-sm w-16 text-right disabled:opacity-50";

export default function Controls({
  chatInfo,
  onStart,
  onStop,
  analyzing,
  includeReactions,
  onToggleReactions,
  minMessages,
  minReactions,
  onChangeMinMessages,
  onChangeMinReactions,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
        Optionen
      </label>

      {/* Reactions toggle */}
      <div className="flex items-center gap-3">
        <Toggle
          checked={includeReactions}
          onChange={() => onToggleReactions(!includeReactions)}
          disabled={analyzing}
        />
        <span className="text-[#e0e0f0] text-sm select-none">Reaktionen einbeziehen</span>
      </div>

      {/* Activity thresholds */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#888aaa] text-sm">Mindest-Nachrichten</span>
          <input
            type="number"
            min={0}
            value={minMessages}
            onChange={(e) =>
              onChangeMinMessages(Math.max(0, parseInt(e.target.value, 10) || 0))
            }
            disabled={analyzing}
            className={numInputClass}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#888aaa] text-sm">Mindest-Reaktionen</span>
          <input
            type="number"
            min={0}
            value={minReactions}
            onChange={(e) =>
              onChangeMinReactions(Math.max(0, parseInt(e.target.value, 10) || 0))
            }
            disabled={analyzing}
            className={numInputClass}
          />
        </div>
        <p className="text-[#3a3a5a] text-xs">
          Mitglieder darunter gelten als inaktiv
        </p>
      </div>

      {/* Start / Stop */}
      {!analyzing ? (
        <button
          onClick={onStart}
          disabled={!chatInfo}
          className="w-full bg-[#4caf7c] hover:bg-[#3d9e6d] text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Analyse starten
        </button>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-[#1e1e2e] rounded-lg px-3 py-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[#7c6af7] animate-pulse" />
            <span className="text-[#888aaa] text-sm">Analyse läuft…</span>
          </div>
          <button
            onClick={onStop}
            className="bg-[#e05555] hover:bg-[#c94444] text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Stopp
          </button>
        </div>
      )}
    </div>
  );
}
