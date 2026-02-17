import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/utils";
import type { SessionListItem } from "@/types/api";

interface SessionCardProps {
  session: SessionListItem;
  onClick: () => void;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function SessionCard({ session, onClick }: SessionCardProps) {
  return (
    <Card
      className="flex items-center gap-2.5 p-3 cursor-pointer transition-colors hover:bg-secondary/60 mb-2.5"
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
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </Card>
  );
}
