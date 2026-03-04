import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";

interface ThinkingBlockProps {
  text: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({ text, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(isStreaming ?? false);

  if (!text && !isStreaming) return null;

  return (
    <div
      className="my-1 rounded-md border border-border/70 bg-secondary/40 px-2 py-1 cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5">
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Brain className="w-3 h-3" />
        <span className="italic">Thinking{isStreaming ? "..." : ""}</span>
      </div>
      {expanded && (
        <div className="ml-[22px] mt-1 pb-0.5 text-xs text-muted-foreground italic whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
}
