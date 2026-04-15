import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type { AppPhase, AnalysisResult, ChatInfo } from "../types";
import PeriodSelector from "./PeriodSelector";
import Controls from "./Controls";
import ResultsTable from "./ResultsTable";
import Tooltip from "./Tooltip";

interface Props {
  chatInfo: ChatInfo | null;
  chatUrl: string;
  result: AnalysisResult | null;
  setResult: (r: AnalysisResult | null) => void;
  setProgress: (p: number) => void;
  setScannedMessages: (n: number) => void;
  phase: AppPhase;
  setPhase: (p: AppPhase) => void;
  notABot: Map<number, string>;
  onSwitchToBotsTab?: () => void;
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

function fmtDateShort(iso?: string | null) {
  if (!iso) return "?";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function StatRow({
  label,
  value,
  badge,
  highlight,
}: {
  label: string | React.ReactNode;
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
  notABot,
  onSwitchToBotsTab,
}: Props) {
  const { t } = useTranslation();
  const [months, setMonths] = useState(1); // 0 = custom
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(new Date());
  const [includeReactions, setIncludeReactions] = useState(false);
  const [includePolls, setIncludePolls] = useState(true);
  const [includeQuizzes, setIncludeQuizzes] = useState(false);
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
        includePolls,
        includeQuizzes,
        dateFrom: months === 0 ? (dateFrom ? dateFrom.toLocaleDateString("en-CA") : null) : null,
        dateTo: months === 0 ? (dateTo ? dateTo.toLocaleDateString("en-CA") : null) : null,
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
  const membersWithPollVotes = members.filter((m) => m.poll_participations > 0).length;
  const membersWithQuizVotes = members.filter((m) => m.quiz_participations > 0).length;
  const avgPollParticipation = result?.avg_poll_participation ?? 0;
  const avgQuizParticipation = result?.avg_quiz_participation ?? 0;
  const allBotCount = result?.all_bots?.length ?? 0;
  const notABotInChannel = result
    ? result.all_bots.filter((b) => notABot.has(b.user_id)).length
    : 0;
  const botCount = allBotCount - notABotInChannel;

  const periodLabel =
    result
      ? result.period_months > 0
        ? t("stats.period_months", { count: result.period_months })
        : `${fmtDateShort(result.period_from)} – ${fmtDateShort(result.period_to)}`
      : "";

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      {/* Period selector */}
      <div className="bg-[#2a2a3e] rounded-xl p-4">
        <PeriodSelector
          months={months}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChangeMonths={setMonths}
          onChangeDates={(from, to) => { setDateFrom(from); setDateTo(to); }}
          disabled={analyzing}
        />

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
            includePolls={includePolls}
            onTogglePolls={setIncludePolls}
            includeQuizzes={includeQuizzes}
            onToggleQuizzes={setIncludeQuizzes}
            minMessages={minMessages}
            minReactions={minReactions}
            onChangeMinMessages={setMinMessages}
            onChangeMinReactions={setMinReactions}
          />
        </div>

        {/* Statistik */}
        <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-2">
          <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
            {t("stats.label")}
          </p>
          {result ? (
            <>
              <Divider />
              <StatRow label={t("stats.total_members")} value={fmt(totalMembers)} />
              <Divider />
              <StatRow
                label={
                  <Tooltip text={t("tooltips.written")}>
                    <span>{t("stats.written")}</span>
                  </Tooltip>
                }
                value={fmt(A)}
                badge={`(${writtenPercent}%)`}
              />
              {B > 0 && (
                <StatRow
                  label={t("stats.below_threshold", { count: minMessages })}
                  value={`–${fmt(B)}`}
                  badge={t("stats.inactive")}
                />
              )}
              {C > 0 && (
                <StatRow
                  label={t("stats.excluded")}
                  value={`–${fmt(C)}`}
                  badge={t("stats.inactive")}
                />
              )}
              <Divider />
              <StatRow
                label={
                  <Tooltip text={t("tooltips.truly_active")}>
                    <span>{t("stats.truly_active")}</span>
                  </Tooltip>
                }
                value={fmt(trulyActive)}
                badge={`(${activePercent}%)`}
                highlight
              />
              <Divider />
              <StatRow label={t("stats.total_messages")} value={fmt(totalMessages)} />
              {(result.total_polls_in_period ?? 0) > 0 && (
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.total_polls")}>
                      <span>{t("stats.total_polls")}</span>
                    </Tooltip>
                  }
                  value={fmt(result.total_polls_in_period)}
                />
              )}
              {membersWithPollVotes > 0 && (
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.poll_participants")}>
                      <span>{t("stats.poll_participants")}</span>
                    </Tooltip>
                  }
                  value={fmt(membersWithPollVotes)}
                />
              )}
              {(result.total_polls_in_period ?? 0) > 0 && avgPollParticipation > 0 && (
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.avg_poll")}>
                      <span>{t("stats.avg_poll")}</span>
                    </Tooltip>
                  }
                  value={avgPollParticipation.toFixed(1)}
                />
              )}
              {(result.total_quizzes_in_period ?? 0) > 0 && (
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.total_quizzes")}>
                      <span>{t("stats.total_quizzes")}</span>
                    </Tooltip>
                  }
                  value={fmt(result.total_quizzes_in_period)}
                />
              )}
              {membersWithQuizVotes > 0 && (
                <StatRow
                  label={t("stats.quiz_participants")}
                  value={fmt(membersWithQuizVotes)}
                />
              )}
              {(result.total_quizzes_in_period ?? 0) > 0 && avgQuizParticipation > 0 && (
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.avg_quiz")}>
                      <span>{t("stats.avg_quiz")}</span>
                    </Tooltip>
                  }
                  value={avgQuizParticipation.toFixed(1)}
                />
              )}
              {allBotCount > 0 && (
                <div
                  className={`flex items-baseline justify-between gap-2 py-0.5 ${
                    onSwitchToBotsTab ? "cursor-pointer hover:opacity-80" : ""
                  }`}
                  onClick={onSwitchToBotsTab}
                  title={onSwitchToBotsTab ? "Bot-Tab öffnen" : undefined}
                >
                  <span className="text-sm text-[#888aaa]">
                    {t("stats.bots")}
                    {notABotInChannel > 0 && (
                      <span className="text-[#555570] ml-1">
                        {t("stats.bots_excluded_hint", { count: notABotInChannel })}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-semibold text-[#e0e0f0] tabular-nums">
                    {fmt(botCount)}
                    {onSwitchToBotsTab && (
                      <span className="text-[#7c6af7] ml-1 text-xs">→</span>
                    )}
                  </span>
                </div>
              )}
              <StatRow
                label={
                  <Tooltip text={t("tooltips.own_rights")}>
                    <span>{t("stats.own_rights")}</span>
                  </Tooltip>
                }
                value={
                  result.own_is_admin
                    ? t("stats.own_rights_admin")
                    : t("stats.own_rights_member")
                }
                highlight={result.own_is_admin}
              />
              <StatRow label={t("stats.period")} value={periodLabel} />
              <button
                onClick={handleExport}
                className="mt-auto bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
              >
                {t("stats.export_csv")}
              </button>
            </>
          ) : (
            <p className="text-[#3a3a5a] text-sm">{t("stats.no_analysis")}</p>
          )}
        </div>
      </div>

      {/* Results table */}
      <ResultsTable
        result={result}
        includeReactions={includeReactions}
        includePolls={includePolls}
        includeQuizzes={includeQuizzes}
        minMessages={minMessages}
        minReactions={minReactions}
        excludedMembers={excludedMembers}
        onToggleExcluded={handleToggleExcluded}
        notABot={notABot}
      />
    </div>
  );
}
