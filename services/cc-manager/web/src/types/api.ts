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
  repo_id?: string;
  worktree_path?: string;
  branch?: string;
}

export interface RepositoryListItem {
  id: string;
  url: string;
  slug: string;
  default_branch: string;
  created_at: number;
  last_fetched_at: number;
}

export interface RepositoryListResponse {
  repositories: RepositoryListItem[];
}

export interface SessionListResponse {
  sessions: SessionListItem[];
}

export interface SshConnectionItem {
  id: string;
  ssh_destination: string;
  tmux_session_name: string;
  title: string;
  created_at: number;
  last_connected_at: number;
}

export interface SshConnectionListResponse {
  connections: SshConnectionItem[];
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
