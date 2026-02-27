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

export function SessionCard({ session, onClick, onOpenTerminal }: SessionCardProps) {
  return (
    <Card
      className="flex items-center gap-2.5 p-3 cursor-pointer transition-colors duration-150 hover:bg-foreground/[0.06] mb-2.5"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">
          {session.title || "Untitled session"}
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
