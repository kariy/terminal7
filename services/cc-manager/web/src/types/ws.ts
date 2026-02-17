// Server → Client messages

import type { SDKMessage } from "./sdk-messages";

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
}

export interface WsSessionStateMessage {
  type: "session.state";
  request_id?: string;
  session_id?: string;
  encoded_cwd?: string;
  status: string;
  stats?: unknown;
}

export interface WsStreamMessageMessage {
  type: "stream.message";
  request_id: string;
  session_id?: string;
  sdk_message: SDKMessage;
}

export interface WsStreamDoneMessage {
  type: "stream.done";
  request_id: string;
  session_id?: string;
  encoded_cwd: string;
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

export type WsServerMessage =
  | WsHelloMessage
  | WsSessionCreatedMessage
  | WsSessionStateMessage
  | WsStreamMessageMessage
  | WsStreamDoneMessage
  | WsErrorMessage
  | WsPongMessage;

// Client → Server messages

export interface WsSessionCreateMessage {
  type: "session.create";
  request_id?: string;
  prompt: string;
  cwd?: string;
  title?: string;
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

export type WsClientMessage =
  | WsSessionCreateMessage
  | WsSessionSendMessage
  | WsSessionStopMessage
  | WsRefreshIndexMessage
  | WsPingMessage;
