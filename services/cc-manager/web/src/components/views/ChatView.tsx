import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ChatInput, type FileSuggestion } from "@/components/chat/ChatInput";
import type { ChatMessage, PermissionMode, ToolPermissionRequestState } from "@/types/chat";

interface Turn {
  userMessage: ChatMessage | null;
  assistantMessages: ChatMessage[];
}

function groupIntoTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      current = { userMessage: msg, assistantMessages: [] };
      turns.push(current);
    } else {
      if (!current) {
        current = { userMessage: null, assistantMessages: [] };
        turns.push(current);
      }
      current.assistantMessages.push(msg);
    }
  }

  return turns;
}

interface ChatViewProps {
  messages: ChatMessage[];
  historyLoading: boolean;
  permissionRequests: ToolPermissionRequestState[];
  activeRequestIds: Set<string>;
  onSend: (text: string) => void;
  onFileSearch: (query: string | null) => void;
  onRespondPermission: (
    permissionRequestId: string,
    decision: "allow" | "deny",
    message?: string,
    mode?: PermissionMode,
  ) => void;
  fileSuggestions: FileSuggestion[];
  fileIndexing: boolean;
}

export function ChatView({
  messages,
  historyLoading,
  permissionRequests,
  activeRequestIds,
  onSend,
  onFileSearch,
  onRespondPermission,
  fileSuggestions,
  fileIndexing,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, activeRequestIds]);

  const isStreaming = activeRequestIds.size > 0;
  const showHistorySkeleton = historyLoading && messages.length === 0 && !isStreaming;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ScrollArea
        ref={scrollRef}
        className="flex-1 min-h-0 p-4"
      >
        <div className="flex flex-col gap-2.5">
          {groupIntoTurns(messages).map((turn, i) => {
            const mergedBlocks = turn.assistantMessages.flatMap(
              (m) => m.contentBlocks
            );
            const isActive = turn.assistantMessages.some(
              (m) => m.requestId !== null && activeRequestIds.has(m.requestId)
            );
            const showTyping = mergedBlocks.length === 0 && isActive;

            return (
              <div key={i} className="flex flex-col gap-2.5">
                {turn.userMessage &&
                  turn.userMessage.contentBlocks.length > 0 && (
                    <MessageBubble
                      role="user"
                      contentBlocks={turn.userMessage.contentBlocks}
                      permissionRequests={permissionRequests}
                      onRespondPermission={onRespondPermission}
                      rawJson={turn.userMessage}
                      isStreaming={false}
                    />
                  )}
                {showTyping ? (
                  <TypingIndicator />
                ) : mergedBlocks.length > 0 ? (
                  <MessageBubble
                    role="assistant"
                    contentBlocks={mergedBlocks}
                    permissionRequests={permissionRequests}
                    onRespondPermission={onRespondPermission}
                    rawJson={
                      turn.assistantMessages.length === 1
                        ? turn.assistantMessages[0]
                        : turn.assistantMessages
                    }
                    isStreaming={isActive}
                  />
                ) : null}
              </div>
            );
          })}
          {showHistorySkeleton && <HistorySkeletonBubble />}
        </div>
      </ScrollArea>
      <ChatInput
        onSend={onSend}
        onFileSearch={onFileSearch}
        fileSuggestions={fileSuggestions}
        fileIndexing={fileIndexing}
        disabled={isStreaming}
      />
    </div>
  );
}

function HistorySkeletonBubble() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5">
        <div className="animate-pulse">
          <div className="h-3.5 w-64 max-w-[70vw] rounded bg-muted" />
          <div className="mt-2 h-3.5 w-52 max-w-[55vw] rounded bg-muted" />
          <div className="mt-2 h-3.5 w-40 max-w-[40vw] rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
