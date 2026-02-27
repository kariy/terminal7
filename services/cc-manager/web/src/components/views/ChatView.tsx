import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ChatInput, type FileSuggestion } from "@/components/chat/ChatInput";
import type {
  ChatMessage,
  PermissionMode,
  SessionPermissionMode,
  ToolPermissionRequestState,
} from "@/types/chat";

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
  sessionPermissionMode: SessionPermissionMode;
  onSend: (text: string) => void;
  onFileSearch: (query: string | null) => void;
  onPermissionModeChange: (mode: SessionPermissionMode) => void;
  onCyclePermissionMode: () => void;
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
  sessionPermissionMode,
  onSend,
  onFileSearch,
  onPermissionModeChange,
  onCyclePermissionMode,
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Tab" || !event.shiftKey) return;
      event.preventDefault();
      onCyclePermissionMode();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCyclePermissionMode]);

  const isStreaming = activeRequestIds.size > 0;
  const showHistorySkeleton = historyLoading && messages.length === 0 && !isStreaming;
  const modeOptions: Array<{ value: SessionPermissionMode; label: string }> = [
    { value: "default", label: "Default" },
    { value: "plan", label: "Plan" },
    { value: "bypassPermissions", label: "Bypass" },
  ];
  const activeModeIndex = modeOptions.findIndex(
    (option) => option.value === sessionPermissionMode,
  );
  const sliderColorClass =
    sessionPermissionMode === "plan"
      ? "bg-green-100"
      : sessionPermissionMode === "bypassPermissions"
        ? "bg-red-100"
        : "bg-secondary";

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
      <div className="px-3 pt-2 pb-0.5 bg-background">
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/25 p-1">
          <span className="px-2 text-[11px] font-medium text-muted-foreground">
            Mode
          </span>
          <div className="relative grid grid-cols-3 rounded-md bg-background/70 p-0.5">
            <div className="pointer-events-none absolute inset-0 p-0.5">
              <div
                className={`h-full w-1/3 rounded-[5px] shadow-sm transition-transform transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sliderColorClass}`}
                style={{ transform: `translateX(${Math.max(activeModeIndex, 0) * 100}%)` }}
              />
            </div>
            {modeOptions.map((option) => {
              const selected = sessionPermissionMode === option.value;
              const textClass = selected
                ? option.value === "plan"
                  ? "text-green-900"
                  : option.value === "bypassPermissions"
                    ? "text-red-900"
                    : "text-foreground"
                : option.value === "plan"
                  ? "text-green-800/70 hover:text-green-900"
                  : option.value === "bypassPermissions"
                    ? "text-red-800/70 hover:text-red-900"
                    : "text-muted-foreground hover:text-foreground";

              return (
                <button
                  key={option.value}
                  type="button"
                  className={`relative z-10 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${textClass}`}
                  onClick={() => onPermissionModeChange(option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <ChatInput
        onSend={onSend}
        onFileSearch={onFileSearch}
        onCyclePermissionMode={onCyclePermissionMode}
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
