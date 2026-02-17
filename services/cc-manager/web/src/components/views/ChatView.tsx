import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ChatInput } from "@/components/chat/ChatInput";
import type { ChatMessage } from "@/types/chat";

interface ChatViewProps {
  messages: ChatMessage[];
  activeRequestIds: Set<string>;
  onSend: (text: string) => void;
}

export function ChatView({
  messages,
  activeRequestIds,
  onSend,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages]);

  const isStreaming = activeRequestIds.size > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScrollArea
        ref={scrollRef}
        className="flex-1 p-4 flex flex-col gap-2.5"
      >
        <div className="flex flex-col gap-2.5">
          {messages.map((msg, i) => {
            const isActive =
              msg.requestId !== null && activeRequestIds.has(msg.requestId);
            const showTyping =
              msg.role === "assistant" && msg.contentBlocks.length === 0 && isActive;

            if (showTyping) {
              return <TypingIndicator key={i} />;
            }

            if (msg.contentBlocks.length === 0 && !isActive) return null;

            return (
              <MessageBubble
                key={i}
                role={msg.role}
                contentBlocks={msg.contentBlocks}
                isStreaming={isActive}
              />
            );
          })}
        </div>
      </ScrollArea>
      <ChatInput onSend={onSend} disabled={isStreaming} />
    </div>
  );
}
