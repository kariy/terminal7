import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WsStatus } from "@/hooks/use-websocket";

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

interface HeaderProps {
  title: string;
  status: WsStatus;
  showBack: boolean;
  totalCostUsd?: number;
  onBack: () => void;
  onDisconnect: () => void;
}

export function Header({
  title,
  status,
  showBack,
  totalCostUsd,
  onBack,
  onDisconnect,
}: HeaderProps) {
  const statusText =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";

  return (
    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0 bg-background">
      {showBack && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full"
          onClick={onBack}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold truncate">{title}</div>
        <div
          className={`text-xs ${status === "connected" ? "text-foreground/60" : "text-muted-foreground"}`}
        >
          {statusText}
          {totalCostUsd != null && totalCostUsd > 0 && (
            <> &middot; {formatCost(totalCostUsd)}</>
          )}
        </div>
      </div>
      {status === "connected" && (
        <Button variant="secondary" size="sm" onClick={onDisconnect}>
          Disconnect
        </Button>
      )}
    </header>
  );
}
