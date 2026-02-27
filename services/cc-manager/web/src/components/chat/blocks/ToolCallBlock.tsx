import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Search,
  Globe,
  Wrench,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ContentBlockState,
  PermissionMode,
  ToolPermissionRequestState,
} from "@/types/chat";
import { ToolInput } from "./ToolInput";
import { ExitPlanModeApproval } from "./ExitPlanModeApproval";

interface ToolCallBlockProps {
  block: ContentBlockState;
  result?: ContentBlockState;
  permissionRequest?: ToolPermissionRequestState;
  onRespondPermission?: (
    permissionRequestId: string,
    decision: "allow" | "deny",
    message?: string,
    mode?: PermissionMode,
  ) => void;
  isStreaming?: boolean;
  extraTopSpace?: boolean;
  extraBottomSpace?: boolean;
}

const toolIcons: Record<string, typeof Terminal> = {
  bash: Terminal,
  read: FileText,
  write: FileText,
  edit: FileText,
  notebookedit: FileText,
  grep: Search,
  glob: Search,
  webfetch: Globe,
  websearch: Globe,
};

function ToolIcon({ name }: { name: string }) {
  const Icon = toolIcons[name.toLowerCase()] || Wrench;
  return <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

export function ToolCallBlock({
  block,
  result,
  permissionRequest,
  onRespondPermission,
  isStreaming,
  extraTopSpace,
  extraBottomSpace,
}: ToolCallBlockProps) {
  const isExitPlanMode = (block.toolName || "").toLowerCase() === "exitplanmode";
  const isAwaitingPermission = permissionRequest?.status === "pending";
  const isRunning = isAwaitingPermission || (!!isStreaming && !block.isComplete);
  const isError = result?.isError;

  // null = user hasn't toggled, use auto behavior (expanded while running)
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? (isRunning ?? false);

  const handleToggle = () => {
    setUserExpanded((prev) => !(prev ?? expanded));
  };

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
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <ToolIcon name={block.toolName || ""} />
        <span className="font-medium truncate">{block.toolName}</span>
        {block.elapsedSeconds != null && (
          <span className="text-muted-foreground ml-auto shrink-0">
            {block.elapsedSeconds.toFixed(1)}s
          </span>
        )}
        <span className="shrink-0 ml-1">
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : isError ? (
            <X className="w-3.5 h-3.5 text-destructive" />
          ) : (
            <Check className="w-3.5 h-3.5 text-green-600" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {block.toolInput && (!isExitPlanMode || !permissionRequest) && (
            <ToolInput toolName={block.toolName || ""} toolInput={block.toolInput} />
          )}
          {isExitPlanMode && permissionRequest && onRespondPermission && (
            <div className={cn(block.toolInput ? "border-t border-border" : undefined)}>
              <ExitPlanModeApproval
                request={permissionRequest}
                onRespond={onRespondPermission}
              />
            </div>
          )}
          {result?.text && (
            <div className="border-t border-border">
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground p-2 max-h-60 overflow-y-auto">
                {result.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
