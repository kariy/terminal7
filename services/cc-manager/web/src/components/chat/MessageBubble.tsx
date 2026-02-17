import { cn } from "@/lib/utils";
import type { ContentBlockState } from "@/types/chat";
import { TextBlock } from "./blocks/TextBlock";
import { ToolCallBlock } from "./blocks/ToolCallBlock";
import { ThinkingBlock } from "./blocks/ThinkingBlock";
import { ResultBar } from "./blocks/ResultBar";

interface MessageBubbleProps {
  role: "user" | "assistant";
  contentBlocks: ContentBlockState[];
  isStreaming?: boolean;
}

export function MessageBubble({ role, contentBlocks, isStreaming }: MessageBubbleProps) {
  if (role === "user") {
    const text = contentBlocks.map((b) => b.text).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words bg-user-bubble rounded-br-sm">
          <span className="whitespace-pre-wrap">{text}</span>
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

  // Find the last text block index for streaming cursor
  let lastTextIndex = -1;
  for (let i = contentBlocks.length - 1; i >= 0; i--) {
    if (contentBlocks[i].type === "text") {
      lastTextIndex = i;
      break;
    }
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-card border border-border text-sm leading-relaxed break-words">
        {contentBlocks.map((block, i) => {
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
            return (
              <ToolCallBlock
                key={i}
                block={block}
                result={result}
                isStreaming={isStreaming}
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

          if (block.type === "tool_result") {
            // Rendered inside ToolCallBlock
            return null;
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
