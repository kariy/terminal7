import { useCallback, type UIEvent } from "react";
import { Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionCard } from "@/components/sessions/SessionCard";
import { EmptyState } from "@/components/sessions/EmptyState";
import type { SessionListItem } from "@/types/api";

interface SessionsViewProps {
  sessions: SessionListItem[];
  loading: boolean;
  onRefresh: () => void;
  onOpenSession: (index: number) => void;
  onNewSession: () => void;
  onOpenTerminal?: (index: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
}

export function SessionsView({
  sessions,
  loading,
  onRefresh,
  onOpenSession,
  onNewSession,
  onOpenTerminal,
  onLoadMore,
  hasMore,
  loadingMore,
}: SessionsViewProps) {
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMore || loadingMore) return;
      const target = event.currentTarget;
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remaining < 200) {
        onLoadMore();
      }
    },
    [hasMore, loadingMore, onLoadMore],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center px-4 py-4 gap-2.5 shrink-0">
        <h2 className="flex-1 text-xl font-semibold">Sessions</h2>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          disabled={loading}
          onClick={onRefresh}
          title="Refresh"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea
        className="flex-1 px-4 pb-24"
        onScroll={handleScroll}
      >
        {loading ? (
          <SessionsSkeleton />
        ) : sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {sessions.map((session, i) => (
              <SessionCard
                key={session.session_id + session.encoded_cwd}
                session={session}
                onClick={() => onOpenSession(i)}
                onOpenTerminal={onOpenTerminal ? () => onOpenTerminal(i) : undefined}
              />
            ))}
            {loadingMore && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Loading more sessions...
              </div>
            )}
          </>
        )}
      </ScrollArea>
      <Button
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-10"
        onClick={onNewSession}
      >
        <Plus className="h-7 w-7" />
      </Button>
    </div>
  );
}

function SessionsSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="mb-2.5 rounded-lg border bg-card p-3"
        >
          <div className="animate-pulse">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="mt-2 h-3 w-full rounded bg-muted" />
            <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      ))}
    </>
  );
}
