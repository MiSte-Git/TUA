import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnalysisResult, MemberActivity } from "../types";
import Tooltip from "./Tooltip";

interface Props {
  result: AnalysisResult | null;
  includeReactions: boolean;
  minMessages: number;
  minReactions: number;
  minPollParticipations: number;
  excludedMembers: Map<number, string>;
  onToggleExcluded: (userId: number, name: string) => void;
  notABot: Map<number, string>;
  totalPollsInPeriod: number;
  stMembers: Map<number, string>;
  onToggleST: (userId: number, name: string) => void;
}

type SortKey = keyof Pick<MemberActivity, "name" | "joined_date" | "message_count" | "reaction_count" | "poll_participations" | "quiz_participations"> | "poll_pct";
type SortDir = "asc" | "desc";

function fmt(n: number) {
  return n.toLocaleString("de-CH");
}

function fmtJoinDate(ts: number | null): string {
  if (ts === null) return "–";
  const d = new Date(ts * 1000);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-[#3a3a5a] ml-1">↕</span>;
  return <span className="text-[#7c6af7] ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export default function ResultsTable({
  result,
  includeReactions,
  minMessages,
  minReactions,
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

  if (!result) {
    return (
      <div className="flex-1 bg-[#1e1e2e] rounded-xl flex items-center justify-center min-h-[8rem]">
        <p className="text-[#3a3a5a] text-sm">{t("table.no_results")}</p>
      </div>
    );
  }

  const isActive = (m: MemberActivity) =>
    m.message_count >= minMessages ||
    (minReactions > 0 && m.reaction_count >= minReactions);

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

  const visible = sorted.filter(
    (m) => m.message_count > 0 || m.poll_participations > 0 || m.reaction_count > 0
  );
  const activeMembers   = visible.filter((m) => !excludedMembers.has(m.user_id));
  const disabledMembers = visible.filter((m) =>  excludedMembers.has(m.user_id));
  const displayMembers  = [...activeMembers, ...disabledMembers];

  const hasPollVotes = result.members.some((m) => m.poll_participations > 0);
  const hasQuizVotes = result.members.some((m) => m.quiz_participations > 0);

  const thBase =
    "px-3 py-2 text-xs font-medium text-[#888aaa] uppercase tracking-wide cursor-pointer hover:text-[#e0e0f0] select-none whitespace-nowrap border-b border-[#3a3a5a]";
  const thST =
    "px-2 py-2 text-xs font-medium text-[#888aaa] uppercase tracking-wide select-none whitespace-nowrap border-b border-[#3a3a5a] text-center";

  return (
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
            const baseRow = excluded
              ? "bg-red-900/20 cursor-pointer"
              : isST
              ? "bg-[#4caf7c]/15 cursor-pointer hover:bg-[#4caf7c]/20"
              : i % 2 === 0
              ? "bg-[#2a2a3e] cursor-pointer hover:bg-[#333350]"
              : "bg-[#252535] cursor-pointer hover:bg-[#2e2e48]";
            const textColor = excluded ? "opacity-50" : !active ? "opacity-40" : "";

            return (
              <tr
                key={m.user_id}
                className={baseRow}
                onClick={() => onToggleExcluded(m.user_id, m.name)}
                title={excluded ? t("table.click_include") : t("table.click_exclude")}
              >
                <td className={`px-3 py-2 ${textColor}`}>
                  <div className="flex items-center gap-2">
                    {excluded && (
                      <span className="text-[#e05555] text-xs font-bold shrink-0">✕</span>
                    )}
                    <div>
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
                  </div>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-[#888aaa] text-xs ${textColor}`}>
                  {fmtJoinDate(m.joined_date)}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums text-[#e0e0f0] ${textColor}`}
                >
                  {fmt(m.message_count)}
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
  );
}
