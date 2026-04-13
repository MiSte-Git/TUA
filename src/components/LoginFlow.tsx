import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import type { ConnectResult, CredentialsStatus } from "../types";

interface Props {
  onSuccess: () => void;
}

type Step = "checking" | "credentials" | "phone" | "code" | "password";

export default function LoginFlow({ onSuccess }: Props) {
  const [step, setStep] = useState<Step>("checking");

  // Credentials form
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [showApiHash, setShowApiHash] = useState(false);
  const [apiIdError, setApiIdError] = useState<string | null>(null);
  const [apiHashError, setApiHashError] = useState<string | null>(null);

  // Login form
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputClass =
    "bg-[#1e1e2e] border border-[#3a3a5a] focus:border-[#7c6af7] outline-none px-3 py-2 rounded-lg w-full text-[#e0e0f0] placeholder-[#888aaa]";
  const btnClass =
    "w-full bg-[#7c6af7] hover:bg-[#6a58e0] text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  // ── Check credentials on mount ─────────────────────────────────────────────
  useEffect(() => {
    invoke<CredentialsStatus>("get_credentials_status")
      .then((status) => {
        if (!status.api_id_set || !status.api_hash_set) {
          setStep("credentials");
        } else {
          setStep("phone");
        }
      })
      .catch(() => setStep("credentials"));
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSaveCredentials() {
    let valid = true;

    const parsed = parseInt(apiId, 10);
    if (!apiId.trim() || isNaN(parsed) || parsed <= 0) {
      setApiIdError("Bitte eine gültige positive Zahl eingeben");
      valid = false;
    } else {
      setApiIdError(null);
    }

    if (apiHash.trim().length !== 32) {
      setApiHashError("Der API Hash muss genau 32 Zeichen lang sein");
      valid = false;
    } else {
      setApiHashError(null);
    }

    if (!valid) return;

    setLoading(true);
    setError(null);
    try {
      await invoke("save_credentials", { apiId: parsed, apiHash: apiHash.trim() });
      setStep("phone");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePhone() {
    setError(null);
    setLoading(true);
    try {
      const res = await invoke<ConnectResult>("connect", { phone });
      if (res.status === "ok") {
        onSuccess();
      } else if (res.status === "code_required") {
        setStep("code");
      } else if (res.status === "password_required") {
        setStep("password");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCode() {
    setError(null);
    setLoading(true);
    try {
      const res = await invoke<ConnectResult>("submit_code", { code });
      if (res.status === "ok") {
        onSuccess();
      } else if (res.status === "password_required") {
        setStep("password");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword() {
    setError(null);
    setLoading(true);
    try {
      await invoke("submit_password", { password });
      onSuccess();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#2a2a3e] rounded-xl p-8 w-full max-w-sm shadow-xl">
      {/* Logo / Title */}
      <h1 className="text-2xl font-bold text-[#7c6af7] mb-1">
        Telegram User Activities
      </h1>
      <p className="text-[#888aaa] text-sm mb-6">
        {step === "credentials" ? "API Zugangsdaten" : "Bitte anmelden"}
      </p>

      {/* Checking step */}
      {step === "checking" && (
        <p className="text-[#888aaa] text-sm animate-pulse">
          Überprüfe Konfiguration…
        </p>
      )}

      {/* Credentials step */}
      {step === "credentials" && (
        <div className="flex flex-col gap-4">
          {/* API ID */}
          <div className="flex flex-col gap-1">
            <label className="text-[#e0e0f0] text-sm font-medium">API ID</label>
            <input
              type="number"
              placeholder="12345678"
              value={apiId}
              onChange={(e) => { setApiId(e.target.value); setApiIdError(null); }}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleSaveCredentials()}
              className={inputClass}
              autoFocus
              min={1}
            />
            {apiIdError && (
              <p className="text-red-400 text-xs">{apiIdError}</p>
            )}
          </div>

          {/* API Hash */}
          <div className="flex flex-col gap-1">
            <label className="text-[#e0e0f0] text-sm font-medium">API Hash</label>
            <div className="relative">
              <input
                type={showApiHash ? "text" : "password"}
                placeholder="abcdef1234567890abcdef1234567890"
                value={apiHash}
                onChange={(e) => { setApiHash(e.target.value); setApiHashError(null); }}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleSaveCredentials()}
                className={inputClass + " pr-10"}
              />
              <button
                type="button"
                onClick={() => setShowApiHash((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888aaa] hover:text-[#e0e0f0] text-lg leading-none"
                tabIndex={-1}
              >
                {showApiHash ? "🙈" : "👁"}
              </button>
            </div>
            {apiHashError && (
              <p className="text-red-400 text-xs">{apiHashError}</p>
            )}
          </div>

          {/* Info link */}
          <p className="text-[#888aaa] text-xs">
            Diese Zugangsdaten erhältst du auf{" "}
            <button
              type="button"
              onClick={() => open("https://my.telegram.org")}
              className="text-[#7c6af7] underline hover:text-[#a090ff] transition-colors"
            >
              my.telegram.org
            </button>
          </p>

          <button
            onClick={handleSaveCredentials}
            disabled={loading || !apiId.trim() || !apiHash.trim()}
            className={btnClass}
          >
            {loading ? "Speichere…" : "Speichern und weiter"}
          </button>
        </div>
      )}

      {/* Phone step */}
      {step === "phone" && (
        <div className="flex flex-col gap-4">
          <label className="text-[#e0e0f0] text-sm font-medium">
            Telefonnummer
          </label>
          <input
            type="tel"
            placeholder="+41791234567 oder 0041791234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handlePhone()}
            className={inputClass}
            autoFocus
          />
          <button
            onClick={handlePhone}
            disabled={loading || !phone.trim()}
            className={btnClass}
          >
            {loading ? "Verbinde…" : "Weiter"}
          </button>

          {/* Link to change credentials */}
          <button
            type="button"
            onClick={() => { setStep("credentials"); setError(null); }}
            className="text-[#888aaa] text-xs hover:text-[#e0e0f0] transition-colors underline self-center"
          >
            API Credentials ändern
          </button>
        </div>
      )}

      {/* Code step */}
      {step === "code" && (
        <div className="flex flex-col gap-4">
          <label className="text-[#e0e0f0] text-sm font-medium">
            SMS-Code eingeben
          </label>
          <p className="text-[#888aaa] text-xs">
            Telegram hat einen Code an {phone} gesendet.
          </p>
          <div className="relative">
            <input
              type={showCode ? "text" : "password"}
              placeholder="12345"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleCode()}
              className={inputClass + " pr-10"}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowCode((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888aaa] hover:text-[#e0e0f0] text-lg leading-none"
              tabIndex={-1}
            >
              {showCode ? "🙈" : "👁"}
            </button>
          </div>
          <button
            onClick={handleCode}
            disabled={loading || !code.trim()}
            className={btnClass}
          >
            {loading ? "Prüfe Code…" : "Bestätigen"}
          </button>
        </div>
      )}

      {/* Password step */}
      {step === "password" && (
        <div className="flex flex-col gap-4">
          <label className="text-[#e0e0f0] text-sm font-medium">
            Telegram-Passwort eingeben
          </label>
          {capsLock && (
            <p className="text-yellow-400 text-xs">⚠️ Caps Lock ist aktiviert</p>
          )}
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Passwort"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                setCapsLock(e.getModifierState("CapsLock"));
                if (e.key === "Enter" && !loading) handlePassword();
              }}
              className={inputClass + " pr-10"}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888aaa] hover:text-[#e0e0f0] text-lg leading-none"
              tabIndex={-1}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
          <button
            onClick={handlePassword}
            disabled={loading || !password}
            className={btnClass}
          >
            {loading ? "Anmelden…" : "Anmelden"}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-4 text-[#e05555] text-sm bg-[#1e1e2e] rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
