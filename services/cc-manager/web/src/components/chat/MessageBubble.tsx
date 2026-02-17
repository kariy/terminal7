import { cn } from "@/lib/utils";
import type { ContentBlockState } from "@/components/views/ChatView";

interface MessageBubbleProps {
  role: "user" | "assistant";
  contentBlocks: ContentBlockState[];
}

export function MessageBubble({ role, contentBlocks }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words",
          isUser
            ? "bg-user-bubble rounded-br-sm"
            : "bg-card border border-border rounded-bl-sm",
        )}
      >
        {contentBlocks.map((block, i) => {
          if (block.type === "text") {
            return (
              <span key={i} className="whitespace-pre-wrap">
                {block.text}
              </span>
            );
          }

          if (block.type === "tool_use") {
            return (
              <div key={i} className="text-xs text-muted-foreground italic my-1">
                Using {block.toolName}...
              </div>
            );
          }

          if (block.type === "thinking") {
            return (
              <div key={i} className="text-xs text-muted-foreground italic my-1 whitespace-pre-wrap">
                {block.text}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
