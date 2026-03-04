import { useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  GitBranch,
  Globe,
  FileText,
  List,
  ListChecks,
  ListPlus,
  ListX,
  Loader2,
  Map,
  MessageCircleQuestion,
  Check,
  Search,
  SquareTerminal,
  Terminal,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ContentBlockState,
  RespondPermissionHandler,
  ToolPermissionRequestState,
} from "@/types/chat";
import { ToolInput } from "./ToolInput";
import { AskUserQuestionApproval } from "./AskUserQuestionApproval";
import { ExitPlanModeMessage } from "./ExitPlanModeMessage";

interface ToolCallBlockProps {
  block: ContentBlockState;
  result?: ContentBlockState;
  permissionRequest?: ToolPermissionRequestState;
  onRespondPermission?: RespondPermissionHandler;
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
  agent: Bot,
  taskcreate: ListPlus,
  taskupdate: ListChecks,
  taskget: ClipboardList,
  tasklist: List,
  taskoutput: SquareTerminal,
  taskstop: ListX,
  enterplanmode: Map,
  enterworktree: GitBranch,
  skill: Zap,
  askuserquestion: MessageCircleQuestion,
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
  const toolName = block.toolName || "";
  const isExitPlanMode = isExitPlanModeTool(toolName);
  const isAskUserQuestion =
    isAskUserQuestionTool(toolName) || hasAskUserQuestionPayload(block.toolInput);
  const hasInteractivePermissionUi =
    isAskUserQuestion &&
    !!permissionRequest &&
    !!onRespondPermission;
  const isAwaitingPermission = permissionRequest?.status === "pending";
  const isRunning = isAwaitingPermission || (!!isStreaming && !block.isComplete);
  const isError = result?.isError;

  // null = user hasn't toggled, use auto behavior (expanded while running)
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? (isRunning ?? false);

  const handleToggle = () => {
    setUserExpanded((prev) => !(prev ?? expanded));
  };

  if (isExitPlanMode) {
    return (
      <ExitPlanModeMessage
        block={block}
        permissionRequest={permissionRequest}
        onRespondPermission={onRespondPermission}
        extraTopSpace={extraTopSpace}
        extraBottomSpace={extraBottomSpace}
      />
    );
  }

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
        className="w-full flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-secondary/50 transition-colors"
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
          {block.toolInput && !hasInteractivePermissionUi && (
            <ToolInput toolName={block.toolName || ""} toolInput={block.toolInput} />
          )}
          {isAskUserQuestion && permissionRequest && onRespondPermission && (
            <div className={cn(block.toolInput ? "border-t border-border" : undefined)}>
              <AskUserQuestionApproval
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

function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isExitPlanModeTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return normalized === "exitplanmode" || normalized.endsWith("exitplanmode");
}

function isAskUserQuestionTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return (
    normalized === "askuserquestion" ||
    normalized.endsWith("askuserquestion") ||
    normalized.includes("askuserquestion")
  );
}

function hasAskUserQuestionPayload(toolInput?: string): boolean {
  if (!toolInput) return false;

  try {
    const parsed = JSON.parse(toolInput) as Record<string, unknown>;
    const questions = parsed.questions;
    return Array.isArray(questions) && questions.length > 0;
  } catch {
    return false;
  }
}
