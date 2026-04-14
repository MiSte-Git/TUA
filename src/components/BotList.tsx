import { useState } from "react";
import type { BotMember } from "../types";

interface Props {
  bots: BotMember[];
  notABot: Map<number, string>;
  onToggleNotABot: (userId: number, name: string) => void;
}

type SortKey = "name" | "username";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-[#3a3a5a] ml-1">↕</span>;
  return <span className="text-[#7c6af7] ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export default function BotList({ bots, notABot, onToggleNotABot }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const visibleBots = bots.filter((b) => !notABot.has(b.user_id));
  const excludedBots = bots.filter((b) => notABot.has(b.user_id));

  if (bots.length === 0) {
    return (
      <div className="flex-1 bg-[#1e1e2e] rounded-xl flex items-center justify-center min-h-[8rem]">
        <p className="text-[#3a3a5a] text-sm">Keine Bots im Kanal gefunden</p>
      </div>
    );
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortBots(list: BotMember[]) {
    return [...list].sort((a, b) => {
      const av = sortKey === "username" ? (a.username ?? "") : a.name;
      const bv = sortKey === "username" ? (b.username ?? "") : b.name;
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  const sorted = sortBots(visibleBots);

  const thBase =
    "px-3 py-2 text-xs font-medium text-[#888aaa] uppercase tracking-wide cursor-pointer hover:text-[#e0e0f0] select-none whitespace-nowrap border-b border-[#3a3a5a]";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[#888aaa] text-xs">
        {visibleBots.length} Bot{visibleBots.length !== 1 ? "s" : ""} im Kanal (zeitraumunabhängig)
      </p>
      <div className="overflow-auto max-h-[calc(100vh-420px)] rounded-xl border border-[#3a3a5a]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[#2a2a3e]">
            <tr>
              <th className={thBase + " text-left"} onClick={() => handleSort("name")}>
                Name <SortIcon active={sortKey === "name"} dir={sortDir} />
              </th>
              <th className={thBase + " text-left"} onClick={() => handleSort("username")}>
                Username <SortIcon active={sortKey === "username"} dir={sortDir} />
              </th>
              <th className={thBase + " text-right"}>User-ID</th>
              <th className={thBase + " text-right"} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((bot, i) => (
              <tr
                key={bot.user_id}
                className={i % 2 === 0 ? "bg-[#2a2a3e]" : "bg-[#252535]"}
              >
                <td className="px-3 py-2 text-[#e0e0f0]">{bot.name}</td>
                <td className="px-3 py-2">
                  {bot.username ? (
                    <span className="text-[#888aaa]">@{bot.username}</span>
                  ) : (
                    <span className="text-[#3a3a5a] italic text-xs">(kein Username)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[#888aaa] text-xs">
                  {bot.user_id}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => onToggleNotABot(bot.user_id, bot.name)}
                    className="text-xs text-[#555570] hover:text-[#e05555] transition-colors whitespace-nowrap"
                    title="Als 'Kein Bot' markieren"
                  >
                    ✕ Kein Bot
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {excludedBots.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[#555570] text-xs">
            Manuell als „Kein Bot" markiert ({excludedBots.length})
          </p>
          <div className="rounded-xl border border-[#3a3a5a] overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {excludedBots.map((bot, i) => (
                  <tr
                    key={bot.user_id}
                    className={i % 2 === 0 ? "bg-[#2a2a3e] opacity-50" : "bg-[#252535] opacity-50"}
                  >
                    <td className="px-3 py-2 text-[#888aaa]">{bot.name}</td>
                    <td className="px-3 py-2 text-[#555570] text-xs">
                      {bot.username ? `@${bot.username}` : "(kein Username)"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onToggleNotABot(bot.user_id, bot.name)}
                        className="text-xs text-[#7c6af7] hover:text-[#a090ff] transition-colors whitespace-nowrap"
                        title="Wiederherstellen"
                      >
                        ↩ Wiederherstellen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
