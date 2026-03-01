import { CheckCircle } from "lucide-react";

export function ResultBar() {
  return (
    <div className="my-2 flex items-center justify-center px-4 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
      <span className="flex items-center gap-1 text-green-600">
        <CheckCircle className="w-3.5 h-3.5" />
        Done
      </span>
    </div>
  );
}
