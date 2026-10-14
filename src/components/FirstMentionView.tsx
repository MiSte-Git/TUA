import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { save } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type {
  ChatInfo,
  FirstMentionResult,
  ChatMember,
  JoinLeaveEventType,
  JoinLeaveSearchResult,
} from "../types";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import {
  loadLastExportDir,
  normalizeDate,
  saveLastExportDir,
  todayIso,
} from "../utils/exportDir";
import { isCancelled, translateBackend } from "../utils/backendMessage";
import { csvLabels } from "../utils/csvLabels";
import { fmtDate as fmtDay, fmtDateTime } from "../utils/format";

interface Props {
  chatId?: number | null;
  chatUsername?: string | null;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "–";
  return fmtDateTime(new Date(iso));
}

function fmtDateOnly(iso?: string | null): string {
  if (!iso) return "–";
  return fmtDay(new Date(iso));
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

const JOIN_LEAVE_TYPES: JoinLeaveEventType[] = ["added", "joined", "left", "removed"];

interface JoinLeaveSearchParams {
  search: string;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  event_types: JoinLeaveEventType[];
  date_from: string | null;
  date_to: string | null;
}

export function JoinLeaveView({
  chatId,
  chatInfo,
  clearLogs,
}: {
  chatId?: number | null;
  chatInfo?: ChatInfo | null;
  clearLogs: () => void;
}) {
  const { t } = useTranslation();
  const [lastSearch, setLastSearch] = useState<JoinLeaveSearchParams | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<JoinLeaveSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersUnavailable, setMembersUnavailable] = useState(false);
  const [membersCancelled, setMembersCancelled] = useState(false);
  const [membersCount, setMembersCount] = useState(0);
  const [selectedMember, setSelectedMember] = useState<ChatMember | null>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [eventTypes, setEventTypes] = useState<JoinLeaveEventType[]>([
    "added",
    "joined",
    "left",
    "removed",
  ]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const prevChatIdRef = useRef<number | null>(null);
  const { formatted } = useElapsedTimer(loading);

  useEffect(() => {
    setUsername("");
    setResult(null);
    setError(null);
    setCancelled(false);
    setSelectedMember(null);
    setDateFrom("");
    setDateTo("");
    setLastSearch(null);
    setExportError(null);
  }, [chatId]);

  useEffect(() => {
    const unlisten = listen<number>("members_progress", (e) => {
      setMembersCount(e.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!chatId || chatId === prevChatIdRef.current) return;
    prevChatIdRef.current = chatId;
    loadMembers(chatId);
  }, [chatId]);

  function loadMembers(id: number) {
    setMembers([]);
    setMembersCount(0);
    setMembersLoading(true);
    setMembersUnavailable(false);
    setMembersCancelled(false);
    invoke<ChatMember[]>("load_chat_members", { chatId: id })
      .then(setMembers)
      .catch((e) => {
        if (isCancelled(e)) {
          setMembersCancelled(true);
        } else {
          console.error("Loading members failed:", translateBackend(e));
          setMembersUnavailable(true);
        }
      })
      .finally(() => setMembersLoading(false));
  }

  function handleCancelMembers() {
    invoke("cancel_load_chat_members").catch(() => {});
  }

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

  const showDropdown = focused && filteredMembers.length > 0;
  const canSearch = !!chatId && eventTypes.length > 0 && (!!normalizedUsername || !!selectedMember);

  function selectMember(member: ChatMember) {
    const value = member.username ? `@${member.username}` : member.name;
    setUsername(value);
    setSelectedMember(member);
    setResult(null);
    setError(null);
    setCancelled(false);
    setFocused(false);
    setActiveIndex(-1);
  }

  function toggleEventType(type: JoinLeaveEventType) {
    setEventTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function handleDateChange(
    setter: React.Dispatch<React.SetStateAction<string>>,
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    setter(e.target.value);
    if (/^(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})$/.test(e.target.value)) {
      e.currentTarget.blur();
    }
  }

  function handleCancel() {
    invoke("cancel_join_leave_events").catch(() => {});
  }

  async function handleSearch() {
    if (!canSearch || !chatId) return;
    const matchedMember = selectedMember ?? memberMatch;
    clearLogs();
    setLoading(true);
    setResult(null);
    setError(null);
    setCancelled(false);
    setFocused(false);
    setExportError(null);
    setExportDone(false);
    const params: JoinLeaveSearchParams = {
      search: query,
      user_id: matchedMember?.user_id ?? null,
      username: matchedMember?.username ?? (normalizedUsername || null),
      display_name: matchedMember?.name ?? (query && !query.startsWith("@") ? query : null),
      event_types: [...eventTypes],
      date_from: dateFrom || null,
      date_to: dateTo || null,
    };
    try {
      const res = await invoke<JoinLeaveSearchResult>("find_join_leave_events", {
        chatId,
        userId: params.user_id,
        username: params.username,
        displayName: params.display_name,
        eventTypes: params.event_types,
        dateFrom: params.date_from,
        dateTo: params.date_to,
      });
      setResult(res);
      setLastSearch(params);
    } catch (e) {
      if (isCancelled(e)) {
        setCancelled(true);
      } else {
        setError(translateBackend(e));
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

  async function handleExport() {
    if (!result || !lastSearch || !chatInfo) return;
    setExportError(null);
    setExportDone(false);
    try {
      const from = normalizeDate(lastSearch.date_from) ?? t("join_leave.filename_start");
      const to = normalizeDate(lastSearch.date_to) ?? todayIso();
      const who = (lastSearch.username ? `@${lastSearch.username}` : lastSearch.search).replace(/^@/, "");
      const suggested = await invoke<string>("suggested_filename", {
        chatInfo,
        period: t("join_leave.filename", { who, from, to }),
      });
      const lastDir = loadLastExportDir();
      const defaultPath = lastDir ? `${lastDir}/${suggested}` : suggested;
      const path = await save({
        defaultPath,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      saveLastExportDir(path);
      await invoke("export_join_leave_csv", {
        events: result.events,
        chatInfo,
        path,
        filter: lastSearch,
        labels: csvLabels(),
      });
      setExportDone(true);
    } catch (e) {
      setExportError(translateBackend(e));
    }
  }

  if (!chatId) {
    return (
      <div className="flex-1 bg-[#1e1e2e] rounded-xl flex items-center justify-center min-h-[8rem]">
        <p className="text-[#3a3a5a] text-sm">{t("common.resolve_chat_first")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-3">
        <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
          {t("common.username")}
        </label>

        {membersLoading && (
          <div className="flex items-center gap-3">
            <p className="text-[#888aaa] text-xs animate-pulse">
              {t("first_mention.members_loading", { count: membersCount })}
            </p>
            <button
              type="button"
              onClick={handleCancelMembers}
              className="text-[#e05555] border border-[#e05555] hover:bg-[#e05555] hover:text-white text-xs font-semibold px-2 py-0.5 rounded transition-colors whitespace-nowrap"
            >
              ✕ {t("common.cancel")}
            </button>
          </div>
        )}

        {membersCancelled && !membersLoading && (
          <div className="flex items-center gap-3">
            <p className="text-amber-400 text-xs">
              {t("members.cancelled_hint")}
            </p>
            <button
              type="button"
              onClick={() => chatId && loadMembers(chatId)}
              className="text-[#888aaa] hover:text-[#e0e0f0] text-xs px-2 py-0.5 rounded border border-[#3a3a5a] hover:border-[#7c6af7] transition-colors whitespace-nowrap"
            >
              {t("common.reload")}
            </button>
          </div>
        )}

        {membersUnavailable && !membersLoading && (
          <p className="text-amber-400 text-xs">
            {t("members.unavailable_hint")}
          </p>
        )}

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
              }}
              onFocus={() => setFocused(true)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-3 py-2 rounded-lg flex-1 text-[#e0e0f0] placeholder-[#888aaa] text-sm"
            />
            <button
              onClick={handleSearch}
              disabled={loading || !canSearch}
              className="bg-[#7c6af7] hover:bg-[#6a58e0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {loading ? t("first_mention.searching") : t("first_mention.search_button")}
            </button>
            {loading && (
              <button
                type="button"
                onClick={handleCancel}
                className="text-[#e05555] border border-[#e05555] hover:bg-[#e05555] hover:text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                ✕ {t("common.cancel")}
              </button>
            )}
          </div>

          {showDropdown && (
            <div className="absolute top-full left-0 right-14 mt-1 bg-[#2a2a3e] border border-[#3a3e5e] rounded-lg shadow-lg z-10 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[#3a3a5a]">
                <span className="text-[#888aaa] text-xs">🔍 "{query}"</span>
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

        <div className="flex flex-wrap gap-2">
          {JOIN_LEAVE_TYPES.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 bg-[#1e1e2e] border border-[#3a3a5a] rounded-lg px-3 py-1.5 text-sm text-[#e0e0f0]"
            >
              <input
                type="checkbox"
                checked={eventTypes.includes(type)}
                onChange={() => toggleEventType(type)}
                disabled={loading}
              />
              {t(`join_leave.event_${type}`)}
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
              {t("join_leave.date_from_label")}
            </span>
            <input
              type="text"
              inputMode="numeric"
              placeholder={t("join_leave.date_from_placeholder")}
              value={dateFrom}
              onChange={(e) => handleDateChange(setDateFrom, e)}
              disabled={loading}
              className="bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-3 py-2 rounded-lg text-[#e0e0f0] placeholder-[#888aaa] text-sm w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
              {t("join_leave.date_to_label")}
            </span>
            <input
              type="text"
              inputMode="numeric"
              placeholder={t("join_leave.date_to_placeholder")}
              value={dateTo}
              onChange={(e) => handleDateChange(setDateTo, e)}
              disabled={loading}
              className="bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-3 py-2 rounded-lg text-[#e0e0f0] placeholder-[#888aaa] text-sm w-full"
            />
          </label>
        </div>

        {selectedMember && (
          <p className="text-green-400 text-xs">
            ✓ {t("join_leave.member_selected", { name: selectedMember.name })}
            {selectedMember.username ? ` (@${selectedMember.username})` : ""}
          </p>
        )}
        {!selectedMember && memberMatch && (
          <p className="text-green-400 text-xs">✓ {t("common.member_found", { name: memberMatch.name })}</p>
        )}
        {loading && (
          <div className="flex items-center gap-3">
            <p className="text-[#888aaa] text-sm animate-pulse">{t("join_leave.searching_service")}</p>
            <span className="text-yellow-400 text-xs tabular-nums font-mono">⏱ {formatted}</span>
          </div>
        )}
        {!loading && cancelled && (
          <p className="text-yellow-400 text-sm">{t("join_leave.cancelled")}</p>
        )}
        {error && (
          <p className="text-[#e05555] text-sm bg-[#1e1e2e] rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="bg-[#2a2a3e] rounded-xl p-4 overflow-auto">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
              {t("join_leave.result_header", { count: result.events.length })}
            </p>
            <div className="flex items-center gap-3">
              {exportError && (
                <span className="text-[#e05555] text-xs">{exportError}</span>
              )}
              {exportDone && !exportError && (
                <span className="text-green-400 text-xs">{t("export.done", { count: 1 })}</span>
              )}
              <button
                onClick={handleExport}
                disabled={!lastSearch || !chatInfo}
                className="bg-[#7c6af7] hover:bg-[#6a58e0] text-white text-sm font-semibold py-1.5 px-4 rounded-lg shadow transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("export.button")}
              </button>
            </div>
          </div>
          {result.events.length === 0 ? (
            <p className="text-[#888aaa] text-sm">{t("join_leave.no_events")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#888aaa] border-b border-[#3a3a5a]">
                  <th className="px-3 py-2 text-left">{t("join_leave.col_event")}</th>
                  <th className="px-3 py-2 text-left">{t("join_leave.col_date")}</th>
                  <th className="px-3 py-2 text-left">{t("join_leave.col_time")}</th>
                  <th className="px-3 py-2 text-left">{t("join_leave.col_affected")}</th>
                  <th className="px-3 py-2 text-left">{t("join_leave.col_actor")}</th>
                  <th className="px-3 py-2 text-right">{t("join_leave.col_chat_id")}</th>
                  <th className="px-3 py-2 text-right">{t("join_leave.col_message_id")}</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((event) => (
                  <tr
                    key={`${event.chat_id}-${event.message_id}-${event.event_type}`}
                    className="border-b border-[#242438] last:border-0"
                  >
                    <td className="px-3 py-2 text-[#e0e0f0]">{t(`join_leave.event_${event.event_type}`)}</td>
                    <td className="px-3 py-2 text-[#e0e0f0]">{fmtDateOnly(event.date)}</td>
                    <td className="px-3 py-2 text-[#e0e0f0] tabular-nums">{event.time}</td>
                    <td className="px-3 py-2 text-[#e0e0f0]">
                      {event.affected_user}
                      {event.affected_username && (
                        <span className="text-[#888aaa] ml-2">@{event.affected_username}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[#888aaa]">{event.actor ?? "–"}</td>
                    <td className="px-3 py-2 text-right text-[#888aaa] tabular-nums">
                      {event.chat_id}
                    </td>
                    <td className="px-3 py-2 text-right text-[#888aaa] tabular-nums">
                      {event.message_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
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
  const [membersUnavailable, setMembersUnavailable] = useState(false);
  const [membersCancelled, setMembersCancelled] = useState(false);
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
    loadMembers(chatId);
  }, [chatId]);

  function loadMembers(id: number) {
    setMembers([]);
    setMembersCount(0);
    setMembersLoading(true);
    setMembersUnavailable(false);
    setMembersCancelled(false);
    invoke<ChatMember[]>("load_chat_members", { chatId: id })
      .then(setMembers)
      .catch((e) => {
        if (isCancelled(e)) {
          setMembersCancelled(true);
        } else {
          console.error("Loading members failed:", translateBackend(e));
          setMembersUnavailable(true);
        }
      })
      .finally(() => setMembersLoading(false));
  }

  function handleCancelMembers() {
    invoke("cancel_load_chat_members").catch(() => {});
  }

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
      if (isCancelled(e)) {
        setCancelled(true);
      } else {
        setError(translateBackend(e));
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
        <p className="text-[#3a3a5a] text-sm">{t("common.resolve_chat_first")}</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      {/* ── Search input card ─────────────────────────────────────────────── */}
      <div className="bg-[#2a2a3e] rounded-xl p-4 flex flex-col gap-3">
        <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
          {t("common.username")}
        </label>

        {membersLoading && (
          <div className="flex items-center gap-3">
            <p className="text-[#888aaa] text-xs animate-pulse">
              {t("first_mention.members_loading", { count: membersCount })}
            </p>
            <button
              type="button"
              onClick={handleCancelMembers}
              className="text-[#e05555] border border-[#e05555] hover:bg-[#e05555] hover:text-white text-xs font-semibold px-2 py-0.5 rounded transition-colors whitespace-nowrap"
            >
              ✕ {t("common.cancel")}
            </button>
          </div>
        )}

        {membersCancelled && !membersLoading && (
          <div className="flex items-center gap-3">
            <p className="text-amber-400 text-xs">
              {t("members.cancelled_hint")}
            </p>
            <button
              type="button"
              onClick={() => chatId && loadMembers(chatId)}
              className="text-[#888aaa] hover:text-[#e0e0f0] text-xs px-2 py-0.5 rounded border border-[#3a3a5a] hover:border-[#7c6af7] transition-colors whitespace-nowrap"
            >
              {t("common.reload")}
            </button>
          </div>
        )}

        {membersUnavailable && !membersLoading && (
          <p className="text-amber-400 text-xs">
            {t("members.unavailable_hint")}
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
                ✕ {t("common.cancel")}
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
                <span className="text-[#888aaa] text-xs">🔍 "{query}"</span>
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
            ✓ {t("common.member_found", { name: memberMatch.name })}
          </p>
        )}
        {/* Loading / status for manual searches (no member card) */}
        {!selectedMember && loading && (
          <div className="flex items-center gap-3">
            <p className="text-[#888aaa] text-sm animate-pulse">{t("first_mention.searching_messages")}</p>
            <span className="text-yellow-400 text-xs tabular-nums font-mono">⏱ {formatted}</span>
          </div>
        )}
        {!selectedMember && !loading && cancelled && (
          <span className="text-yellow-400 text-xs">⚠ {finalDuration ? t("first_mention.cancelled_after", { duration: finalDuration }) : t("first_mention.cancelled")}</span>
        )}
        {!selectedMember && !loading && finalDuration && !error && !cancelled && (
          <span className="text-green-400 text-xs">✓ {t("first_mention.done_in", { duration: finalDuration })}</span>
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
          <Row label={t("first_mention.last_join")} value={fmtDate(selectedMember.joined_at)} />

          {/* Search button – visible only when idle (no result, not loading) */}
          {!loading && !result && !error && selectedMember.username && (
            <>
              <Divider />
              <button
                onClick={handleSearch}
                className="self-start bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
              >
                🔍 {t("first_mention.search_earlier")}
              </button>
            </>
          )}
          {!loading && !result && !error && !selectedMember.username && (
            <p className="text-[#888aaa] text-xs pt-1">
              {t("first_mention.no_username")}
            </p>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-3 pt-1">
              <p className="text-[#888aaa] text-sm animate-pulse">{t("first_mention.searching_messages")}</p>
              <span className="text-yellow-400 text-xs tabular-nums font-mono">⏱ {formatted}</span>
            </div>
          )}
          {!loading && cancelled && (
            <span className="text-yellow-400 text-xs pt-1">⚠ {finalDuration ? t("first_mention.cancelled_after", { duration: finalDuration }) : t("first_mention.cancelled")}</span>
          )}
          {!loading && finalDuration && !error && !cancelled && (result ? (
            <span className="text-green-400 text-xs">✓ {t("first_mention.done_in", { duration: finalDuration })}</span>
          ) : (
            <span className="text-green-400 text-xs pt-1">✓ {t("first_mention.done_in", { duration: finalDuration })}</span>
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
                  {t("first_mention.no_activity_history")}
                </p>
              ) : (
                <>
                  <Row label={t("first_mention.first_own_message")} value={fmtDate(result.first_own_message)} />
                  <Row label={t("first_mention.first_mention")} value={fmtDate(result.first_mention)} />
                  <Row label={t("first_mention.joined_at")} value={fmtDate(result.joined_at)} />
                  {result.joined_at_is_rejoin && (
                    <p className="text-yellow-500 text-xs italic">
                      ⚠️ {t("first_mention.joined_at_rejoin")}
                    </p>
                  )}
                  <Divider />

                  <Row
                    label={result.joined_at_is_rejoin ? `⚠️ ${t("first_mention.earliest")}` : t("first_mention.earliest")}
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
                        {t("first_mention.context")}
                      </p>
                      <p className="text-[#888aaa] text-sm italic leading-relaxed bg-[#1e1e2e] rounded-lg px-3 py-2">
                        "{result.message_context}"
                      </p>
                    </>
                  )}
                  {result.message_link && (
                    <button
                      onClick={() => open(result.message_link!)}
                      className="mt-1 self-start bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
                    >
                      🔗 {t("first_mention.open_message")}
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
            {t("first_mention.result_header", { username: normalizedUsername })}
          </p>
          {!result.first_seen ? (
            <p className="text-[#3a3a5a] text-sm pt-1">{t("first_mention.no_activity")}</p>
          ) : (
            <>
              <Divider />
              <Row label={t("first_mention.first_own_message")} value={fmtDate(result.first_own_message)} />
              <Row label={t("first_mention.first_mention")} value={fmtDate(result.first_mention)} />
              <Row label={t("first_mention.joined_at")} value={fmtDate(result.joined_at)} />
              {result.joined_at_is_rejoin && (
                <p className="text-yellow-500 text-xs italic">
                  ⚠️ {t("first_mention.joined_at_rejoin")}
                </p>
              )}
              <Divider />
              <Row
                label={t("first_mention.earliest")}
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
                    {t("first_mention.context")}
                  </p>
                  <p className="text-[#888aaa] text-sm italic leading-relaxed bg-[#1e1e2e] rounded-lg px-3 py-2">
                    "{result.message_context}"
                  </p>
                </>
              )}
              {result.message_link && (
                <button
                  onClick={() => open(result.message_link!)}
                  className="mt-2 self-start bg-[#1e1e2e] hover:bg-[#3a3a5e] border border-[#3a3a5a] text-[#e0e0f0] text-sm py-1.5 px-3 rounded-lg transition-colors flex items-center gap-2"
                >
                  🔗 {t("first_mention.open_message")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
