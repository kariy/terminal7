import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ContentBlockState,
  RespondPermissionHandler,
  ToolPermissionRequestState,
} from "@/types/chat";
import { ToolCallBlock } from "./ToolCallBlock";

interface ToolCallGroupProps {
  blocks: ContentBlockState[];
  toolResults: Map<string, ContentBlockState>;
  permissionRequests: ToolPermissionRequestState[];
  onRespondPermission: RespondPermissionHandler;
  isStreaming?: boolean;
  extraTopSpace?: boolean;
  extraBottomSpace?: boolean;
}

function findPermissionRequestForTool(
  requests: ToolPermissionRequestState[],
  toolUseId?: string,
): ToolPermissionRequestState | undefined {
  if (!toolUseId) return undefined;
  for (let i = requests.length - 1; i >= 0; i--) {
    const request = requests[i];
    if (request?.toolUseId !== toolUseId) continue;
    if (request.status === "pending") return request;
  }
  for (let i = requests.length - 1; i >= 0; i--) {
    const request = requests[i];
    if (request?.toolUseId === toolUseId) return request;
  }
  return undefined;
}

export function ToolCallGroup({
  blocks,
  toolResults,
  permissionRequests,
  onRespondPermission,
  isStreaming,
  extraTopSpace,
  extraBottomSpace,
}: ToolCallGroupProps) {
  const anyRunning = blocks.some((b) => {
    const pr = findPermissionRequestForTool(permissionRequests, b.toolId);
    return pr?.status === "pending" || (isStreaming && !b.isComplete);
  });
  const allComplete = blocks.every((b) => b.isComplete);

  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? (anyRunning || !allComplete);

  const toolNameList = blocks.map((b) => b.toolName || "unknown").join(", ");

  return (
    <div
      className={cn(
        "border rounded-lg bg-secondary/30 overflow-hidden",
        extraTopSpace ? "mt-2.5" : "mt-1.5",
        extraBottomSpace ? "mb-2.5" : "mb-1.5",
      )}
    >
      <button
        type="button"
        onClick={() => setUserExpanded((prev) => !(prev ?? expanded))}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-secondary/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="font-medium shrink-0">
          {blocks.length} tool calls
        </span>
        <span className="text-muted-foreground truncate">
          &mdash; {toolNameList}
        </span>
        <span className="shrink-0 ml-auto">
          {anyRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : (
            <Check className="w-3.5 h-3.5 text-green-600" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-2 py-1.5 space-y-0">
          {blocks.map((block, i) => {
            const result = block.toolId
              ? toolResults.get(block.toolId)
              : undefined;
            const permissionRequest = findPermissionRequestForTool(
              permissionRequests,
              block.toolId,
            );
            return (
              <ToolCallBlock
                key={block.toolId || i}
                block={block}
                result={result}
                permissionRequest={permissionRequest}
                onRespondPermission={onRespondPermission}
                isStreaming={isStreaming}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
