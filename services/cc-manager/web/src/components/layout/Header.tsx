import { ChevronLeft, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WsStatus } from "@/hooks/use-websocket";

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export type HeaderTab = "sessions" | "ssh";

interface HeaderProps {
  title: string;
  status: WsStatus;
  showBack: boolean;
  totalCostUsd?: number;
  activeTab?: HeaderTab;
  onTabChange?: (tab: HeaderTab) => void;
  onBack: () => void;
  onDisconnect: () => void;
  onSettings?: () => void;
}

export function Header({
  title,
  status,
  showBack,
  totalCostUsd,
  activeTab,
  onTabChange,
  onBack,
  onDisconnect,
  onSettings,
}: HeaderProps) {
  const statusText =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";

  const showTabs = !showBack && status === "connected" && activeTab && onTabChange;

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
        {showTabs ? (
          <div className="flex items-center gap-1">
            {(["sessions", "ssh"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeTab === tab
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                {tab === "sessions" ? "Sessions" : "SSH"}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-base font-semibold truncate">{title}</div>
        )}
        <div
          className={`text-xs ${status === "connected" ? "text-foreground/60" : "text-muted-foreground"}`}
        >
          {statusText}
          {totalCostUsd != null && totalCostUsd > 0 && (
            <> &middot; {formatCost(totalCostUsd)}</>
          )}
        </div>
      </div>
      {onSettings && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full"
          onClick={onSettings}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      )}
      {status === "connected" && (
        <Button variant="secondary" size="sm" onClick={onDisconnect}>
          Disconnect
        </Button>
      )}
    </header>
  );
}
