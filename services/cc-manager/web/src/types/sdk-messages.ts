// Minimal SDK message types for browser rendering.
// Hand-written to avoid importing the Node.js-dependent SDK package.

// ── Content blocks & deltas ─────────────────────────────────────

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ThinkingContentBlock {
  type: "thinking";
  thinking: string;
}

export type ContentBlock =
  | TextContentBlock
  | ToolUseContentBlock
  | ThinkingContentBlock;

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface InputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

export interface ThinkingDelta {
  type: "thinking_delta";
  thinking: string;
}

export type ContentDelta = TextDelta | InputJsonDelta | ThinkingDelta;

// ── Stream event payloads ───────────────────────────────────────

export interface ContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: ContentBlock;
}

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: ContentDelta;
}

export interface ContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface MessageStartEvent {
  type: "message_start";
  message: unknown;
}

export interface MessageDeltaEvent {
  type: "message_delta";
  delta: unknown;
  usage?: unknown;
}

export interface MessageStopEvent {
  type: "message_stop";
}

export type StreamEventPayload =
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageStopEvent;

// ── Top-level SDK messages ──────────────────────────────────────

export interface SDKStreamEvent {
  type: "stream_event";
  event: StreamEventPayload;
}

export interface SDKResultMessage {
  type: "result";
  subtype: string;
  is_error: boolean;
  total_cost_usd?: number;
  errors?: unknown[];
  result?: string;
  session_id?: string;
}

export interface SDKToolProgressMessage {
  type: "tool_progress";
  tool_name: string;
  elapsed_time_seconds?: number;
}

export interface SDKToolUseSummaryMessage {
  type: "tool_use_summary";
  summary: string;
}

export interface SDKSystemInitMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  model?: string;
  tools?: unknown[];
}

export interface SDKUnknownMessage {
  type: string;
  [key: string]: unknown;
}

export type SDKMessage =
  | SDKStreamEvent
  | SDKResultMessage
  | SDKToolProgressMessage
  | SDKToolUseSummaryMessage
  | SDKSystemInitMessage
  | SDKUnknownMessage;
