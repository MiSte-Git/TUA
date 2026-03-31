import { useState } from "react";
import type { AnalysisResult, MemberActivity } from "../types";

interface Props {
  result: AnalysisResult | null;
  includeReactions: boolean;
  minMessages: number;
  minReactions: number;
  excludedUserIds: Set<number>;
  onToggleExcluded: (userId: number) => void;
}

type SortKey = keyof Pick<MemberActivity, "name" | "message_count" | "reaction_count">;
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
  minMessages,
  minReactions,
  excludedUserIds,
  onToggleExcluded,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("message_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  if (!result) {
    return (
      <div className="flex-1 bg-[#1e1e2e] rounded-xl flex items-center justify-center min-h-[8rem]">
        <p className="text-[#3a3a5a] text-sm">Noch keine Analyse durchgeführt</p>
      </div>
    );
  }

  const isActive = (m: MemberActivity) =>
    m.message_count >= minMessages ||
    (minReactions > 0 && m.reaction_count >= minReactions);

  const { members, chat, total_messages, period_months } = result;
  const memberCount = chat.member_count ?? members.length;
  const included = members.filter((m) => !excludedUserIds.has(m.user_id));
  const activeTotal = included.filter(isActive).length;
  const activeByMsg = included.filter((m) => m.message_count >= minMessages).length;
  const activeByReaction =
    minReactions > 0
      ? included.filter((m) => m.reaction_count >= minReactions).length
      : 0;
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...members].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });

  const thBase =
    "px-3 py-2 text-xs font-medium text-[#888aaa] uppercase tracking-wide cursor-pointer hover:text-[#e0e0f0] select-none whitespace-nowrap border-b border-[#3a3a5a]";

  const activePercent2 =
    memberCount > 0 ? ((activeTotal / memberCount) * 100).toFixed(1) : "0.0";

  return (
    <div className="flex flex-col gap-3">
      {/* Summary bar */}
      <div className="bg-[#1e1e2e] rounded-lg px-4 py-3 flex flex-col gap-1 text-sm">
        <span className="text-[#e0e0f0]">
          <span className="text-[#7c6af7] font-semibold">{activeTotal}</span>
          {" von "}
          <span className="font-semibold">{fmt(memberCount)}</span>
          {" Mitgliedern aktiv "}
          <span className="text-[#888aaa]">({activePercent2}%)</span>
        </span>
        <span className="text-[#888aaa]">
          {activeByMsg} Mitglieder haben Nachrichten geschrieben
        </span>
        {includeReactions && minReactions > 0 && (
          <span className="text-[#888aaa]">
            {activeByReaction} Mitglieder haben Reaktionen gesetzt
          </span>
        )}
        <span className="text-[#888aaa]">
          {fmt(total_messages)} Nachrichten insgesamt · {period_months} Monate
        </span>
        {excludedUserIds.size > 0 && (
          <span className="text-[#e05555]">{excludedUserIds.size} Mitglieder ausgeschlossen</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-auto max-h-[calc(100vh-400px)] rounded-xl border border-[#3a3a5a]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[#2a2a3e]">
            <tr>
              <th className={thBase + " text-left"} onClick={() => handleSort("name")}>
                Name <SortIcon active={sortKey === "name"} dir={sortDir} />
              </th>
              <th
                className={thBase + " text-right"}
                onClick={() => handleSort("message_count")}
              >
                Nachrichten <SortIcon active={sortKey === "message_count"} dir={sortDir} />
              </th>
              {includeReactions && (
                <th
                  className={thBase + " text-right"}
                  onClick={() => handleSort("reaction_count")}
                >
                  Reaktionen <SortIcon active={sortKey === "reaction_count"} dir={sortDir} />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => {
              const excluded = excludedUserIds.has(m.user_id);
              const active = isActive(m);
              const baseRow = excluded
                ? "bg-red-900/20 cursor-pointer"
                : i % 2 === 0
                ? "bg-[#2a2a3e] cursor-pointer hover:bg-[#333350]"
                : "bg-[#252535] cursor-pointer hover:bg-[#2e2e48]";
              const textColor = excluded || !active ? "opacity-50" : "";

              return (
                <tr
                  key={m.user_id}
                  className={baseRow}
                  onClick={() => onToggleExcluded(m.user_id)}
                  title={excluded ? "Klicken zum Einschließen" : "Klicken zum Ausschließen"}
                >
                  {/* Name cell: two lines */}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
