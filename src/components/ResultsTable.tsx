import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { AnalysisResult, MemberActivity, UserOnlineStatus } from "../types";
import Tooltip from "./Tooltip";
import { fmtNum, fmtDate as fmtDay, fmtDateTime as fmtDayTime } from "../utils/format";
import { translateBackend } from "../utils/backendMessage";

interface Props {
  result: AnalysisResult | null;
  includeReactions: boolean;
  minMessages: number;
  minPollParticipations: number;
  excludedMembers: Map<number, string>;
  onToggleExcluded: (userId: number, name: string) => void;
  notABot: Map<number, string>;
  totalPollsInPeriod: number;
  stMembers: Map<number, string>;
  onToggleST: (userId: number, name: string) => void;
}

type SortKey = keyof Pick<MemberActivity, "name" | "joined_date" | "message_count" | "reaction_count" | "poll_participations" | "quiz_participations" | "last_message_date"> | "poll_pct";
type SortDir = "asc" | "desc";

function fmt(n: number) {
  return fmtNum(n);
}

function fmtJoinDate(ts: number | null): string {
  if (ts === null) return "–";
  return fmtDay(new Date(ts * 1000));
}

function fmtDateTime(ts: number): string {
  return fmtDayTime(new Date(ts * 1000));
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-[#3a3a5a] ml-1">↕</span>;
  return <span className="text-[#7c6af7] ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

function ResultsTable({
  result,
  includeReactions,
  minMessages,
  minPollParticipations,
  excludedMembers,
  onToggleExcluded,
  notABot,
  totalPollsInPeriod,
  stMembers,
  onToggleST,
}: Props) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>("message_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [nameFilter, setNameFilter] = useState("");
  const [statuses, setStatuses] = useState<
    Map<number, { loading: boolean; data?: UserOnlineStatus; error?: string }>
  >(new Map());

  function loadStatus(userId: number) {
    setStatuses((prev) => new Map(prev).set(userId, { loading: true }));
    invoke<UserOnlineStatus>("fetch_user_status", { userId })
      .then((data) => {
        setStatuses((prev) => new Map(prev).set(userId, { loading: false, data }));
      })
      .catch((e) => {
        setStatuses((prev) =>
          new Map(prev).set(userId, { loading: false, error: translateBackend(e) })
        );
      });
  }

  function statusLabel(userId: number): { text: string; clickable: boolean } {
    const s = statuses.get(userId);
    if (!s) return { text: t("table.online_status_load"), clickable: true };
    if (s.loading) return { text: t("table.online_status_loading"), clickable: false };
    if (s.error) return { text: t("table.online_status_error"), clickable: true };
    if (!s.data) return { text: t("table.online_status_load"), clickable: true };
    switch (s.data.kind) {
      case "online":
        return { text: t("table.online_status_online"), clickable: false };
      case "offline":
        return {
          text: s.data.was_online
            ? t("table.online_status_offline_since", { date: fmtDateTime(s.data.was_online) })
            : t("table.online_status_offline"),
          clickable: false,
        };
      case "recently":
        return { text: t("table.online_status_recently"), clickable: false };
      case "last_week":
        return { text: t("table.online_status_last_week"), clickable: false };
      case "last_month":
        return { text: t("table.online_status_last_month"), clickable: false };
      default:
        return { text: t("table.online_status_unknown"), clickable: false };
    }
  }

  if (!result) {
    return (
      <div className="flex-1 bg-[#1e1e2e] rounded-xl flex items-center justify-center min-h-[8rem]">
        <p className="text-[#3a3a5a] text-sm">{t("table.no_results")}</p>
      </div>
    );
  }

  // Same rule as the statistics ("Wirklich aktiv") and the CSV export:
  // only the message threshold decides whether a member counts as active.
  const isActive = (m: MemberActivity) => m.message_count >= minMessages;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...result.members].sort((a, b) => {
    if (sortKey === "poll_pct") {
      const av = totalPollsInPeriod > 0 ? a.poll_participations / totalPollsInPeriod : 0;
      const bv = totalPollsInPeriod > 0 ? b.poll_participations / totalPollsInPeriod : 0;
      return sortDir === "asc" ? av - bv : bv - av;
    }
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (av === null) return 1;
    if (bv === null) return -1;
    return sortDir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });

  const query = nameFilter.trim().toLowerCase();
  const withActivity = sorted.filter(
    (m) => m.message_count > 0 || m.poll_participations > 0 || m.reaction_count > 0
  );
  const visible = withActivity
    .filter(
      (m) =>
        query === "" ||
        m.name.toLowerCase().includes(query) ||
        (m.username ?? "").toLowerCase().includes(query)
    );
  const activeMembers   = visible.filter((m) => !excludedMembers.has(m.user_id));
  const disabledMembers = visible.filter((m) =>  excludedMembers.has(m.user_id));
  const displayMembers  = [...activeMembers, ...disabledMembers];

  // Legend counts: independent of the name search, same rules as the statistics
  const included = withActivity.filter((m) => !excludedMembers.has(m.user_id));
  const legendActive = included.filter((m) => isActive(m)).length;
  const legendBelowWithMsgs = included.filter(
    (m) => !isActive(m) && m.message_count > 0
  ).length;
  const legendNoMsgs = included.filter((m) => m.message_count === 0).length;
  const legendBelow = legendBelowWithMsgs + legendNoMsgs;
  const legendExcluded = withActivity.length - included.length;

  const hasPollVotes = result.members.some((m) => m.poll_participations > 0);
  const hasQuizVotes = result.members.some((m) => m.quiz_participations > 0);

  const thBase =
    "px-3 py-2 text-xs font-medium text-[#888aaa] uppercase tracking-wide cursor-pointer hover:text-[#e0e0f0] select-none whitespace-nowrap border-b border-[#3a3a5a]";
  const thST =
    "px-2 py-2 text-xs font-medium text-[#888aaa] uppercase tracking-wide select-none whitespace-nowrap border-b border-[#3a3a5a] text-center";

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder={t("table.search_placeholder")}
          className="w-full max-w-xs bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-3 py-1.5 rounded-lg text-[#e0e0f0] text-sm placeholder:text-[#555570]"
        />
        {query !== "" && (
          <span className="text-[#888aaa] text-xs whitespace-nowrap">
            {t("table.search_results", { count: displayMembers.length })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-4 text-xs whitespace-nowrap">
          <span className="flex items-center gap-1.5 text-[#7c6af7]">
            <span className="inline-block w-1 h-4 rounded-sm bg-[#7c6af7]" />
            {t("table.legend_active", { count: minMessages, n: legendActive })}
          </span>
          {legendBelow > 0 && (
            <span
              className="flex items-center gap-1.5 text-amber-400"
              title={t("table.legend_below_tooltip", {
                count: minMessages,
                withMsgs: legendBelowWithMsgs,
                noMsgs: legendNoMsgs,
              })}
            >
              <span className="inline-block w-1 h-4 rounded-sm bg-amber-500" />
              {t("table.legend_below", { n: legendBelow })}
              {legendNoMsgs > 0 && (
                <span className="text-[#888aaa]">
                  {t("table.legend_below_split", {
                    count: minMessages,
                    withMsgs: legendBelowWithMsgs,
                    noMsgs: legendNoMsgs,
                  })}
                </span>
              )}
            </span>
          )}
          {legendExcluded > 0 && (
            <span className="flex items-center gap-1.5 text-[#e05555]">
              <span className="inline-block w-1 h-4 rounded-sm bg-[#e05555]" />
              {t("table.legend_excluded", { n: legendExcluded })}
            </span>
          )}
        </div>
      </div>
      <div
        className="rounded-xl border border-[#3a3a5a]"
        style={{ resize: "vertical", overflow: "auto", minHeight: "200px", height: "400px" }}
      >
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#2a2a3e]">
          <tr>
            <th className={thBase + " text-left"} onClick={() => handleSort("name")}>
              {t("table.name")} <SortIcon active={sortKey === "name"} dir={sortDir} />
            </th>
            <th className={thBase + " text-right"} onClick={() => handleSort("joined_date")}>
              {t("table.joined")} <SortIcon active={sortKey === "joined_date"} dir={sortDir} />
            </th>
            <th
              className={thBase + " text-right"}
              onClick={() => handleSort("message_count")}
            >
              {t("table.messages")} <SortIcon active={sortKey === "message_count"} dir={sortDir} />
            </th>
            <th
              className={thBase + " text-right"}
              onClick={() => handleSort("last_message_date")}
            >
              {t("table.last_message")} <SortIcon active={sortKey === "last_message_date"} dir={sortDir} />
            </th>
            <th className={thST}>
              {t("table.online_status")}
            </th>
            {includeReactions && (
              <th
                className={thBase + " text-right"}
                onClick={() => handleSort("reaction_count")}
              >
                {t("table.reactions")} <SortIcon active={sortKey === "reaction_count"} dir={sortDir} />
              </th>
            )}
            {hasPollVotes && (
              <th
                className={thBase + " text-right"}
                onClick={() => handleSort("poll_participations")}
              >
                {t("table.polls")} <SortIcon active={sortKey === "poll_participations"} dir={sortDir} />
              </th>
            )}
            {hasPollVotes && totalPollsInPeriod > 0 && (
              <th className={thBase + " text-right"} onClick={() => handleSort("poll_pct")}>
                <Tooltip text={t("table.poll_pct_tooltip")} down>
                  <span>{t("table.poll_pct")}</span>
                </Tooltip>
                {" "}<SortIcon active={sortKey === "poll_pct"} dir={sortDir} />
              </th>
            )}
            {hasQuizVotes && (
              <th
                className={thBase + " text-right"}
                onClick={() => handleSort("quiz_participations")}
              >
                {t("table.quizzes")} <SortIcon active={sortKey === "quiz_participations"} dir={sortDir} />
              </th>
            )}
            <th className={thST}>
              <Tooltip text={t("table.st_tooltip")} down>
                <span>{t("table.st")}</span>
              </Tooltip>
            </th>
          </tr>
        </thead>
        <tbody>
          {displayMembers.map((m, i) => {
            const excluded = excludedMembers.has(m.user_id);
            const isST = stMembers.has(m.user_id);
            const active = isActive(m);
            const below = !excluded && !active;
            const baseRow = excluded
              ? "bg-red-900/20 cursor-pointer"
              : isST
              ? "bg-[#4caf7c]/15 cursor-pointer hover:bg-[#4caf7c]/20"
              : i % 2 === 0
              ? "bg-[#2a2a3e] cursor-pointer hover:bg-[#333350]"
              : "bg-[#252535] cursor-pointer hover:bg-[#2e2e48]";
            const textColor = excluded ? "opacity-50" : below ? "opacity-60" : "";
            const marker = excluded
              ? "border-[#e05555]"
              : below
              ? "border-amber-500"
              : "border-transparent";

            return (
              <tr
                key={m.user_id}
                className={baseRow}
                onClick={() => onToggleExcluded(m.user_id, m.name)}
                title={
                  excluded
                    ? t("table.click_include")
                    : below
                    ? `${t("table.below_tooltip", { count: minMessages })} ${t("table.click_exclude")}`
                    : t("table.click_exclude")
                }
              >
                <td className={`px-3 py-2 border-l-4 ${marker}`}>
                  <div className="flex items-center gap-2">
                    {excluded && (
                      <span className="text-[#e05555] text-xs font-bold shrink-0">✕</span>
                    )}
                    <div className={textColor}>
                      <p
                        className={`text-[#e0e0f0] leading-tight ${
                          excluded ? "line-through" : ""
                        }`}
                      >
                        {m.name}
                        {m.is_bot && !notABot.has(m.user_id) && (
                          <span className="ml-1 text-xs" title="Bot">🤖</span>
                        )}
                      </p>
                      {m.username ? (
                        <p className="text-[#888aaa] text-xs leading-tight">
                          @{m.username}
                        </p>
                      ) : (
                        <p className="text-[#3a3a5a] text-xs leading-tight italic">
                          (kein Username)
                        </p>
                      )}
                    </div>
                    {below && (
                      <span className="ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/40 whitespace-nowrap">
                        {t("table.below_badge")}
                      </span>
                    )}
                  </div>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-[#888aaa] text-xs ${textColor}`}>
                  {fmtJoinDate(m.joined_date)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    below ? "text-amber-400 font-semibold" : `text-[#e0e0f0] ${textColor}`
                  }`}
                >
                  {fmt(m.message_count)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-[#888aaa] text-xs ${textColor}`}>
                  {fmtJoinDate(m.last_message_date)}
                </td>
                <td
                  className="px-2 py-2 text-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (statusLabel(m.user_id).clickable) loadStatus(m.user_id);
                  }}
                  title={t("table.online_status_hint")}
                >
                  <span
                    className={`text-xs whitespace-nowrap ${
                      statusLabel(m.user_id).clickable
                        ? "text-[#7c6af7] cursor-pointer hover:underline"
                        : "text-[#888aaa]"
                    }`}
                  >
                    {statusLabel(m.user_id).text}
                  </span>
                </td>
                {includeReactions && (
                  <td
                    className={`px-3 py-2 text-right tabular-nums text-[#e0e0f0] ${textColor}`}
                  >
                    {fmt(m.reaction_count)}
                  </td>
                )}
                {hasPollVotes && (
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${textColor} ${
                      m.poll_participations === 0 ||
                      (minPollParticipations > 0 && m.poll_participations < minPollParticipations)
                        ? "text-[#3a3a5a]"
                        : "text-[#e0e0f0]"
                    }`}
                  >
                    {fmt(m.poll_participations)}
                  </td>
                )}
                {hasPollVotes && totalPollsInPeriod > 0 && (
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${textColor} ${
                      m.poll_participations === 0 ? "text-[#3a3a5a]" : "text-[#888aaa]"
                    }`}
                  >
                    {m.poll_participations === 0
                      ? "–"
                      : `${((m.poll_participations / totalPollsInPeriod) * 100).toFixed(1)} %`}
                  </td>
                )}
                {hasQuizVotes && (
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${textColor} ${
                      m.quiz_participations === 0 ? "text-[#3a3a5a]" : "text-[#e0e0f0]"
                    }`}
                  >
                    {fmt(m.quiz_participations)}
                  </td>
                )}
                <td
                  className="px-2 py-2 text-center"
                  onClick={(e) => { e.stopPropagation(); onToggleST(m.user_id, m.name); }}
                  title={stMembers.has(m.user_id) ? t("table.st_unmark") : t("table.st_mark")}
                >
                  <span
                    className={`text-xs font-bold select-none cursor-pointer ${
                      stMembers.has(m.user_id)
                        ? "text-[#7c6af7]"
                        : "text-[#3a3a5a] hover:text-[#5a5a8a]"
                    }`}
                  >
                    ST
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default memo(ResultsTable);
