import { CheckCircle, XCircle, Clock, DollarSign } from "lucide-react";

interface ResultBarProps {
  isError?: boolean;
  totalCostUsd?: number;
  durationSeconds?: number;
}

export function ResultBar({ isError, totalCostUsd, durationSeconds }: ResultBarProps) {
  return (
    <div className="my-2 flex items-center justify-center gap-4 px-4 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
      {isError ? (
        <span className="flex items-center gap-1 text-destructive">
          <XCircle className="w-3.5 h-3.5" />
          Error
        </span>
      ) : (
        <span className="flex items-center gap-1 text-green-600">
          <CheckCircle className="w-3.5 h-3.5" />
          Done
        </span>
      )}
      {durationSeconds != null && (
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {formatDuration(durationSeconds)}
        </span>
      )}
      {totalCostUsd != null && (
        <span className="flex items-center gap-1">
          <DollarSign className="w-3.5 h-3.5" />
          {formatCost(totalCostUsd)}
        </span>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)}ms`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}
