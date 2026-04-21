import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { useTranslation } from "react-i18next";
import type { FirstMentionResult, ChatMember } from "../types";
import { useElapsedTimer } from "../hooks/useElapsedTimer";

interface Props {
  chatId?: number | null;
  chatUsername?: string | null;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-sm text-[#888aaa]">{label}</span>
      <span className={`text-sm tabular-nums font-semibold ${valueClass ?? "text-[#e0e0f0]"}`}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#3a3a5a] my-1" />;
}

export default function FirstMentionView({ chatId, chatUsername }: Props) {
  const { t } = useTranslation();
  // ── All hooks before any early return ────────────────────────────────────
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FirstMentionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [members, setMembers] = useState<ChatMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersCount, setMembersCount] = useState(0);

  // Member selected from autocomplete (drives member card)
  const [selectedMember, setSelectedMember] = useState<ChatMember | null>(null);

  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [finalDuration, setFinalDuration] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [cancelled, setCancelled] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const prevChatIdRef = useRef<number | null>(null);
  const lastFormattedRef = useRef<string>("");
  const wasLoading = useRef(false);

  const { formatted } = useElapsedTimer(loading);
  lastFormattedRef.current = formatted;

  useEffect(() => {
    if (loading) {
      setFinalDuration(null);
      wasLoading.current = true;
    } else if (wasLoading.current) {
      setFinalDuration(lastFormattedRef.current);
      wasLoading.current = false;
    }
  }, [loading]);

  // ── Reset all transient state when chatId changes ────────────────────────
  useEffect(() => {
    setUsername("");
    setResult(null);
    setError(null);
    setSelectedMember(null);
    setCancelled(false);
    setFinalDuration(null);
  }, [chatId]);

  // ── Load search history when chatId changes ───────────────────────────────
  useEffect(() => {
    if (!chatId) return;
    try {
      const stored = localStorage.getItem(`first_mention_history_${chatId}`);
      setHistory(stored ? JSON.parse(stored) : []);
    } catch {
      setHistory([]);
    }
  }, [chatId]);

