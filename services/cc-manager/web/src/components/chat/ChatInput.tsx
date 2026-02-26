import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, File as FileIcon, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface FileSuggestion {
  path: string;
  kind: "file" | "dir";
}

interface ActiveAtToken {
  start: number;
  end: number;
  query: string;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  onFileSearch: (query: string | null) => void;
  fileSuggestions: FileSuggestion[];
  fileIndexing: boolean;
  disabled?: boolean;
}

function parseActiveAtToken(text: string, caret: number): ActiveAtToken | null {
  const prefix = text.slice(0, caret);
  const atIndex = prefix.lastIndexOf("@");
  if (atIndex < 0) return null;

  if (atIndex > 0) {
    const previous = text[atIndex - 1];
    if (previous && !/\s/.test(previous)) return null;
  }

  const textAfterAt = prefix.slice(atIndex + 1);
  if (/\s/.test(textAfterAt)) return null;

  let end = atIndex + 1;
  while (end < text.length && !/\s/.test(text[end] ?? "")) {
    end += 1;
  }

  if (caret > end) return null;

  return {
    start: atIndex,
    end,
    query: textAfterAt,
  };
}

export function ChatInput({
  onSend,
  onFileSearch,
  fileSuggestions,
  fileIndexing,
  disabled,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [value, setValue] = useState("");
  const [activeToken, setActiveToken] = useState<ActiveAtToken | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const updateAutocomplete = useCallback(
    (nextValue: string, caret: number | null) => {
      const token = caret === null ? null : parseActiveAtToken(nextValue, caret);
      setActiveToken((prev) => {
        const changed =
          prev?.start !== token?.start ||
          prev?.end !== token?.end ||
          prev?.query !== token?.query;
        if (changed) setSelectedIndex(0);
        return token;
      });

      clearTimeout(searchDebounceRef.current);
      if (!token) {
        onFileSearch(null);
        return;
      }

      searchDebounceRef.current = setTimeout(() => {
        onFileSearch(token.query);
      }, 80);
    },
    [onFileSearch],
  );

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    setActiveToken(null);
    onFileSearch(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [onFileSearch, onSend, value]);

  const insertSuggestion = useCallback(
    (index: number) => {
      const token = activeToken;
      const suggestion = fileSuggestions[index];
      if (!token || !suggestion) return;

      const suffix = suggestion.kind === "dir" ? "/" : "";
      const replacement = `@${suggestion.path}${suffix}`;
      const nextValue = value.slice(0, token.start) + replacement + " " + value.slice(token.end);
      const nextCaret = token.start + replacement.length + 1;

      setValue(nextValue);
      setActiveToken(null);
      onFileSearch(null);

      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.selectionStart = nextCaret;
        el.selectionEnd = nextCaret;
      });
    },
    [activeToken, fileSuggestions, onFileSearch, value],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const canSelectSuggestion = !!activeToken && fileSuggestions.length > 0;
      const activeSuggestionIndex = fileSuggestions.length === 0
        ? 0
        : Math.min(selectedIndex, fileSuggestions.length - 1);

      if (canSelectSuggestion && e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % fileSuggestions.length);
        return;
      }

      if (canSelectSuggestion && e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev === 0 ? fileSuggestions.length - 1 : prev - 1,
        );
        return;
      }

      if (canSelectSuggestion && (e.key === "Enter" || e.key === "Tab")) {
        e.preventDefault();
        insertSuggestion(activeSuggestionIndex);
        return;
      }

      if (activeToken && e.key === "Escape") {
        e.preventDefault();
        setActiveToken(null);
        onFileSearch(null);
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      activeToken,
      fileSuggestions.length,
      handleSend,
      insertSuggestion,
      onFileSearch,
      selectedIndex,
    ],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = e.target.value;
      setValue(nextValue);
      updateAutocomplete(nextValue, e.target.selectionStart);
    },
    [updateAutocomplete],
  );

  const handleSelectionChange = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    updateAutocomplete(el.value, el.selectionStart);
  }, [updateAutocomplete]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [value]);

  useEffect(
    () => () => {
      clearTimeout(searchDebounceRef.current);
    },
    [],
  );

  const shouldShowAutocomplete = activeToken !== null;
  const showNoMatches = shouldShowAutocomplete && !fileIndexing && fileSuggestions.length === 0;
  const hasSuggestions = shouldShowAutocomplete && fileSuggestions.length > 0;
  const safeSelectedIndex = fileSuggestions.length === 0
    ? 0
    : Math.min(selectedIndex, fileSuggestions.length - 1);
  const autocompleteLabel = useMemo(() => {
    if (fileIndexing) return "Indexing files...";
    if (showNoMatches) return "No matching files or directories";
    return "";
  }, [fileIndexing, showNoMatches]);

  return (
    <div className="flex items-end gap-2.5 p-3 border-t border-border bg-background shrink-0">
      <div className="flex-1 relative">
        {shouldShowAutocomplete && (
          <div className="absolute left-0 right-0 bottom-[calc(100%+8px)] max-h-56 overflow-y-auto rounded-xl border border-border bg-popover shadow-md z-20">
            {hasSuggestions &&
              fileSuggestions.map((entry, index) => {
                const isActive = index === safeSelectedIndex;
                return (
                  <button
                    key={`${entry.kind}:${entry.path}`}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertSuggestion(index);
                    }}
                  >
                    {entry.kind === "dir" ? (
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <FileIcon className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{entry.path}{entry.kind === "dir" ? "/" : ""}</span>
                  </button>
                );
              })}
            {!hasSuggestions && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {autocompleteLabel}
              </div>
            )}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder="Message..."
          className="flex-1 min-h-0 max-h-[120px] resize-none rounded-2xl border-input bg-secondary/60 py-2.5 px-3.5 text-sm"
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          onClick={handleSelectionChange}
          onSelect={handleSelectionChange}
          disabled={disabled}
        />
      </div>
      <Button
        size="icon"
        className="shrink-0 rounded-full h-9 w-9"
        onClick={handleSend}
        disabled={disabled}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </div>
  );
}
