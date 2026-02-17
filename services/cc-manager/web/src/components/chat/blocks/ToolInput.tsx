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

function BashInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1 p-2">
      {data.description && (
        <div className="text-xs text-muted-foreground">{String(data.description)}</div>
      )}
      {data.command && (
        <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/50 rounded px-2 py-1.5">
          <span className="text-muted-foreground select-none">$ </span>
          {String(data.command)}
        </pre>
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
