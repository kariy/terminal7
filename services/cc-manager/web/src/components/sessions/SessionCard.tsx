import { ChevronRight, TerminalSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";
import type { SessionListItem } from "@/types/api";

interface SessionCardProps {
  session: SessionListItem;
  onClick: () => void;
  onOpenTerminal?: () => void;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
  );
}

export function SessionCard({ session, onClick, onOpenTerminal }: SessionCardProps) {
  const isDiscord = session.origin === "discord";

  return (
    <Card
      className="flex items-center gap-2.5 p-3 cursor-pointer transition-colors duration-150 hover:bg-foreground/[0.06] mb-2.5"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-semibold truncate">
            {session.title || "Untitled session"}
          </div>
          {isDiscord && (
            <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400">
              <DiscordIcon className="h-2.5 w-2.5" />
              Discord
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {session.cwd || ""}
        </div>
        <div className="text-[11px] text-muted-foreground/70 mt-0.5">
          {relativeTime(session.last_activity_at || session.updated_at)}
          {" \u00B7 "}
          {session.message_count || 0} messages
          {session.total_cost_usd > 0 && (
            <>
              {" \u00B7 "}
              {formatCost(session.total_cost_usd)}
            </>
          )}
        </div>
      </div>
      {onOpenTerminal && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            onOpenTerminal();
          }}
          title="Open in terminal"
        >
          <TerminalSquare className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </Card>
  );
}
