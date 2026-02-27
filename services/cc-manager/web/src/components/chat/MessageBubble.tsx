import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ContentBlockState,
  PermissionMode,
  ToolPermissionRequestState,
} from "@/types/chat";
import { TextBlock } from "./blocks/TextBlock";
import { ToolCallBlock } from "./blocks/ToolCallBlock";
import { ThinkingBlock } from "./blocks/ThinkingBlock";
import { ResultBar } from "./blocks/ResultBar";

interface MessageBubbleProps {
  role: "user" | "assistant";
  contentBlocks: ContentBlockState[];
  permissionRequests: ToolPermissionRequestState[];
  onRespondPermission: (
    permissionRequestId: string,
    decision: "allow" | "deny",
    message?: string,
    mode?: PermissionMode,
  ) => void;
  rawJson: unknown;
  isStreaming?: boolean;
}

export function MessageBubble({
  role,
  contentBlocks,
  permissionRequests,
  onRespondPermission,
  rawJson,
  isStreaming,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopyRawJson = async () => {
    if (!navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(rawJson, null, 2));
      setCopied(true);
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      // no-op: clipboard can fail in restricted environments
    }
  };

  if (role === "user") {
    const text = contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return (
      <div className="flex justify-end">
        <div className="relative max-w-[80%] pl-3.5 pr-10 py-2.5 rounded-2xl text-sm leading-relaxed break-words bg-user-bubble rounded-br-sm">
          <CopyRawJsonButton copied={copied} onClick={handleCopyRawJson} />
          <TextBlock text={text} isStreaming={false} />
        </div>
      </div>
    );
  }

  // Build a map of tool_result blocks keyed by toolResultForId
  const toolResults = new Map<string, ContentBlockState>();
  for (const block of contentBlocks) {
    if (block.type === "tool_result" && block.toolResultForId) {
      toolResults.set(block.toolResultForId, block);
    }
  }

  const visibleBlocks = contentBlocks.filter((block) => block.type !== "tool_result");

  // Find the last text block index for streaming cursor
  let lastTextIndex = -1;
  for (let i = visibleBlocks.length - 1; i >= 0; i--) {
    if (visibleBlocks[i].type === "text") {
      lastTextIndex = i;
      break;
    }
  }

  return (
    <div className="flex justify-start">
      <div className="relative max-w-[90%] pl-3.5 pr-10 py-2.5 rounded-2xl rounded-bl-sm bg-card border border-border text-sm leading-relaxed break-words">
        <CopyRawJsonButton copied={copied} onClick={handleCopyRawJson} />
        {visibleBlocks.map((block, i) => {
          if (block.type === "text") {
            return (
              <TextBlock
                key={i}
                text={block.text}
                isStreaming={isStreaming && i === lastTextIndex}
              />
            );
          }

          if (block.type === "tool_use") {
            const result = block.toolId ? toolResults.get(block.toolId) : undefined;
            const permissionRequest = findPermissionRequestForTool(
              permissionRequests,
              block.toolId,
            );
            const prevBlock = visibleBlocks[i - 1];
            const nextBlock = visibleBlocks[i + 1];
            return (
              <ToolCallBlock
                key={i}
                block={block}
                result={result}
                permissionRequest={permissionRequest}
                onRespondPermission={onRespondPermission}
                isStreaming={isStreaming}
                extraTopSpace={prevBlock?.type === "text"}
                extraBottomSpace={nextBlock?.type === "text"}
              />
            );
          }

          if (block.type === "thinking") {
            return (
              <ThinkingBlock
                key={i}
                text={block.text}
                isStreaming={isStreaming && !block.isComplete}
              />
            );
          }

          if (block.type === "result") {
            return (
              <ResultBar
                key={i}
                isError={block.isResultError}
                totalCostUsd={block.totalCostUsd}
                durationSeconds={block.durationSeconds}
              />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

function findPermissionRequestForTool(
  requests: ToolPermissionRequestState[],
  toolUseId?: string,
): ToolPermissionRequestState | undefined {
  if (!toolUseId) return undefined;

  // Prefer pending requests if there are multiple records for the same tool call.
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

function CopyRawJsonButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-secondary/70"
      onClick={onClick}
      title={copied ? "Copied JSON" : "Copy raw JSON"}
      aria-label={copied ? "Copied JSON" : "Copy raw JSON"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}
