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
  clearLogs: () => void;
  onSwitchToBotsTab?: () => void;
}

const EXCLUDED_KEY = (chatId: number) => `excluded_members_${chatId}`;
const ST_KEY = (chatId: number) => `st_members_${chatId}`;

function loadMap(key: string): Map<number, string> {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return new Map();
    const arr: { user_id: number; name: string }[] = JSON.parse(stored);
    return new Map(arr.map((e) => [e.user_id, e.name]));
  } catch {
    return new Map();
  }
}

function saveMap(key: string, map: Map<number, string>) {
  const arr = Array.from(map.entries()).map(([user_id, name]) => ({ user_id, name }));
  localStorage.setItem(key, JSON.stringify(arr));
}

function loadExcluded(chatId: number) { return loadMap(EXCLUDED_KEY(chatId)); }
function saveExcluded(chatId: number, map: Map<number, string>) { saveMap(EXCLUDED_KEY(chatId), map); }
function loadST(chatId: number) { return loadMap(ST_KEY(chatId)); }
function saveST(chatId: number, map: Map<number, string>) { saveMap(ST_KEY(chatId), map); }

const LAST_EXPORT_DIR_KEY = "last_csv_export_dir";

function loadLastExportDir(): string | null {
  return localStorage.getItem(LAST_EXPORT_DIR_KEY);
}

