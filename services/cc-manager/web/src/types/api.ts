export interface SessionListItem {
  session_id: string;
  encoded_cwd: string;
  cwd: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  source: string;
  message_count: number;
  total_cost_usd: number;
}

export interface SessionListResponse {
  sessions: SessionListItem[];
}

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  content_blocks?: unknown[];
  uuid?: string;
}

export interface SessionHistoryResponse {
  session_id: string;
  encoded_cwd: string;
  messages: HistoryMessage[];
  next_cursor: number | null;
  total_messages: number;
}
