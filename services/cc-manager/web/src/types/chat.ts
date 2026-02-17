export interface ContentBlockState {
  type: "text" | "tool_use" | "thinking" | "tool_result" | "result";
  text: string;
  // tool_use
  toolName?: string;
  toolId?: string;
  toolInput?: string;
  isComplete?: boolean;
  elapsedSeconds?: number;
  // tool_result (from tool_use_summary, linked to a tool block)
  toolResultForId?: string;
  isError?: boolean;
  // result (from SDK result message)
  isResultError?: boolean;
  totalCostUsd?: number;
  durationSeconds?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  requestId: string | null;
  contentBlocks: ContentBlockState[];
  streamStartTime?: number;
}