  // ── Members progress listener ─────────────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<number>("members_progress", (e) => {
      setMembersCount(e.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // ── Auto-load members when chatId changes ─────────────────────────────────
  useEffect(() => {
    if (!chatId || chatId === prevChatIdRef.current) return;
    prevChatIdRef.current = chatId;
    setMembers([]);
    setMembersCount(0);
    setMembersLoading(true);
    invoke<ChatMember[]>("load_chat_members", { chatId })
      .then(setMembers)
      .catch((e) => console.error("Mitglieder laden fehlgeschlagen:", e))
      .finally(() => setMembersLoading(false));
  }, [chatId]);

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setFocused(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  const query = username.trim();
  const normalizedUsername = query.replace(/^@/, "");

  const filteredMembers = useMemo(() => {
    if (query.length < 2) return [];
    const q = normalizedUsername.toLowerCase();
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.username?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, normalizedUsername, members]);

  const memberMatch = useMemo(() => {
    if (!query.startsWith("@") || !normalizedUsername) return undefined;
    return members.find(
      (m) => m.username?.toLowerCase() === normalizedUsername.toLowerCase()
    );
  }, [query, normalizedUsername, members]);

  const isExactSearch = query.startsWith("@") && normalizedUsername.length > 0;
  const showDropdown = focused && filteredMembers.length > 0;
  const showHistory = focused && query.length === 0 && history.length > 0;


  // ── Handlers ──────────────────────────────────────────────────────────────
  function saveToHistory(un: string) {
    if (!chatId) return;
    const entry = un.startsWith("@") ? un : `@${un}`;
    const next = [entry, ...history.filter((h) => h !== entry)].slice(0, 10);
    setHistory(next);
    localStorage.setItem(`first_mention_history_${chatId}`, JSON.stringify(next));
  }

  function handleCancel() {
    invoke("cancel_first_mention").catch(() => {});
  }

  function selectMember(member: ChatMember) {
    const value = member.username ? `@${member.username}` : member.name;
    setUsername(value);
    setSelectedMember(member);
    setResult(null);
    setError(null);
    setCancelled(false);
    setFinalDuration(null);
    setFocused(false);
    setActiveIndex(-1);
  }

  async function handleSearch() {
    if (!normalizedUsername || !chatId) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setCancelled(false);
    setFocused(false);
    saveToHistory(normalizedUsername);
    try {
      const res = await invoke<FirstMentionResult>("find_first_mention", {
        chatId,
        chatUsername: chatUsername ?? null,
        username: normalizedUsername,
      });
      setResult(res);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("Abgebrochen")) {
        setCancelled(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filteredMembers.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        selectMember(filteredMembers[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        setFocused(false);
        setActiveIndex(-1);
        return;
      }
    }
    if (e.key === "Enter" && !loading) {
      handleSearch();
    }
  }

  // ── Early return after all hooks ──────────────────────────────────────────
  if (!chatId) {
    return (
      <div className="flex-1 bg-[#1e1e2e] rounded-xl flex items-center justify-center min-h-[8rem]">
        <p className="text-[#3a3a5a] text-sm">Bitte zuerst einen Chat auflösen</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      {/* ── Search input card ─────────────────────────────────────────────── */}
      <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-3">
        <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
          Username
        </label>

        {membersLoading && (
          <p className="text-[#888aaa] text-xs animate-pulse">
            {t("first_mention.members_loading", { count: membersCount })}
          </p>
        )}

        {/* Input + autocomplete */}
        <div className="relative" ref={containerRef}>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t("first_mention.search_placeholder")}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setActiveIndex(-1);
                setSelectedMember(null);
                setResult(null);
                setError(null);
                setCancelled(false);
                setFinalDuration(null);
              }}
              onFocus={() => setFocused(true)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-3 py-2 rounded-lg flex-1 text-[#e0e0f0] placeholder-[#888aaa] text-sm"
            />
            <button
              onClick={handleSearch}
              disabled={loading || !normalizedUsername}
              className="bg-[#7c6af7] hover:bg-[#6a58e0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {loading ? t("first_mention.searching") : t("first_mention.search_button")}
            </button>
            {loading && (
              <button
                onClick={handleCancel}
                className="text-[#e05555] border border-[#e05555] hover:bg-[#e05555] hover:text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                ✕ Abbrechen
              </button>
            )}
          </div>

          {/* History dropdown */}
          {showHistory && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e1e2e] border border-[#3a3a5c] rounded-lg z-20 overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
              {history.map((entry) => (
                <div
                  key={entry}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#2a2a3e] group"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setUsername(entry);
                    setSelectedMember(null);
                    setResult(null);
                    setError(null);
                    setCancelled(false);
                    setFinalDuration(null);
                  }}
                >
                  <span className="text-[#666888] text-xs shrink-0">🕐</span>
                  <span className="text-[#e0e0f0] text-sm flex-1 truncate">{entry}</span>
                  <button
                    className="text-[#666888] hover:text-[#e05050] bg-transparent border-none cursor-pointer text-xs ml-auto shrink-0 px-1"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const next = history.filter((h) => h !== entry);
                      setHistory(next);
                      localStorage.setItem(
                        `first_mention_history_${chatId}`,
                        JSON.stringify(next)
                      );
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Autocomplete dropdown */}
          {showDropdown && (
            <div className="absolute top-full left-0 right-14 mt-1 bg-[#2a2a3e] border border-[#3a3e5e] rounded-lg shadow-lg z-10 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[#3a3a5a]">
                <span className="text-[#888aaa] text-xs">🔍 „{query}"</span>
              </div>
              {filteredMembers.map((m, i) => (
                <button
                  key={m.user_id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMember(m);
                  }}
                  className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors ${
                    i === activeIndex ? "bg-[#4a4a6e]" : "hover:bg-[#3a3a5e]"
                  }`}
                >
                  <span className="text-sm text-[#e0e0f0] truncate">{m.name}</span>
                  {m.username && (
                    <span className="text-xs text-[#888aaa] ml-2 shrink-0">
                      @{m.username}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Membership hints */}
        {isExactSearch && memberMatch && !selectedMember && (
          <p className="text-green-400 text-xs">
            ✓ Mitglied gefunden: {memberMatch.name}
          </p>
        )}
        {/* Loading / status for manual searches (no member card) */}
        {!selectedMember && loading && (
          <div className="flex items-center gap-3">
            <p className="text-[#888aaa] text-sm animate-pulse">Durchsuche Nachrichten…</p>
            <span className="text-yellow-400 text-xs tabular-nums font-mono">⏱ {formatted}</span>
          </div>
        )}
        {!selectedMember && !loading && cancelled && (
          <span className="text-yellow-400 text-xs">⚠ Suche abgebrochen {finalDuration ? `(nach ${finalDuration})` : ""}</span>
        )}
        {!selectedMember && !loading && finalDuration && !error && !cancelled && (
          <span className="text-green-400 text-xs">✓ Abgeschlossen in {finalDuration}</span>
        )}
        {!selectedMember && error && (
          <p className="text-[#e05555] text-sm bg-[#1e1e2e] rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* ── Member card ───────────────────────────────────────────────────── */}
      {selectedMember && (
        <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-2">
          {/* Header */}
          <div>
            <p className="font-semibold text-[#e0e0f0]">{selectedMember.name}</p>
            {selectedMember.username && (
              <p className="text-sm text-[#888aaa]">@{selectedMember.username}</p>
            )}
          </div>
          <Divider />

          {/* Joined date */}
          <Row label="Letzter Beitritt" value={fmtDate(selectedMember.joined_at)} />

          {/* Search button – visible only when idle (no result, not loading) */}
          {!loading && !result && !error && selectedMember.username && (
            <>
              <Divider />
              <button
                onClick={handleSearch}
                className="self-start bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
              >
                🔍 Frühere Aktivität suchen
              </button>
            </>
          )}
          {!loading && !result && !error && !selectedMember.username && (
            <p className="text-[#888aaa] text-xs pt-1">
              Kein @username – Suche nicht möglich
            </p>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-3 pt-1">
              <p className="text-[#888aaa] text-sm animate-pulse">Durchsuche Nachrichten…</p>
              <span className="text-yellow-400 text-xs tabular-nums font-mono">⏱ {formatted}</span>
            </div>
          )}
          {!loading && cancelled && (
            <span className="text-yellow-400 text-xs pt-1">⚠ Suche abgebrochen {finalDuration ? `(nach ${finalDuration})` : ""}</span>
          )}
          {!loading && finalDuration && !error && !cancelled && (result ? (
            <span className="text-green-400 text-xs">✓ Abgeschlossen in {finalDuration}</span>
          ) : (
            <span className="text-green-400 text-xs pt-1">✓ Abgeschlossen in {finalDuration}</span>
          ))}

          {/* Error */}
          {error && (
            <p className="text-[#e05555] text-sm bg-[#1e1e2e] rounded-lg px-3 py-2 mt-1">
              {error}
            </p>
          )}

          {/* Results */}
          {result && (
            <>
              <Divider />
              {!result.first_seen ? (
                <p className="text-[#888aaa] text-sm">
                  Keine Aktivität im Chatverlauf gefunden.
                </p>
              ) : (
                <>
                  <Row label="Erste eigene Nachricht" value={fmtDate(result.first_own_message)} />
                  <Row label="Erste Erwähnung" value={fmtDate(result.first_mention)} />
                  <Row label={t("first_mention.joined_at")} value={fmtDate(result.joined_at)} />
                  {result.joined_at_is_rejoin && (
                    <p className="text-yellow-500 text-xs italic">
                      ⚠️ {t("first_mention.joined_at_rejoin")}
                    </p>
                  )}
                  <Divider />

                  <Row
                    label={result.joined_at_is_rejoin ? "⚠️ Frühester Nachweis" : "Frühester Nachweis"}
                    value={fmtDate(result.first_seen)}
                    valueClass={result.joined_at_is_rejoin ? "text-orange-400 font-bold" : "text-[#7c6af7] font-bold"}
                  />
                  {result.joined_at_is_rejoin && (
                    <p className="text-[#888aaa] text-xs">{t("first_mention.rejoin_not_counted")}</p>
                  )}
                  {!result.joined_at_is_rejoin && result.found_in === "not_found" && result.joined_at && (
                    <p className="text-[#888aaa] text-xs">{t("first_mention.earliest_is_joined")}</p>
                  )}

                  {result.message_context && (
                    <>
                      <Divider />
                      <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
                        Kontext
                      </p>
                      <p className="text-[#888aaa] text-sm italic leading-relaxed bg-[#1e1e2e] rounded-lg px-3 py-2">
                        „{result.message_context}"
                      </p>
                    </>
                  )}
                  {result.message_link && (
                    <button
                      onClick={() => open(result.message_link!)}
                      className="mt-1 self-start bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
                    >
                      🔗 Zur Nachricht
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Fallback result panel (manual search, no member selected) ────── */}
      {!selectedMember && result && (
        <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-2">
          <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
            Erste Aktivität für @{normalizedUsername}
          </p>
          {!result.first_seen ? (
            <p className="text-[#3a3a5a] text-sm pt-1">Keine Aktivität gefunden.</p>
          ) : (
            <>
              <Divider />
              <Row label="Erste eigene Nachricht" value={fmtDate(result.first_own_message)} />
              <Row label="Erste Erwähnung" value={fmtDate(result.first_mention)} />
              <Row label={t("first_mention.joined_at")} value={fmtDate(result.joined_at)} />
              {result.joined_at_is_rejoin && (
                <p className="text-yellow-500 text-xs italic">
                  ⚠️ {t("first_mention.joined_at_rejoin")}
                </p>
              )}
              <Divider />
              <Row
                label="Frühester Nachweis"
                value={fmtDate(result.first_seen)}
                valueClass="text-[#7c6af7] font-bold"
              />
              {result.joined_at_is_rejoin && (
                <p className="text-[#888aaa] text-xs">{t("first_mention.rejoin_not_counted")}</p>
              )}
              {!result.joined_at_is_rejoin && result.found_in === "not_found" && result.joined_at && (
                <p className="text-[#888aaa] text-xs">{t("first_mention.earliest_is_joined")}</p>
              )}
              {result.message_context && (
                <>
                  <Divider />
                  <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
                    Kontext
                  </p>
                  <p className="text-[#888aaa] text-sm italic leading-relaxed bg-[#1e1e2e] rounded-lg px-3 py-2">
                    „{result.message_context}"
                  </p>
                </>
              )}
              {result.message_link && (
                <button
                  onClick={() => open(result.message_link!)}
                  className="mt-2 self-start bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
                >
                  🔗 Zur Nachricht
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
