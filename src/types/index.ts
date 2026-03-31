// ── Auth ──────────────────────────────────────────────────────────────────────

export type ConnectStatus = 'ok' | 'code_required' | 'password_required';

export interface ConnectResult {
  status: ConnectStatus;
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface ChatInfo {
  id: number;
  title: string;
  username: string | null;
  member_count: number | null;
}

export interface MemberActivity {
  user_id: number;
  name: string;
  username: string | null;
  message_count: number;
  reaction_count: number;
}

export interface AnalysisResult {
  chat: ChatInfo;
  members: MemberActivity[];
  members_with_messages: number;
  total_messages: number;
  period_months: number;
}

// ── App state ─────────────────────────────────────────────────────────────────

export type AppPhase =
  | 'checking'    // Auth-Status wird geprüft
  | 'login'       // Login-Flow nötig
  | 'main'        // Eingeloggt, Hauptansicht
  | 'analyzing';  // Analyse läuft
