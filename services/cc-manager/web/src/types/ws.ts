// Server → Client messages

import type { SDKMessage } from "./sdk-messages";

export interface WsSessionMeta {
  session_id: string;
  encoded_cwd: string;
  cwd: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  source: string;
  total_cost_usd: number;
  repo_id?: string;
  worktree_path?: string;
  branch?: string;
}

export interface WsHelloMessage {
  type: "hello";
  requires_auth: boolean;
  server_time: number;
}

export interface WsSessionCreatedMessage {
  type: "session.created";
  request_id: string;
  session_id: string;
  encoded_cwd: string;
  cwd: string;
  session?: WsSessionMeta;
}

export interface WsSessionStateMessage {
  type: "session.state";
  request_id?: string;
  session_id?: string;
  encoded_cwd?: string;
  status: string;
  stats?: unknown;
  session?: WsSessionMeta;
}

export interface WsStreamMessageMessage {
  type: "stream.message";
  request_id: string;
  session_id?: string;
  sdk_message: SDKMessage;
  session?: WsSessionMeta;
}

export interface WsStreamDoneMessage {
  type: "stream.done";
  request_id: string;
  session_id?: string;
  encoded_cwd: string;
  session?: WsSessionMeta;
}

export interface WsErrorMessage {
  type: "error";
  code: string;
  message: string;
  request_id?: string;
  details?: unknown;
}

export interface WsPongMessage {
  type: "pong";
  server_time: number;
}

export interface WsRepoListItem {
  id: string;
  url: string;
  slug: string;
  default_branch: string;
  created_at: number;
  last_fetched_at: number;
}

export interface WsRepoListMessage {
  type: "repo.list";
  repositories: WsRepoListItem[];
}

export interface WsFileSearchEntry {
  path: string;
  kind: "file" | "dir";
}

export interface WsFileSearchResultMessage {
  type: "file.search.result";
  request_id?: string;
  session_id: string;
  encoded_cwd: string;
  query: string;
  entries: WsFileSearchEntry[];
  indexing: boolean;
  truncated?: boolean;
}

export type WsServerMessage =
  | WsHelloMessage
  | WsSessionCreatedMessage
  | WsSessionStateMessage
  | WsStreamMessageMessage
  | WsStreamDoneMessage
  | WsErrorMessage
  | WsPongMessage
  | WsRepoListMessage
  | WsFileSearchResultMessage;

// Client → Server messages

export interface WsSessionCreateMessage {
  type: "session.create";
  request_id?: string;
  prompt: string;
  cwd?: string;
  title?: string;
  repo_url?: string;
  repo_id?: string;
  branch?: string;
}

export interface WsSessionSendMessage {
  type: "session.send";
  request_id?: string;
  session_id: string;
  encoded_cwd: string;
  prompt: string;
}

export interface WsSessionStopMessage {
  type: "session.stop";
  request_id: string;
}

export interface WsRefreshIndexMessage {
  type: "session.refresh_index";
}

export interface WsPingMessage {
  type: "ping";
}

export interface WsRepoListRequestMessage {
  type: "repo.list";
}

export interface WsFileSearchMessage {
  type: "file.search";
  request_id?: string;
  session_id: string;
  encoded_cwd: string;
  query: string;
  limit?: number;
}

export type WsClientMessage =
  | WsSessionCreateMessage
  | WsSessionSendMessage
  | WsSessionStopMessage
  | WsRefreshIndexMessage
  | WsPingMessage
  | WsRepoListRequestMessage
  | WsFileSearchMessage;
