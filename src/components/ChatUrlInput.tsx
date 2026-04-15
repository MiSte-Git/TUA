import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ChatInfo } from "../types";

interface Props {
  onChatResolved: (chat: ChatInfo, url: string) => void;
  disabled: boolean;
}

interface HistoryEntry {
  url: string;
  title: string;
}

const HISTORY_KEY = "chat_history";
const MAX_HISTORY = 10;

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveToHistory(entry: HistoryEntry, current: HistoryEntry[]): HistoryEntry[] {
  const filtered = current.filter((h) => h.url !== entry.url);
  const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

export default function ChatUrlInput({ onChatResolved, disabled }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ChatInfo | null>(null);
  const [manualCount, setManualCount] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showDropdown, setShowDropdown] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = url.trim()
    ? history.filter(
        (h) =>
          h.url.toLowerCase().includes(url.toLowerCase()) ||
          h.title.toLowerCase().includes(url.toLowerCase())
      )
    : history;

  async function resolveUrl(targetUrl: string) {
    if (!targetUrl.trim()) return;
    setShowDropdown(false);
    setError(null);
    setLoading(true);
    setResolved(null);
    try {
      const chat = await invoke<ChatInfo>("resolve_chat", { chatUrl: targetUrl });
      setResolved(chat);
      onChatResolved(chat, targetUrl);
      setHistory((prev) => saveToHistory({ url: targetUrl, title: chat.title }, prev));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleFocus() {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    if (history.length > 0) setShowDropdown(true);
  }

  function handleBlur() {
    blurTimerRef.current = setTimeout(() => setShowDropdown(false), 150);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setUrl(val);
    setResolved(null);
    setError(null);
    setShowDropdown(true);
  }

  function handleSuggestionClick(entry: HistoryEntry) {
    setUrl(entry.url);
    setShowDropdown(false);
    resolveUrl(entry.url);
  }

  function handleManualCountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setManualCount(val);
    if (resolved) {
      const count = parseInt(val, 10);
      const updated = { ...resolved, member_count: isNaN(count) ? null : count };
      setResolved(updated);
      onChatResolved(updated, url);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-[#888aaa] text-xs font-medium uppercase tracking-wide">
        Chat-URL
      </label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="https://t.me/..."
            value={url}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading && !disabled) {
                resolveUrl(url);
              } else if (e.key === "Escape") {
                setShowDropdown(false);
              }
            }}
            disabled={disabled}
            className="bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-3 py-2 rounded-lg w-full text-[#e0e0f0] placeholder-[#888aaa] text-sm"
          />

          {showDropdown && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e1e2e] border border-[#3a3a5a] rounded-lg shadow-xl z-50 overflow-hidden">
              {suggestions.map((h) => (
                <button
                  key={h.url}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSuggestionClick(h)}
                  className="w-full text-left px-3 py-2 hover:bg-[#2a2a3e] transition-colors border-b border-[#2a2a3e] last:border-b-0"
                >
                  <p className="text-[#e0e0f0] text-sm font-medium leading-tight truncate">
                    {h.title}
                  </p>
                  <p className="text-[#888aaa] text-xs leading-tight truncate">{h.url}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => resolveUrl(url)}
          disabled={loading || disabled || !url.trim()}
          className="bg-[#7c6af7] hover:bg-[#6a58e0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? t("chat.loading") : t("chat.connect")}
        </button>
      </div>

      {resolved && (
        <div className="bg-[#1e1e2e] rounded-lg px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[#e0e0f0] text-sm font-medium">{resolved.title}</p>
            {resolved.username && (
              <p className="text-[#888aaa] text-xs">@{resolved.username}</p>
            )}
          </div>
          <div className="text-right">
            {resolved.member_count !== null ? (
              <p className="text-[#7c6af7] text-sm font-semibold">
                {t("chat.member_count", { count: resolved.member_count.toLocaleString("de-CH") })}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[#888aaa] text-xs">Mitglieder:</span>
                <input
                  type="number"
                  placeholder="?"
                  value={manualCount}
                  onChange={handleManualCountChange}
                  className="bg-[#2a2a3e] border border-[#3a3a5a] rounded px-2 py-1 w-20 text-sm text-[#e0e0f0] text-right"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-[#e05555] text-sm bg-[#1e1e2e] rounded-lg px-3 py-2">{error}</p>
      )}
    </div>
  );
}
