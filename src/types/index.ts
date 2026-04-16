// ── Auth ──────────────────────────────────────────────────────────────────────

export interface CredentialsStatus {
  api_id_set: boolean;
  api_hash_set: boolean;
}

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
  joined_date: number | null;
  message_count: number;
  reaction_count: number;
  poll_participations: number;
  quiz_participations: number;
  is_bot: boolean;
}

export interface BotMember {
  user_id: number;
  name: string;
  username: string | null;
}

export interface AnalysisResult {
  chat: ChatInfo;
  members: MemberActivity[];
  members_with_messages: number;
  total_messages: number;
  period_months: number;           // 0 = custom date range
  period_from?: string | null;     // ISO date, set when period_months === 0
  period_to?: string | null;       // ISO date, set when period_months === 0
  total_polls_in_period: number;   // Umfragen (quiz=false) im Zeitraum
  total_quizzes_in_period: number; // Quizze (quiz=true) im Zeitraum
  all_bots: BotMember[];
  own_is_admin: boolean;
  own_can_get_participants: boolean;
  avg_poll_participants: number;
  avg_quiz_participation: number;
}

// ── Members ───────────────────────────────────────────────────────────────────

export interface ChatMember {
  user_id: number;
  name: string;
  username?: string | null;
  joined_at?: string | null; // ISO 8601
}

// ── First-mention ─────────────────────────────────────────────────────────────

export interface FirstMentionResult {
  first_own_message?: string | null;
  first_mention?: string | null;
  first_seen?: string | null;
  message_context?: string | null;
  message_link?: string | null;
  found_in: "own_message" | "mention" | "both" | "not_found";
}

// ── App state ─────────────────────────────────────────────────────────────────

export type AppPhase =
  | 'checking'    // Auth-Status wird geprüft
  | 'login'       // Login-Flow nötig
  | 'main'        // Eingeloggt, Hauptansicht
  | 'analyzing';  // Analyse läuft
