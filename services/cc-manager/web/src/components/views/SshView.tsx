import { Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SshConnectionCard } from "@/components/ssh/SshConnectionCard";
import type { SshConnectionItem } from "@/types/api";

interface SshViewProps {
  connections: SshConnectionItem[];
  onRefresh: () => void;
  onConnect: (id: string) => void;
  onNewConnection: () => void;
  onDelete: (id: string) => void;
}

export function SshView({
  connections,
  onRefresh,
  onConnect,
  onNewConnection,
  onDelete,
}: SshViewProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center px-4 py-4 gap-2.5 shrink-0">
        <h2 className="flex-1 text-xl font-semibold">SSH Connections</h2>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={onRefresh}
          title="Refresh"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 px-4 pb-24">
        {connections.length === 0 ? (
          <div className="text-center py-16 px-5">
            <h3 className="text-base font-medium text-foreground/70 mb-1">
              No SSH connections
            </h3>
            <p className="text-xs text-muted-foreground">
              Tap + to create a new SSH connection.
            </p>
          </div>
        ) : (
          connections.map((conn) => (
            <SshConnectionCard
              key={conn.id}
              connection={conn}
              onClick={() => onConnect(conn.id)}
              onDelete={() => onDelete(conn.id)}
            />
          ))
        )}
      </ScrollArea>
      <Button
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-10"
        onClick={onNewConnection}
      >
        <Plus className="h-7 w-7" />
      </Button>
    </div>
  );
}
