import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnalysisResult, MemberActivity } from "../types";

interface Props {
  result: AnalysisResult | null;
  includeReactions: boolean;
  includePolls: boolean;
  includeQuizzes: boolean;
  minMessages: number;
  minReactions: number;
  excludedMembers: Map<number, string>;
  onToggleExcluded: (userId: number, name: string) => void;
  notABot: Map<number, string>;
}

type SortKey = keyof Pick<MemberActivity, "name" | "message_count" | "reaction_count" | "poll_participations" | "quiz_participations">;
type SortDir = "asc" | "desc";

function fmt(n: number) {
  return n.toLocaleString("de-CH");
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-[#3a3a5a] ml-1">↕</span>;
  return <span className="text-[#7c6af7] ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export default function ResultsTable({
  result,
  includeReactions,
  includePolls,
  includeQuizzes,
  minMessages,
  minReactions,
  excludedMembers,
  onToggleExcluded,
  notABot,
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
    m.message_count > minMessages ||
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
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });

  const hasPollVotes = includePolls && result.members.some((m) => m.poll_participations > 0);
  const hasQuizVotes = includeQuizzes && result.members.some((m) => m.quiz_participations > 0);

  const thBase =
    "px-3 py-2 text-xs font-medium text-[#888aaa] uppercase tracking-wide cursor-pointer hover:text-[#e0e0f0] select-none whitespace-nowrap border-b border-[#3a3a5a]";

  return (
    <div className="overflow-auto max-h-[calc(100vh-400px)] rounded-xl border border-[#3a3a5a]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#2a2a3e]">
          <tr>
            <th className={thBase + " text-left"} onClick={() => handleSort("name")}>
              {t("table.name")} <SortIcon active={sortKey === "name"} dir={sortDir} />
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
            {hasQuizVotes && (
              <th
                className={thBase + " text-right"}
                onClick={() => handleSort("quiz_participations")}
              >
                {t("table.quizzes")} <SortIcon active={sortKey === "quiz_participations"} dir={sortDir} />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => {
            const excluded = excludedMembers.has(m.user_id);
            const active = isActive(m);
            const baseRow = excluded
              ? "bg-red-900/20 cursor-pointer"
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
                      m.poll_participations === 0 ? "text-[#3a3a5a]" : "text-[#e0e0f0]"
                    }`}
                  >
                    {fmt(m.poll_participations)}
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
