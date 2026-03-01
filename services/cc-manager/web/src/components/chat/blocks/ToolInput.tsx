import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { TextBlock } from "./TextBlock";

interface ToolInputProps {
  toolName: string;
  toolInput: string;
}

export function ToolInput({ toolName, toolInput }: ToolInputProps) {
  const parsed = safeParse(toolInput);
  if (!parsed) {
    return <RawInput text={toolInput} />;
  }

  const name = toolName.toLowerCase();
  const normalizedToolName = normalizeToolName(toolName);

  if (isExitPlanModeToolName(normalizedToolName)) {
    return <ExitPlanModeInput data={parsed} />;
  }

  if (name === "bash") {
    return <BashInput data={parsed} />;
  }
  if (name === "read") {
    return <ReadInput data={parsed} />;
  }
  if (name === "edit") {
    return <EditInput data={parsed} />;
  }
  if (name === "write" || name === "notebookedit") {
    return <WriteInput data={parsed} />;
  }
  if (name === "glob") {
    return <GlobInput data={parsed} />;
  }
  if (name === "grep") {
    return <GrepInput data={parsed} />;
  }
  if (name === "webfetch") {
    return <WebFetchInput data={parsed} />;
  }
  if (name === "websearch") {
    return <WebSearchInput data={parsed} />;
  }

  return <DefaultInput data={parsed} />;
}

function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isExitPlanModeToolName(normalizedToolName: string): boolean {
  return (
    normalizedToolName === "exitplanmode" ||
    normalizedToolName.endsWith("exitplanmode")
  );
}

function safeParse(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    if (typeof obj === "object" && obj !== null) return obj;
    return null;
  } catch {
    return null;
  }
}

function RawInput({ text }: { text: string }) {
  if (!text) return null;
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground p-2 overflow-x-auto">
      {text}
    </pre>
  );
}

function ExitPlanModeInput({ data }: { data: Record<string, unknown> }) {
  const plan = getNonEmptyString(data.plan);
  if (!plan) {
    return <DefaultInput data={data} />;
  }

  return (
    <div className="p-2">
      <TextBlock text={plan} />
    </div>
  );
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function BashInput({ data }: { data: Record<string, unknown> }) {
  const command = data.command ? String(data.command) : "";
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current != null) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

  const copyCommand = async () => {
    if (!command) return;
    const result = await copyText(command);

    if (result.ok) {
      setCopied(true);
      setCopyFailed(false);
    } else {
      setCopied(false);
      setCopyFailed(true);
    }

    if (copiedResetTimerRef.current != null) {
      window.clearTimeout(copiedResetTimerRef.current);
    }
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1500);
  };

  return (
    <div className="space-y-1 p-2">
      {data.description && (
        <div className="text-xs text-muted-foreground">{String(data.description)}</div>
      )}
      {command && (
        <button
          type="button"
          onClick={copyCommand}
          className={`group relative w-full text-left text-xs font-mono whitespace-pre-wrap rounded px-2 py-1.5 pr-14 overflow-x-auto transition-all duration-200 cursor-pointer border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.12)] ${
            copied
              ? "bg-muted/90 border-border/90 shadow-[inset_0_1px_3px_rgba(0,0,0,0.12)]"
              : copyFailed
                ? "bg-destructive/10 border-destructive/40 text-destructive"
                : "bg-muted/50 hover:bg-muted/80 border-transparent hover:border-border/80"
          }`}
          title={
            copied
              ? "Copied command"
              : copyFailed
                ? "Copy failed"
                : "Click to copy command"
          }
          aria-label={
            copied
              ? "Copied command"
              : copyFailed
                ? "Copy failed"
                : "Copy command"
          }
        >
          <span className="text-muted-foreground select-none">$ </span>
          {command}
          <span
            className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] transition-all duration-200 ${
              copied
                ? "opacity-100 scale-100 translate-x-0 text-muted-foreground"
                : copyFailed
                  ? "opacity-100 scale-100 translate-x-0 text-destructive"
                  : "opacity-0 scale-90 translate-x-0.5 text-muted-foreground/75 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:scale-100 group-focus-visible:translate-x-0"
            }`}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : copyFailed ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied && <span>Copied</span>}
            {copyFailed && <span>Failed</span>}
          </span>
        </button>
      )}
    </div>
  );
}

function ReadInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="p-2 space-y-1">
      <div className="text-xs font-mono truncate">{String(data.file_path || "")}</div>
      {(data.offset || data.limit) && (
        <div className="text-[11px] text-muted-foreground">
          {data.offset && `offset: ${data.offset}`}
          {data.offset && data.limit && " "}
          {data.limit && `limit: ${data.limit}`}
        </div>
      )}
    </div>
  );
}

function EditInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="p-2 space-y-1.5">
      <div className="text-xs font-mono truncate">{String(data.file_path || "")}</div>
      {data.old_string && (
        <pre className="text-xs font-mono whitespace-pre-wrap bg-red-50 text-red-800 rounded px-2 py-1 border border-red-200/50 overflow-x-auto">
          {String(data.old_string)}
        </pre>
      )}
      {data.new_string && (
        <pre className="text-xs font-mono whitespace-pre-wrap bg-green-50 text-green-800 rounded px-2 py-1 border border-green-200/50 overflow-x-auto">
          {String(data.new_string)}
        </pre>
      )}
    </div>
  );
}

function WriteInput({ data }: { data: Record<string, unknown> }) {
  const content = String(data.content || data.new_source || "");
  const truncated = content.length > 500 ? content.slice(0, 500) + "\n..." : content;
  return (
    <div className="p-2 space-y-1">
      <div className="text-xs font-mono truncate">{String(data.file_path || data.notebook_path || "")}</div>
      {content && (
        <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground max-h-40 overflow-y-auto px-2 py-1 bg-muted/30 rounded">
          {truncated}
        </pre>
      )}
    </div>
  );
}

function GlobInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="p-2 text-xs font-mono space-y-0.5">
      <div>{String(data.pattern || "")}</div>
      {data.path && <div className="text-muted-foreground truncate">in {String(data.path)}</div>}
    </div>
  );
}

function GrepInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="p-2 text-xs font-mono space-y-0.5">
      <div>/{String(data.pattern || "")}/</div>
      {data.path && <div className="text-muted-foreground truncate">in {String(data.path)}</div>}
    </div>
  );
}

function WebFetchInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="p-2 text-xs space-y-0.5">
      {data.url && <div className="font-mono truncate">{String(data.url)}</div>}
      {data.prompt && <div className="text-muted-foreground">{String(data.prompt)}</div>}
    </div>
  );
}

function WebSearchInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="p-2 text-xs">
      <div className="font-mono">{String(data.query || "")}</div>
    </div>
  );
}

function DefaultInput({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground p-2 overflow-x-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
