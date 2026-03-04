import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ContentBlockState,
  RespondPermissionHandler,
  ToolPermissionRequestState,
} from "@/types/chat";
import { copyText } from "@/lib/clipboard";
import { TextBlock } from "./blocks/TextBlock";
import { ToolCallBlock } from "./blocks/ToolCallBlock";
import { ToolCallGroup } from "./blocks/ToolCallGroup";
import { ThinkingBlock } from "./blocks/ThinkingBlock";
import { TypingBarsLoader } from "./blocks/TypingBarsLoader";

type Segment =
  | { type: "block"; block: ContentBlockState; index: number }
  | { type: "tool_group"; blocks: ContentBlockState[]; startIndex: number };

function segmentBlocks(blocks: ContentBlockState[]): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < blocks.length) {
    if (blocks[i].type === "tool_use") {
      const start = i;
      while (i < blocks.length && blocks[i].type === "tool_use") {
        i++;
      }
      if (i - start >= 2) {
        segments.push({ type: "tool_group", blocks: blocks.slice(start, i), startIndex: start });
      } else {
        segments.push({ type: "block", block: blocks[start], index: start });
      }
    } else {
      segments.push({ type: "block", block: blocks[i], index: i });
      i++;
    }
  }
  return segments;
}

interface MessageBubbleProps {
  role: "user" | "assistant";
  contentBlocks: ContentBlockState[];
  permissionRequests: ToolPermissionRequestState[];
  onRespondPermission: RespondPermissionHandler;
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
  const [copyFailed, setCopyFailed] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopyRawJson = async () => {
    const textToCopy =
      JSON.stringify(rawJson, null, 2) ?? String(rawJson ?? "");
    const result = await copyText(textToCopy);

    if (result.ok) {
      setCopied(true);
      setCopyFailed(false);
    } else {
      setCopied(false);
      setCopyFailed(true);
    }

    if (copyResetTimerRef.current != null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1500);
  };

  if (role === "user") {
    const text = contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return (
      <div className="flex justify-end">
        <div className="relative max-w-[80%] pl-3.5 pr-10 py-2.5 rounded-2xl text-sm leading-relaxed break-words bg-user-bubble rounded-br-sm">
          <CopyRawJsonButton
            copied={copied}
            copyFailed={copyFailed}
            onClick={handleCopyRawJson}
          />
          <TextBlock text={text} />
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

  return (
    <div className="flex justify-start">
      <div className="relative max-w-[90%] pl-3.5 pr-10 py-2.5 rounded-2xl rounded-bl-sm bg-card border border-border text-sm leading-relaxed break-words">
        <CopyRawJsonButton
          copied={copied}
          copyFailed={copyFailed}
          onClick={handleCopyRawJson}
        />
        {segmentBlocks(visibleBlocks).map((segment, si, segments) => {
          const prevSeg = segments[si - 1];
          const nextSeg = segments[si + 1];
          const prevType = prevSeg
            ? prevSeg.type === "block" ? prevSeg.block.type : "tool_use"
            : undefined;
          const nextType = nextSeg
            ? nextSeg.type === "block" ? nextSeg.block.type : "tool_use"
            : undefined;

          if (segment.type === "tool_group") {
            return (
              <ToolCallGroup
                key={`tg-${segment.startIndex}`}
                blocks={segment.blocks}
                toolResults={toolResults}
                permissionRequests={permissionRequests}
                onRespondPermission={onRespondPermission}
                isStreaming={isStreaming}
                extraTopSpace={prevType === "text"}
                extraBottomSpace={nextType === "text"}
              />
            );
          }

          const { block, index } = segment;

          if (block.type === "text") {
            return <TextBlock key={index} text={block.text} />;
          }

          if (block.type === "tool_use") {
            const result = block.toolId ? toolResults.get(block.toolId) : undefined;
            const permissionRequest = findPermissionRequestForTool(
              permissionRequests,
              block.toolId,
            );
            return (
              <ToolCallBlock
                key={index}
                block={block}
                result={result}
                permissionRequest={permissionRequest}
                onRespondPermission={onRespondPermission}
                isStreaming={isStreaming}
                extraTopSpace={prevType === "text"}
                extraBottomSpace={nextType === "text"}
              />
            );
          }

          if (block.type === "thinking") {
            return (
              <ThinkingBlock
                key={index}
                text={block.text}
                isStreaming={isStreaming && !block.isComplete}
              />
            );
          }

          return null;
        })}
        {isStreaming && (
          <div className="mt-2 flex items-end">
            <TypingBarsLoader />
          </div>
        )}
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

function CopyRawJsonButton({
  copied,
  copyFailed,
  onClick,
}: {
  copied: boolean;
  copyFailed: boolean;
  onClick: () => void;
}) {
  const title = copied
    ? "Copied JSON"
    : copyFailed
      ? "Copy failed"
      : "Copy raw JSON";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`absolute z-20 top-1.5 right-1.5 h-6 w-6 rounded-full hover:bg-secondary/70 ${
        copyFailed
          ? "text-destructive hover:text-destructive"
          : "text-muted-foreground/70 hover:text-foreground"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={title}
      aria-label={title}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : copyFailed ? (
        <X className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
