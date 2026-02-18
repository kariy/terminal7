import { ChevronRight, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";
import type { SshConnectionItem } from "@/types/api";

interface SshConnectionCardProps {
  connection: SshConnectionItem;
  onClick: () => void;
  onDelete: () => void;
}

export function SshConnectionCard({ connection, onClick, onDelete }: SshConnectionCardProps) {
  return (
    <Card
      className="flex items-center gap-2.5 p-3 cursor-pointer transition-colors hover:bg-secondary/60 mb-2.5"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">
          {connection.title}
        </div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {connection.ssh_destination}
        </div>
        <div className="text-[11px] text-muted-foreground/70 mt-0.5">
          {relativeTime(connection.last_connected_at)}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 rounded-full"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete connection"
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </Card>
  );
}
