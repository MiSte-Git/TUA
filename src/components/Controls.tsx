import { useTranslation } from "react-i18next";
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
  minPollParticipations: number;
  onChangeMinMessages: (v: number) => void;
  onChangeMinReactions: (v: number) => void;
  onChangeMinPollParticipations: (v: number) => void;
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

/**
 * Number field with explicit -/+ buttons. Replaces the native number spinner,
 * whose auto-repeat counted twice per click when re-rendering was slow.
 */
function NumberStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const btn =
    "w-7 h-7 flex items-center justify-center text-[#e0e0f0] bg-[#1e1e2e] hover:bg-[#3a3a5e] disabled:opacity-50 disabled:cursor-not-allowed select-none transition-colors";
  return (
    <div className="flex items-stretch border border-[#3a3a5a] rounded overflow-hidden focus-within:border-[#7c6af7]">
      <button
        type="button"
        className={btn}
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={disabled || value <= 0}
        aria-label="-1"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits === "" ? 0 : Math.max(0, parseInt(digits, 10)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onChange(value + 1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onChange(Math.max(0, value - 1));
          }
        }}
        disabled={disabled}
        className="bg-[#1e1e2e] outline-none px-1 text-[#e0e0f0] text-sm w-12 text-center tabular-nums border-x border-[#3a3a5a] disabled:opacity-50"
      />
      <button
        type="button"
        className={btn}
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        aria-label="+1"
      >
        +
      </button>
    </div>
  );
}

export default function Controls({
  chatInfo,
  onStart,
  onStop,
  analyzing,
  includeReactions,
  onToggleReactions,
  minMessages,
  minReactions,
  minPollParticipations,
  onChangeMinMessages,
  onChangeMinReactions,
  onChangeMinPollParticipations,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
        {t("controls.label")}
      </label>

      {/* Reactions toggle */}
      <div className="flex items-center gap-3">
        <Toggle
          checked={includeReactions}
          onChange={() => onToggleReactions(!includeReactions)}
          disabled={analyzing}
        />
        <span className="text-[#e0e0f0] text-sm select-none">
          {t("controls.include_reactions")}
        </span>
      </div>

      {/* Activity thresholds */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#888aaa] text-sm">{t("controls.min_messages")}</span>
          <NumberStepper value={minMessages} onChange={onChangeMinMessages} disabled={analyzing} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#888aaa] text-sm">{t("controls.min_reactions")}</span>
          <NumberStepper value={minReactions} onChange={onChangeMinReactions} disabled={analyzing} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[#888aaa] text-sm">{t("controls.min_poll_participations")}</span>
          <NumberStepper value={minPollParticipations} onChange={onChangeMinPollParticipations} disabled={analyzing} />
        </div>
        <p className="text-[#3a3a5a] text-xs">{t("controls.threshold_hint")}</p>
      </div>

      {/* Start / Stop */}
      {!analyzing ? (
        <button
          onClick={onStart}
          disabled={!chatInfo}
          className="w-full bg-[#4caf7c] hover:bg-[#3d9e6d] text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("controls.start")}
        </button>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-[#1e1e2e] rounded-lg px-3 py-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[#7c6af7] animate-pulse" />
            <span className="text-[#888aaa] text-sm">{t("controls.analyzing")}</span>
          </div>
          <button
            onClick={onStop}
            className="bg-[#e05555] hover:bg-[#c94444] text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            ✕ {t("controls.stop")}
          </button>
        </div>
      )}
    </div>
  );
}
