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
  totalCostUsd?: number;
  durationSeconds?: number;
}

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";
export type SessionPermissionMode = "default" | "plan" | "bypassPermissions";
export type ToolPermissionUpdatedInput = Record<string, unknown>;

export type RespondPermissionHandler = (
  permissionRequestId: string,
  decision: "allow" | "deny",
  message?: string,
  mode?: PermissionMode,
  updatedInput?: ToolPermissionUpdatedInput,
) => void;

export interface ToolPermissionRequestState {
  permissionRequestId: string;
  promptRequestId: string;
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  message?: string;
  mode?: PermissionMode;
}

export interface ChatMessage {
  role: "user" | "assistant";
  requestId: string | null;
  contentBlocks: ContentBlockState[];
  streamStartTime?: number;
}