function saveLastExportDir(filePath: string) {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (lastSep > 0) {
    localStorage.setItem(LAST_EXPORT_DIR_KEY, filePath.substring(0, lastSep));
  }
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
  clearLogs,
  onSwitchToBotsTab,
}: Props) {
  const { t } = useTranslation();
  const [months, setMonths] = useState(1); // 0 = custom
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(new Date());
  const [includeReactions, setIncludeReactions] = useState(false);
  const [minMessages, setMinMessages] = useState(1);
  const [minReactions, setMinReactions] = useState(0);
  const [minPollParticipations, setMinPollParticipations] = useState(0);
  const [excludedMembers, setExcludedMembers] = useState<Map<number, string>>(new Map());
  const [stMembers, setStMembers] = useState<Map<number, string>>(new Map());
  const [analyzing, setAnalyzing] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!chatInfo) return;
    setExcludedMembers(loadExcluded(chatInfo.id));
    setStMembers(loadST(chatInfo.id));
  }, [chatInfo?.id]);

  function handleToggleExcluded(userId: number, name: string) {
    setExcludedMembers((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.set(userId, name);
      }
      if (chatInfo) saveExcluded(chatInfo.id, next);
      return next;
    });
  }

  function handleToggleST(userId: number, name: string) {
    setStMembers((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.set(userId, name);
      }
      if (chatInfo) saveST(chatInfo.id, next);
      return next;
    });
  }

  async function handleStart() {
    cancelledRef.current = false;
    clearLogs();
    setAnalyzing(true);
    setPhase("analyzing");
    setProgress(0);
    try {
      const res = await invoke<AnalysisResult>("run_analysis", {
        chatUrl,
        months,
        includeReactions,
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
      const lastDir = loadLastExportDir();
      const defaultPath = lastDir ? `${lastDir}/${suggested}` : suggested;
      const path = await save({
        defaultPath,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (path) {
        saveLastExportDir(path);
        await invoke("export_csv", {
          result,
          chatInfo,
          path,
          minMessages,
          minReactions,
          excludedIds: Array.from(excludedMembers.keys()),
          stIds: Array.from(stMembers.keys()),
        });
      }
    } catch (_e) {
      // ignore cancel
    }
  }

  // ── Statistics calculations ──────────────────────────────────────────────────
  const members = result?.members ?? [];
  const totalMembers = chatInfo?.member_count ?? members.length;

  // Filter to current channel members only (excludes former members & external poll voters)
  const currentMembers = members.filter((m) => m.is_current_member);

  // A: all current members who wrote messages (including manually excluded)
  const A = currentMembers.filter((m) => m.message_count > 0).length;
  // B: current non-excluded members below threshold (but above 0)
  const B = currentMembers.filter(
    (m) => m.message_count > 0 && m.message_count < minMessages && !excludedMembers.has(m.user_id)
  ).length;
  // C_total: all manually excluded current members
  const C_total = currentMembers.filter((m) => excludedMembers.has(m.user_id)).length;
  // trulyActive: current non-excluded members at or above threshold
  const trulyActive = currentMembers.filter(
    (m) => m.message_count >= minMessages && !excludedMembers.has(m.user_id)
  ).length;

  const activePercent =
    totalMembers > 0 ? ((trulyActive / totalMembers) * 100).toFixed(1) : "0.0";
  const writtenPercent =
    totalMembers > 0 ? ((A / totalMembers) * 100).toFixed(1) : "0.0";
  const totalMessages = members.reduce((sum, m) => sum + m.message_count, 0);
  const membersWithQuizVotes = currentMembers.filter((m) => m.quiz_participations > 0).length;

  // ── ST stats ─────────────────────────────────────────────────────────────────
  const stMembersList = currentMembers.filter((m) => stMembers.has(m.user_id));
  const stCount = stMembersList.length;
  const stActive = stMembersList.filter(
    (m) => m.message_count >= minMessages && !excludedMembers.has(m.user_id)
  ).length;
  // Message totals (for ST %-share of messages, not member count)
  const stTotalMessages = stMembersList.reduce((s, m) => s + m.message_count, 0);
  const activeMessages = currentMembers
    .filter((m) => m.message_count >= minMessages && !excludedMembers.has(m.user_id))
    .reduce((s, m) => s + m.message_count, 0);
  const stActiveMessages = stMembersList
    .filter((m) => m.message_count >= minMessages && !excludedMembers.has(m.user_id))
    .reduce((s, m) => s + m.message_count, 0);
  // Poll participation totals
  const stTotalPollParticipations = stMembersList.reduce((s, m) => s + m.poll_participations, 0);
  const totalPollParticipations = currentMembers.reduce((s, m) => s + m.poll_participations, 0);
  const totalPollsInPeriod = result?.total_polls_in_period ?? 0;
  const avgPollParticipants = result?.avg_poll_participants ?? 0;
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

      {/* Controls (full width, above Statistik) */}
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
          minPollParticipations={minPollParticipations}
          onChangeMinMessages={setMinMessages}
          onChangeMinReactions={setMinReactions}
          onChangeMinPollParticipations={setMinPollParticipations}
        />
      </div>

      {/* Statistik (2 Spalten) */}
      <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-2">
        <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
          {t("stats.label")}
        </p>
        {result ? (
          <>
            <div className="flex gap-0">
              {/* Linke Spalte: Mitglieder-Aktivität */}
              <div className="flex-1 flex flex-col gap-0 border-r border-[#2a2a3a] pr-5">
                <StatRow label={t("stats.total_members")} value={fmt(totalMembers)} />
                <Divider />
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.written", { count: minMessages })}>
                      <span>{t("stats.written")}</span>
                    </Tooltip>
                  }
                  value={fmt(A)}
                  badge={`(${writtenPercent}%)`}
                />
                {B > 0 && (
                  <StatRow
                    label={
                      <Tooltip text={t("tooltips.below_threshold", { count: minMessages })}>
                        <span>{t("stats.below_threshold", { count: minMessages })}</span>
                      </Tooltip>
                    }
                    value={fmt(B)}
                    badge={t("stats.inactive")}
                  />
                )}
                {C_total > 0 && (
                  <StatRow
                    label={t("stats.excluded")}
                    value={fmt(C_total)}
                    badge={t("stats.inactive")}
                  />
                )}
                <Divider />
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.truly_active", { count: minMessages })}>
                      <span>{t("stats.truly_active")}</span>
                    </Tooltip>
                  }
                  value={fmt(trulyActive)}
                  badge={`(${activePercent}%)`}
                  highlight
                />
              </div>

              {/* Rechte Spalte: Nachrichten, Umfragen, Bots */}
              <div className="flex-1 flex flex-col gap-0 pl-5">
                <StatRow label={t("stats.total_messages")} value={fmt(totalMessages)} />
                {(result.total_polls_in_period ?? 0) > 0 && (
                  <>
                    <Divider />
                    <StatRow
                      label={
                        <Tooltip text={t("tooltips.total_polls")}>
                          <span>{t("stats.total_polls")}</span>
                        </Tooltip>
                      }
                      value={fmt(result.total_polls_in_period)}
                    />
                    {avgPollParticipants > 0 && (
                      <StatRow
                        label={
                          <Tooltip text={t("tooltips.avg_poll")}>
                            <span>{t("stats.avg_poll")}</span>
                          </Tooltip>
                        }
                        value={avgPollParticipants.toFixed(1)}
                      />
                    )}
                  </>
                )}
                {(result.total_quizzes_in_period ?? 0) > 0 && (
                  <>
                    <Divider />
                    <StatRow
                      label={
                        <Tooltip text={t("tooltips.total_quizzes")}>
                          <span>{t("stats.total_quizzes")}</span>
                        </Tooltip>
                      }
                      value={fmt(result.total_quizzes_in_period)}
                    />
                    {membersWithQuizVotes > 0 && (
                      <StatRow
                        label={t("stats.quiz_participants")}
                        value={fmt(membersWithQuizVotes)}
                      />
                    )}
                    {avgQuizParticipation > 0 && (
                      <StatRow
                        label={
                          <Tooltip text={t("tooltips.avg_quiz")}>
                            <span>{t("stats.avg_quiz")}</span>
                          </Tooltip>
                        }
                        value={avgQuizParticipation.toFixed(1)}
                      />
                    )}
                  </>
                )}
                {allBotCount > 0 && (
                  <>
                    <Divider />
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
                  </>
                )}
                <Divider />
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
              </div>
            </div>

            {/* ST-Statistik */}
            {stMembers.size > 0 && (
              <div className="border-t border-[#3a3a5a] pt-2 mt-1">
                <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide mb-1">
                  {t("stats.st_section")}
                </p>
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.st_total")}>
                      <span>{t("stats.st_total")}</span>
                    </Tooltip>
                  }
                  value={`${fmt(stCount)} von ${fmt(totalMembers)}`}
                  badge={totalMembers > 0 ? `(${((stCount / totalMembers) * 100).toFixed(1)}%)` : undefined}
                />
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.st_truly_active", { count: minMessages })}>
                      <span>{t("stats.st_truly_active")}</span>
                    </Tooltip>
                  }
                  value={`${fmt(stActive)} von ${fmt(trulyActive)}`}
                  badge={trulyActive > 0 ? `(${((stActive / trulyActive) * 100).toFixed(1)}%)` : undefined}
                />
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.st_messages_total")}>
                      <span>{t("stats.st_messages_total")}</span>
                    </Tooltip>
                  }
                  value={fmt(totalMessages)}
                  badge={totalMessages > 0 ? `davon ${((stTotalMessages / totalMessages) * 100).toFixed(1)}% ST` : undefined}
                />
                <StatRow
                  label={
                    <Tooltip text={t("tooltips.st_messages_active", { count: minMessages })}>
                      <span>{t("stats.st_messages_active", { count: minMessages })}</span>
                    </Tooltip>
                  }
                  value={fmt(activeMessages)}
                  badge={activeMessages > 0 ? `davon ${((stActiveMessages / activeMessages) * 100).toFixed(1)}% ST` : undefined}
                />
                {totalPollsInPeriod > 0 && totalPollParticipations > 0 && (
                  <StatRow
                    label={
                      <Tooltip text={t("tooltips.st_polls")}>
                        <span>{t("stats.st_polls")}</span>
                      </Tooltip>
                    }
                    value={fmt(totalPollParticipations)}
                    badge={`davon ${((stTotalPollParticipations / totalPollParticipations) * 100).toFixed(1)}% ST`}
                  />
                )}
              </div>
            )}

            <button
              onClick={handleExport}
              className="mt-2 bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
            >
              {t("stats.export_csv")}
            </button>
          </>
        ) : (
          <p className="text-[#3a3a5a] text-sm">{t("stats.no_analysis")}</p>
        )}
      </div>

      {/* Results table */}
      <ResultsTable
        result={result}
        includeReactions={includeReactions}
        minMessages={minMessages}
        minReactions={minReactions}
        minPollParticipations={minPollParticipations}
        excludedMembers={excludedMembers}
        onToggleExcluded={handleToggleExcluded}
        notABot={notABot}
        totalPollsInPeriod={totalPollsInPeriod}
        stMembers={stMembers}
        onToggleST={handleToggleST}
      />
    </div>
  );
}
