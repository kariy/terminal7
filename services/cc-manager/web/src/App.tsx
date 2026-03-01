import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useTerminal } from "@/hooks/use-terminal";
import type {
  WsFileSearchEntry,
  WsServerMessage,
  WsSessionCreateMessage,
  WsSessionMeta,
} from "@/types/ws";
import type { SDKMessage } from "@/types/sdk-messages";
import type { SessionListItem, HistoryMessage, SshConnectionItem } from "@/types/api";
import { fetchSessions, fetchHistory, fetchSshConnections, createSshConnection, deleteSshConnection } from "@/lib/api";
import { getSshDestination, setSshDestination, getSshPassword, setSshPassword } from "@/lib/settings";
import { Header, type HeaderTab } from "@/components/layout/Header";
import { SshDestinationDialog } from "@/components/SshDestinationDialog";
import { RepoSelectionDialog, type RepoSelection } from "@/components/RepoSelectionDialog";
import { ConnectingView } from "@/components/views/ConnectingView";
import { SessionsView } from "@/components/views/SessionsView";
import { ChatView } from "@/components/views/ChatView";
import { TerminalView } from "@/components/views/TerminalView";
import { SshView } from "@/components/views/SshView";
import type {
  ChatMessage,
  ContentBlockState,
  PermissionMode,
  SessionPermissionMode,
  ToolPermissionRequestState,
} from "@/types/chat";

// ── State ──

type View = "connecting" | "sessions" | "ssh" | "chat" | "terminal";
const SESSIONS_PAGE_SIZE = 25;

interface AppState {
  view: View;
  sessions: SessionListItem[];
  sshConnections: SshConnectionItem[];
  activeSessionId: string | null;
  activeEncodedCwd: string | null;
  activeSessionMeta: WsSessionMeta | null;
  messages: ChatMessage[];
  permissionRequests: ToolPermissionRequestState[];
  sessionPermissionModes: Record<string, SessionPermissionMode>;
  draftPermissionMode: SessionPermissionMode;
  activeRequestIds: Set<string>;
  terminalOrigin: "sessions" | "ssh";
  activeSshConnectionId: string | null;
}

const initialState: AppState = {
  view: "connecting",
  sessions: [],
  sshConnections: [],
  activeSessionId: null,
  activeEncodedCwd: null,
  activeSessionMeta: null,
  messages: [],
  permissionRequests: [],
  sessionPermissionModes: {},
  draftPermissionMode: "default",
  activeRequestIds: new Set(),
  terminalOrigin: "sessions",
  activeSshConnectionId: null,
};

// ── Actions ──

type Action =
  | { type: "SET_CONNECTED" }
  | { type: "SET_SESSIONS"; sessions: SessionListItem[] }
  | { type: "SET_VIEW"; view: View }
  | {
      type: "OPEN_SESSION";
      sessionId: string;
      encodedCwd: string | null;
      messages?: ChatMessage[];
    }
  | { type: "START_NEW_SESSION" }
  | { type: "RETURN_TO_SESSIONS" }
  | { type: "SET_HISTORY"; sessionId: string; messages: ChatMessage[] }
  | { type: "PERMISSION_REQUEST"; request: ToolPermissionRequestState }
  | {
      type: "PERMISSION_RESPONSE";
      permissionRequestId: string;
      status: "approved" | "rejected";
      message?: string;
      mode?: PermissionMode;
    }
  | {
      type: "SET_SESSION_PERMISSION_MODE";
      sessionId: string | null;
      mode: SessionPermissionMode;
    }
  | { type: "CYCLE_SESSION_PERMISSION_MODE" }
  | { type: "SEND_MESSAGE"; text: string; requestId: string }
  | {
      type: "SESSION_CREATED";
      sessionId: string;
      encodedCwd: string;
    }
  | { type: "SESSION_STATE"; sessionId?: string; encodedCwd?: string }
  | { type: "SDK_MESSAGE"; requestId: string; sdkMessage: SDKMessage }
  | { type: "STREAM_DONE"; requestId: string }
  | { type: "ERROR"; requestId?: string; message: string }
  | { type: "SET_SESSION_META"; meta: WsSessionMeta }
  | { type: "OPEN_TERMINAL"; sessionId: string; encodedCwd: string }
  | { type: "OPEN_SSH_TERMINAL" }
  | { type: "OPEN_SSH_CONNECTION"; connectionId: string }
  | { type: "SET_SSH_CONNECTIONS"; connections: SshConnectionItem[] }
  | { type: "CLOSE_TERMINAL" };

function isSdkStreamContentBlock(block: ContentBlockState): boolean {
  return (
    block.type === "text" ||
    block.type === "tool_use" ||
    block.type === "thinking"
  );
}

function findStreamBlockInsertIndex(
  blocks: ContentBlockState[],
  streamIndex: number,
): number {
  let seenStreamBlocks = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (!isSdkStreamContentBlock(blocks[i])) continue;
    if (seenStreamBlocks === streamIndex) {
      return i;
    }
    seenStreamBlocks += 1;
  }
  return blocks.length;
}

function findStreamBlockArrayIndex(
  blocks: ContentBlockState[],
  streamIndex: number,
): number {
  let seenStreamBlocks = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (!isSdkStreamContentBlock(blocks[i])) continue;
    if (seenStreamBlocks === streamIndex) {
      return i;
    }
    seenStreamBlocks += 1;
  }
  return -1;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, view: "sessions" };

    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };

    case "SET_VIEW":
      return { ...state, view: action.view };

    case "OPEN_SESSION": {
      return {
        ...state,
        view: "chat",
        activeSessionId: action.sessionId,
        activeEncodedCwd: action.encodedCwd,
        messages: action.messages ?? [],
        permissionRequests: [],
        activeRequestIds: new Set(),
      };
    }

    case "START_NEW_SESSION":
      return {
        ...state,
        view: "chat",
        activeSessionId: null,
        activeEncodedCwd: null,
        activeSessionMeta: null,
        messages: [],
        permissionRequests: [],
        draftPermissionMode: "default",
        activeRequestIds: new Set(),
      };

    case "RETURN_TO_SESSIONS":
      return {
        ...state,
        view: "sessions",
        activeSessionMeta: null,
        permissionRequests: [],
        activeRequestIds: new Set(),
      };

    case "SET_HISTORY": {
      if (state.activeSessionId !== action.sessionId) return state;
      if (state.activeRequestIds.size > 0) return state;
      return { ...state, messages: action.messages };
    }

    case "PERMISSION_REQUEST": {
      const next = [...state.permissionRequests];
      const index = next.findIndex(
        (entry) => entry.permissionRequestId === action.request.permissionRequestId,
      );
      if (index >= 0) {
        next[index] = action.request;
      } else {
        next.push(action.request);
      }

      let nextMessages = state.messages;
      const messageIndex = state.messages.findIndex(
        (message) => message.requestId === action.request.promptRequestId,
      );

      const injectedToolBlock: ContentBlockState = {
        type: "tool_use",
        text: "",
        toolName: action.request.toolName,
        toolId: action.request.toolUseId,
        toolInput: JSON.stringify(action.request.toolInput),
        isComplete: true,
      };

      if (messageIndex >= 0) {
        const target = state.messages[messageIndex]!;
        const hasToolBlock = target.contentBlocks.some(
          (block) =>
            block.type === "tool_use" && block.toolId === action.request.toolUseId,
        );
        if (!hasToolBlock) {
          nextMessages = state.messages.map((message, indexInMessages) =>
            indexInMessages === messageIndex
              ? {
                  ...message,
                  contentBlocks: [...message.contentBlocks, injectedToolBlock],
                }
              : message,
          );
        }
      } else {
        nextMessages = [
          ...state.messages,
          {
            role: "assistant",
            requestId: null,
            contentBlocks: [injectedToolBlock],
          },
        ];
      }

      return { ...state, permissionRequests: next, messages: nextMessages };
    }

    case "PERMISSION_RESPONSE": {
      const next = state.permissionRequests.map((entry) =>
        entry.permissionRequestId === action.permissionRequestId
          ? {
              ...entry,
              status: action.status,
              message: action.message,
              mode: action.mode,
            }
          : entry,
      );
      return { ...state, permissionRequests: next };
    }

    case "SET_SESSION_PERMISSION_MODE":
      if (!action.sessionId) {
        return { ...state, draftPermissionMode: action.mode };
      }
      return {
        ...state,
        sessionPermissionModes: {
          ...state.sessionPermissionModes,
          [action.sessionId]: action.mode,
        },
      };

    case "CYCLE_SESSION_PERMISSION_MODE": {
      const modeOrder: SessionPermissionMode[] = [
        "default",
        "plan",
        "bypassPermissions",
      ];
      const currentMode: SessionPermissionMode = state.activeSessionId
        ? (state.sessionPermissionModes[state.activeSessionId] ?? "default")
        : state.draftPermissionMode;
      const currentIndex = modeOrder.indexOf(currentMode);
      const nextMode = modeOrder[(currentIndex + 1) % modeOrder.length] ?? "default";

      if (!state.activeSessionId) {
        return { ...state, draftPermissionMode: nextMode };
      }

      return {
        ...state,
        sessionPermissionModes: {
          ...state.sessionPermissionModes,
          [state.activeSessionId]: nextMode,
        },
      };
    }

    case "SEND_MESSAGE": {
      const newRequestIds = new Set(state.activeRequestIds);
      newRequestIds.add(action.requestId);
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "user", requestId: null, contentBlocks: [{ type: "text", text: action.text }] },
          { role: "assistant", requestId: action.requestId, contentBlocks: [] },
        ],
        activeRequestIds: newRequestIds,
      };
    }

    case "SESSION_CREATED": {
      const sessionPermissionModes = { ...state.sessionPermissionModes };
      if (state.activeSessionId === null) {
        sessionPermissionModes[action.sessionId] = state.draftPermissionMode;
      }
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeEncodedCwd: action.encodedCwd,
        sessionPermissionModes,
      };
    }

    case "SESSION_STATE": {
      const updates: Partial<AppState> = {};
      if (action.sessionId) updates.activeSessionId = action.sessionId;
      if (action.encodedCwd) updates.activeEncodedCwd = action.encodedCwd;
      return { ...state, ...updates };
    }

    case "SDK_MESSAGE": {
      const sdk = action.sdkMessage;

      if (sdk.type === "stream_event") {
        const { event } = sdk;

        if (event.type === "content_block_start") {
          const block = event.content_block;
          let newBlock: ContentBlockState;
          if (block.type === "text") {
            newBlock = { type: "text", text: block.text };
          } else if (block.type === "tool_use") {
            newBlock = { type: "tool_use", text: "", toolName: block.name, toolId: block.id, toolInput: "" };
          } else if (block.type === "thinking") {
            newBlock = { type: "thinking", text: block.thinking };
          } else {
            return state;
          }

          const msgs = state.messages.map((m) => {
            if (m.requestId !== action.requestId) return m;
            if (
              block.type === "tool_use" &&
              m.contentBlocks.some(
                (existing) =>
                  existing.type === "tool_use" && existing.toolId === block.id,
              )
            ) {
              return m;
            }

            const nextBlocks = [...m.contentBlocks];
            const insertIndex = findStreamBlockInsertIndex(
              nextBlocks,
              event.index,
            );
            nextBlocks.splice(insertIndex, 0, newBlock);

            return {
              ...m,
              contentBlocks: nextBlocks,
              streamStartTime: m.streamStartTime ?? Date.now(),
            };
          });
          return { ...state, messages: msgs };
        }

        if (event.type === "content_block_delta") {
          const { index, delta } = event;
          const msgs = state.messages.map((m) => {
            if (m.requestId !== action.requestId) return m;
            const blocks = [...m.contentBlocks];
            const targetIndex = findStreamBlockArrayIndex(blocks, index);
            if (targetIndex < 0) return m;
            const target = blocks[targetIndex];
            if (!target) return m;

            if (delta.type === "text_delta") {
              blocks[targetIndex] = { ...target, text: target.text + delta.text };
            } else if (delta.type === "input_json_delta") {
              blocks[targetIndex] = {
                ...target,
                toolInput: (target.toolInput ?? "") + delta.partial_json,
              };
            } else if (delta.type === "thinking_delta") {
              blocks[targetIndex] = { ...target, text: target.text + delta.thinking };
            }
            return { ...m, contentBlocks: blocks };
          });
          return { ...state, messages: msgs };
        }

        if (event.type === "content_block_stop") {
          const msgs = state.messages.map((m) => {
            if (m.requestId !== action.requestId) return m;
            const blocks = [...m.contentBlocks];
            const targetIndex = findStreamBlockArrayIndex(blocks, event.index);
            if (targetIndex < 0) return m;
            const target = blocks[targetIndex];
            if (!target) return m;
            blocks[targetIndex] = { ...target, isComplete: true };
            return { ...m, contentBlocks: blocks };
          });
          return { ...state, messages: msgs };
        }

        // message_start/delta/stop: no-op
        return state;
      }

      if (sdk.type === "tool_progress") {
        const msgs = state.messages.map((m) => {
          if (m.requestId !== action.requestId) return m;
          // Find the last tool_use block matching this tool name
          const blocks = [...m.contentBlocks];
          for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].type === "tool_use" && blocks[i].toolName === sdk.tool_name) {
              blocks[i] = { ...blocks[i], elapsedSeconds: sdk.elapsed_time_seconds };
              break;
            }
          }
          return { ...m, contentBlocks: blocks };
        });
        return { ...state, messages: msgs };
      }

      if (sdk.type === "tool_use_summary") {
        const msgs = state.messages.map((m) => {
          if (m.requestId !== action.requestId) return m;
          // Find the last tool_use block to link to
          let lastToolId: string | undefined;
          for (let i = m.contentBlocks.length - 1; i >= 0; i--) {
            if (m.contentBlocks[i].type === "tool_use") {
              lastToolId = m.contentBlocks[i].toolId;
              break;
            }
          }
          const resultBlock: ContentBlockState = {
            type: "tool_result",
            text: sdk.summary,
            toolResultForId: lastToolId,
            isError: false,
          };
          return { ...m, contentBlocks: [...m.contentBlocks, resultBlock] };
        });
        return { ...state, messages: msgs };
      }

      if (sdk.type === "result") {
        const msgs = state.messages.map((m) => {
          if (m.requestId !== action.requestId) return m;
          const durationSeconds = m.streamStartTime
            ? (Date.now() - m.streamStartTime) / 1000
            : undefined;
          const resultBlock: ContentBlockState = {
            type: "result",
            text: sdk.result ?? "",
            isResultError: sdk.is_error,
            totalCostUsd: sdk.total_cost_usd,
            durationSeconds,
          };
          return { ...m, contentBlocks: [...m.contentBlocks, resultBlock] };
        });
        return { ...state, messages: msgs };
      }

      // All other SDK message types: ignore
      return state;
    }

    case "STREAM_DONE": {
      const newIds = new Set(state.activeRequestIds);
      newIds.delete(action.requestId);
      const msgs = state.messages.map((m) =>
        m.requestId === action.requestId ? { ...m, requestId: null } : m,
      );
      return { ...state, messages: msgs, activeRequestIds: newIds };
    }

    case "SET_SESSION_META":
      return { ...state, activeSessionMeta: action.meta };

    case "ERROR": {
      const errText = "Error: " + action.message;
      const newIds = new Set(state.activeRequestIds);
      if (action.requestId) {
        newIds.delete(action.requestId);
        const existing = state.messages.find(
          (m) => m.requestId === action.requestId,
        );
        if (existing) {
          const msgs = state.messages.map((m) =>
            m.requestId === action.requestId
              ? {
                  ...m,
                  contentBlocks: [...m.contentBlocks, { type: "text" as const, text: errText }],
                  requestId: null,
                }
              : m,
          );
          return { ...state, messages: msgs, activeRequestIds: newIds };
        }
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "assistant", requestId: null, contentBlocks: [{ type: "text", text: errText }] },
        ],
        activeRequestIds: newIds,
      };
    }

    case "OPEN_TERMINAL":
      return {
        ...state,
        view: "terminal",
        activeSessionId: action.sessionId,
        activeEncodedCwd: action.encodedCwd,
        terminalOrigin: "sessions",
      };

    case "OPEN_SSH_TERMINAL":
      return {
        ...state,
        view: "terminal",
        terminalOrigin: "ssh",
      };

    case "OPEN_SSH_CONNECTION":
      return {
        ...state,
        view: "terminal",
        terminalOrigin: "ssh",
        activeSshConnectionId: action.connectionId,
      };

    case "SET_SSH_CONNECTIONS":
      return { ...state, sshConnections: action.connections };

    case "CLOSE_TERMINAL":
      return {
        ...state,
        view: state.terminalOrigin,
      };

    default:
      return state;
  }
}

// ── Routing helpers ──

function getRouteFromPath(): {
  view: "sessions" | "ssh" | "chat";
  sessionId: string | null;
} {
  if (window.location.pathname === "/ssh") {
    return { view: "ssh", sessionId: null };
  }
  const match = window.location.pathname.match(/^\/sessions\/([^/]+)$/);
  if (match) {
    return { view: "chat", sessionId: decodeURIComponent(match[1]) };
  }
  return { view: "sessions", sessionId: null };
}

function pushUrl(path: string) {
  if (window.location.pathname !== path) {
    history.pushState({}, "", path);
  }
}

// ── History → ChatMessage mapping ──

function mapContentBlock(raw: Record<string, unknown>): ContentBlockState | null {
  const type = raw.type;
  if (type === "text" && typeof raw.text === "string") {
    return { type: "text", text: raw.text, isComplete: true };
  }
  if (type === "tool_use") {
    return {
      type: "tool_use",
      text: "",
      toolName: String(raw.name || ""),
      toolId: String(raw.id || ""),
      toolInput: typeof raw.input === "object" ? JSON.stringify(raw.input) : String(raw.input || ""),
      isComplete: true,
    };
  }
  if (type === "thinking" && typeof raw.thinking === "string") {
    return { type: "thinking", text: raw.thinking, isComplete: true };
  }
  if (type === "tool_result") {
    const resultText = extractToolResultText(raw.content);
    return {
      type: "tool_result",
      text: resultText,
      toolResultForId: typeof raw.tool_use_id === "string" ? raw.tool_use_id : undefined,
      isError: raw.is_error === true,
    };
  }
  return null;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      if (typeof c === "string") return c;
      if (typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text") {
        return String((c as Record<string, unknown>).text || "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function mapHistoryToChat(messages: HistoryMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const m of messages) {
    const blocks: ContentBlockState[] = [];

    if (m.content_blocks && Array.isArray(m.content_blocks)) {
      for (const raw of m.content_blocks) {
        if (typeof raw !== "object" || raw === null) continue;
        const mapped = mapContentBlock(raw as Record<string, unknown>);
        if (mapped) blocks.push(mapped);
      }
    }

    // If no content blocks parsed, fall back to plain text
    if (blocks.length === 0 && m.text) {
      blocks.push({ type: "text", text: m.text, isComplete: true });
    }

    // User messages with only tool_result blocks → merge into preceding assistant message
    const isToolResultOnly =
      m.role === "user" && blocks.length > 0 && blocks.every((b) => b.type === "tool_result");

    if (isToolResultOnly && result.length > 0) {
      const prev = result[result.length - 1];
      if (prev.role === "assistant") {
        result[result.length - 1] = {
          ...prev,
          contentBlocks: [...prev.contentBlocks, ...blocks],
        };
        continue;
      }
    }

    // Skip user messages that ended up with no displayable content
    if (blocks.length === 0) continue;

    result.push({
      role: m.role,
      requestId: null,
      contentBlocks: blocks,
    });
  }

  return result;
}

// ── App ──

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const hasConnectedRef = useRef(false);
  const terminal = useTerminal();
  const [showSshDialog, setShowSshDialog] = useState(false);
  const [showRepoDialog, setShowRepoDialog] = useState(false);
  const [pendingRepoSelection, setPendingRepoSelection] = useState<RepoSelection | null>(null);
  const [pendingTerminalSession, setPendingTerminalSession] = useState<{
    sessionId: string;
    encodedCwd: string;
  } | null>(null);
  const [fileSuggestions, setFileSuggestions] = useState<WsFileSearchEntry[]>([]);
  const [fileSearchIndexing, setFileSearchIndexing] = useState(false);
  const fileSearchQueryRef = useRef<string | null>(null);
  const historyLoadIdRef = useRef(0);
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsNextCursor, setSessionsNextCursor] = useState<string | null>(null);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);

  const loadSessionsFirstPage = useCallback((refresh: boolean) => {
    if (stateRef.current.sessions.length === 0) {
      setSessionsLoading(true);
    }
    setSessionsLoadingMore(false);

    return fetchSessions({ refresh, limit: SESSIONS_PAGE_SIZE })
      .then((data) => {
        dispatch({
          type: "SET_SESSIONS",
          sessions: data.items,
        });
        setSessionsNextCursor(data.next_cursor);
        return data;
      })
      .finally(() => {
        setSessionsLoading(false);
      });
  }, []);

  const loadMoreSessions = useCallback(() => {
    const cursor = sessionsNextCursor;
    if (!cursor || sessionsLoadingMore) return;
    setSessionsLoadingMore(true);
    void fetchSessions({ cursor, limit: SESSIONS_PAGE_SIZE })
      .then((data) => {
        dispatch({
          type: "SET_SESSIONS",
          sessions: [...stateRef.current.sessions, ...data.items],
        });
        setSessionsNextCursor(data.next_cursor);
      })
      .catch(() => {})
      .finally(() => {
        setSessionsLoadingMore(false);
      });
  }, [sessionsLoadingMore, sessionsNextCursor]);

  const loadSessionHistory = useCallback(
    (sessionId: string, encodedCwd?: string | null) => {
      const loadId = ++historyLoadIdRef.current;
      setSessionHistoryLoading(true);

      const request = encodedCwd
        ? fetchHistory(sessionId, encodedCwd)
        : fetchHistory(sessionId);

      return request
        .then((hist) => {
          if (stateRef.current.activeSessionId !== sessionId) {
            return hist;
          }

          dispatch({
            type: "SESSION_STATE",
            encodedCwd: hist.encoded_cwd,
          });
          dispatch({
            type: "SET_HISTORY",
            sessionId,
            messages: mapHistoryToChat(hist.messages),
          });
          return hist;
        })
        .finally(() => {
          if (historyLoadIdRef.current === loadId) {
            setSessionHistoryLoading(false);
          }
        });
    },
    [],
  );

  const handleWsMessage = useCallback((msg: WsServerMessage) => {
    switch (msg.type) {
      case "hello":
        // Connection established — load initial data
        if (!hasConnectedRef.current) {
          hasConnectedRef.current = true;
          const route = getRouteFromPath();

          loadSessionsFirstPage(true)
            .then((data) => {
              if (route.view === "chat" && route.sessionId) {
                const s = data.items.find(
                  (s) => s.session_id === route.sessionId,
                );
                dispatch({
                  type: "OPEN_SESSION",
                  sessionId: route.sessionId!,
                  encodedCwd: s?.encoded_cwd ?? null,
                });
                loadSessionHistory(route.sessionId!, s?.encoded_cwd)
                  .catch(() => {});
              } else if (route.view === "ssh") {
                dispatch({ type: "SET_VIEW", view: "ssh" });
                fetchSshConnections()
                  .then((data) => dispatch({ type: "SET_SSH_CONNECTIONS", connections: data.connections }))
                  .catch(() => {});
              } else {
                dispatch({ type: "SET_VIEW", view: "sessions" });
              }
            })
            .catch(() => {
              dispatch({ type: "SET_VIEW", view: "sessions" });
            });
        } else {
          // Reconnecting — refresh sessions
          loadSessionsFirstPage(false)
            .catch(() => {});

          const current = stateRef.current;
          if (current.view === "connecting") {
            dispatch({ type: "SET_VIEW", view: "sessions" });
          }
        }
        break;

      case "session.created":
        historyLoadIdRef.current += 1;
        setSessionHistoryLoading(false);
        dispatch({
          type: "SESSION_CREATED",
          sessionId: msg.session_id,
          encodedCwd: msg.encoded_cwd,
        });
        if (msg.session) {
          dispatch({ type: "SET_SESSION_META", meta: msg.session });
        }
        pushUrl("/sessions/" + encodeURIComponent(msg.session_id));
        break;

      case "session.state":
        if (msg.session_id || msg.encoded_cwd) {
          dispatch({
            type: "SESSION_STATE",
            sessionId: msg.session_id,
            encodedCwd: msg.encoded_cwd,
          });
        }
        if (msg.session) {
          dispatch({ type: "SET_SESSION_META", meta: msg.session });
        }
        if (
          msg.status === "index_refreshed" &&
          stateRef.current.view === "sessions"
        ) {
          loadSessionsFirstPage(false)
            .catch(() => {});
        }
        break;

      case "stream.message":
        dispatch({
          type: "SDK_MESSAGE",
          requestId: msg.request_id,
          sdkMessage: msg.sdk_message,
        });
        if (msg.session && msg.session.total_cost_usd !== stateRef.current.activeSessionMeta?.total_cost_usd) {
          dispatch({ type: "SET_SESSION_META", meta: msg.session });
        }
        break;

      case "stream.done":
        dispatch({ type: "STREAM_DONE", requestId: msg.request_id });
        if (msg.session) {
          dispatch({ type: "SET_SESSION_META", meta: msg.session });
          // Update the sessions list so cost is fresh when returning to sessions view
          const sm = msg.session;
          dispatch({
            type: "SET_SESSIONS",
            sessions: stateRef.current.sessions.map((s) =>
              s.session_id === sm.session_id && s.encoded_cwd === sm.encoded_cwd
                ? { ...s, total_cost_usd: sm.total_cost_usd, last_activity_at: sm.last_activity_at, updated_at: sm.updated_at }
                : s,
            ),
          });
        }
        break;

      case "error":
        dispatch({
          type: "ERROR",
          requestId: msg.request_id,
          message: msg.message || "Unknown error",
        });
        break;

      case "permission.request":
        dispatch({
          type: "PERMISSION_REQUEST",
          request: {
            permissionRequestId: msg.request_id,
            promptRequestId: msg.prompt_request_id,
            toolName: msg.tool_name,
            toolUseId: msg.tool_use_id,
            toolInput: msg.tool_input,
            status: "pending",
          },
        });
        break;

      case "pong":
        break;

      case "repo.list":
        // Handled by RepoSelectionDialog directly via REST
        break;

      case "file.search.result": {
        const current = stateRef.current;
        if (
          current.activeSessionId !== msg.session_id ||
          current.activeEncodedCwd !== msg.encoded_cwd
        ) {
          break;
        }
        if (fileSearchQueryRef.current === null) break;
        if (msg.query !== fileSearchQueryRef.current) break;
        setFileSuggestions(msg.entries);
        setFileSearchIndexing(msg.indexing);
        break;
      }
    }
  }, [loadSessionHistory, loadSessionsFirstPage]);

  const { status, send, disconnect } = useWebSocket({
    onMessage: handleWsMessage,
  });

  // Periodic refresh
  useEffect(() => {
    clearInterval(refreshTimerRef.current);
    if (status === "connected") {
      refreshTimerRef.current = setInterval(() => {
        if (stateRef.current.activeRequestIds.size === 0) {
          send({ type: "session.refresh_index" });
        }
      }, 10000);
    }
    return () => clearInterval(refreshTimerRef.current);
  }, [status, send]);

  // On disconnect, show connecting view
  useEffect(() => {
    if (status === "disconnected" || status === "connecting") {
      if (stateRef.current.view !== "connecting") {
        dispatch({ type: "SET_VIEW", view: "connecting" });
      }
    }
  }, [status]);

  useEffect(() => {
    fileSearchQueryRef.current = null;
    setFileSuggestions([]);
    setFileSearchIndexing(false);
  }, [state.activeSessionId, state.activeEncodedCwd, state.view]);

  // popstate routing
  useEffect(() => {
    const onPopState = () => {
      if (status !== "connected") return;
      const route = getRouteFromPath();
      if (route.view === "chat" && route.sessionId) {
        const s = stateRef.current.sessions.find(
          (s) => s.session_id === route.sessionId,
        );
        dispatch({
          type: "OPEN_SESSION",
          sessionId: route.sessionId,
          encodedCwd: s?.encoded_cwd ?? null,
        });
        loadSessionHistory(route.sessionId, s?.encoded_cwd)
          .catch(() => {});
      } else if (route.view === "ssh") {
        dispatch({ type: "SET_VIEW", view: "ssh" });
        fetchSshConnections()
          .then((data) => dispatch({ type: "SET_SSH_CONNECTIONS", connections: data.connections }))
          .catch(() => {});
      } else {
        dispatch({ type: "RETURN_TO_SESSIONS" });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadSessionHistory, status]);

  // ── Handlers ──

  const handleRefresh = useCallback(() => {
    loadSessionsFirstPage(true)
      .catch(() => {});
  }, [loadSessionsFirstPage]);

  const handleOpenSession = useCallback(
    (index: number) => {
      const s = state.sessions[index];
      if (!s) return;
      dispatch({
        type: "OPEN_SESSION",
        sessionId: s.session_id,
        encodedCwd: s.encoded_cwd,
      });
      pushUrl("/sessions/" + encodeURIComponent(s.session_id));
      loadSessionHistory(s.session_id, s.encoded_cwd)
        .catch(() => {});
    },
    [loadSessionHistory, state.sessions],
  );

  const handleNewSession = useCallback(() => {
    historyLoadIdRef.current += 1;
    setSessionHistoryLoading(false);
    setShowRepoDialog(true);
  }, []);

  const handleRepoSelect = useCallback((selection: RepoSelection | null) => {
    setPendingRepoSelection(selection);
    setShowRepoDialog(false);
    dispatch({ type: "START_NEW_SESSION" });
  }, []);

  const handleRepoCancel = useCallback(() => {
    setShowRepoDialog(false);
  }, []);

  const handleReturnToSessions = useCallback(() => {
    historyLoadIdRef.current += 1;
    setSessionHistoryLoading(false);
    dispatch({ type: "RETURN_TO_SESSIONS" });
    pushUrl("/");
    loadSessionsFirstPage(false)
      .catch(() => {});
  }, [loadSessionsFirstPage]);

  const handleSendMessage = useCallback(
    (text: string) => {
      if (status !== "connected") return;

      const requestId = crypto.randomUUID();
      dispatch({ type: "SEND_MESSAGE", text, requestId });

      const current = stateRef.current;
      const permissionMode = current.activeSessionId
        ? (current.sessionPermissionModes[current.activeSessionId] ?? "default")
        : current.draftPermissionMode;
      if (current.activeSessionId && current.activeEncodedCwd) {
        send({
          type: "session.send",
          request_id: requestId,
          session_id: current.activeSessionId,
          encoded_cwd: current.activeEncodedCwd,
          prompt: text,
          permission_mode: permissionMode,
        });
      } else {
        const createMsg: WsSessionCreateMessage = {
          type: "session.create",
          request_id: requestId,
          prompt: text,
          permission_mode: permissionMode,
        };
        if (pendingRepoSelection) {
          if (pendingRepoSelection.repoUrl) createMsg.repo_url = pendingRepoSelection.repoUrl;
          if (pendingRepoSelection.repoId) createMsg.repo_id = pendingRepoSelection.repoId;
          if (pendingRepoSelection.branch) createMsg.branch = pendingRepoSelection.branch;
          setPendingRepoSelection(null);
        }
        send(createMsg);
      }
    },
    [status, send, pendingRepoSelection],
  );

  const handleFileSearch = useCallback(
    (query: string | null) => {
      if (query === null) {
        fileSearchQueryRef.current = null;
        setFileSuggestions([]);
        setFileSearchIndexing(false);
        return;
      }

      if (status !== "connected") {
        setFileSearchIndexing(false);
        return;
      }

      const current = stateRef.current;
      if (!current.activeSessionId || !current.activeEncodedCwd) {
        setFileSearchIndexing(false);
        return;
      }

      fileSearchQueryRef.current = query;
      setFileSearchIndexing(true);
      send({
        type: "file.search",
        request_id: crypto.randomUUID(),
        session_id: current.activeSessionId,
        encoded_cwd: current.activeEncodedCwd,
        query,
        limit: 20,
      });
    },
    [send, status],
  );

  const handlePermissionResponse = useCallback(
    (
      permissionRequestId: string,
      decision: "allow" | "deny",
      message?: string,
      mode?: PermissionMode,
    ) => {
      dispatch({
        type: "PERMISSION_RESPONSE",
        permissionRequestId,
        status: decision === "allow" ? "approved" : "rejected",
        message,
        mode,
      });

      send({
        type: "permission.respond",
        request_id: permissionRequestId,
        decision,
        ...(message && { message }),
        ...(mode && { mode }),
      });
    },
    [send],
  );

  const handleSessionPermissionModeChange = useCallback(
    (mode: SessionPermissionMode) => {
      dispatch({
        type: "SET_SESSION_PERMISSION_MODE",
        sessionId: stateRef.current.activeSessionId,
        mode,
      });
    },
    [],
  );

  const handleCycleSessionPermissionMode = useCallback(() => {
    dispatch({ type: "CYCLE_SESSION_PERMISSION_MODE" });
  }, []);

  const handleOpenTerminal = useCallback(
    (index: number) => {
      const s = state.sessions[index];
      if (!s) return;

      const dest = getSshDestination();
      if (!dest) {
        setPendingTerminalSession({ sessionId: s.session_id, encodedCwd: s.encoded_cwd });
        setShowSshDialog(true);
        return;
      }

      dispatch({
        type: "OPEN_TERMINAL",
        sessionId: s.session_id,
        encodedCwd: s.encoded_cwd,
      });
      terminal.open(s.session_id, s.encoded_cwd, dest, getSshPassword() ?? undefined);
    },
    [state.sessions, terminal],
  );

  const handleRefreshSshConnections = useCallback(() => {
    fetchSshConnections()
      .then((data) => dispatch({ type: "SET_SSH_CONNECTIONS", connections: data.connections }))
      .catch(() => {});
  }, []);

  const handleSshDialogSave = useCallback(
    (destination: string, password: string) => {
      setSshDestination(destination);
      setSshPassword(password);
      setShowSshDialog(false);

      if (pendingTerminalSession) {
        const { sessionId, encodedCwd } = pendingTerminalSession;
        setPendingTerminalSession(null);
        dispatch({ type: "OPEN_TERMINAL", sessionId, encodedCwd });
        terminal.open(sessionId, encodedCwd, destination, password || undefined);
      } else if (stateRef.current.view === "ssh") {
        // Creating a new SSH connection after setting destination
        createSshConnection({ ssh_destination: destination })
          .then((data) => {
            handleRefreshSshConnections();
            dispatch({ type: "OPEN_SSH_CONNECTION", connectionId: data.connection.id });
            terminal.openSshConnection(data.connection.id, password || undefined);
          })
          .catch(() => {});
      }
    },
    [pendingTerminalSession, terminal, handleRefreshSshConnections],
  );

  const handleSshDialogCancel = useCallback(() => {
    setShowSshDialog(false);
    setPendingTerminalSession(null);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setShowSshDialog(true);
  }, []);

  const handleConnectSshConnection = useCallback(
    (connectionId: string) => {
      dispatch({ type: "OPEN_SSH_CONNECTION", connectionId });
      terminal.openSshConnection(connectionId, getSshPassword() ?? undefined);
    },
    [terminal],
  );

  const handleNewSshConnection = useCallback(() => {
    const dest = getSshDestination();
    if (!dest) {
      setShowSshDialog(true);
      return;
    }
    createSshConnection({ ssh_destination: dest })
      .then((data) => {
        handleRefreshSshConnections();
        dispatch({ type: "OPEN_SSH_CONNECTION", connectionId: data.connection.id });
        terminal.openSshConnection(data.connection.id, getSshPassword() ?? undefined);
      })
      .catch(() => {});
  }, [terminal, handleRefreshSshConnections]);

  const handleDeleteSshConnection = useCallback(
    (id: string) => {
      deleteSshConnection(id)
        .then(() => handleRefreshSshConnections())
        .catch(() => {});
    },
    [handleRefreshSshConnections],
  );

  const handleTabChange = useCallback(
    (tab: HeaderTab) => {
      if (tab === "sessions") {
        dispatch({ type: "SET_VIEW", view: "sessions" });
        pushUrl("/");
        loadSessionsFirstPage(false)
          .catch(() => {});
      } else {
        dispatch({ type: "SET_VIEW", view: "ssh" });
        pushUrl("/ssh");
        fetchSshConnections()
          .then((data) => dispatch({ type: "SET_SSH_CONNECTIONS", connections: data.connections }))
          .catch(() => {});
      }
    },
    [loadSessionsFirstPage],
  );

  const handleCloseTerminal = useCallback(() => {
    const origin = stateRef.current.terminalOrigin;
    terminal.close();
    dispatch({ type: "CLOSE_TERMINAL" });
    if (origin === "ssh") {
      pushUrl("/ssh");
      fetchSshConnections()
        .then((data) => dispatch({ type: "SET_SSH_CONNECTIONS", connections: data.connections }))
        .catch(() => {});
    } else {
      pushUrl("/");
      loadSessionsFirstPage(false)
        .catch(() => {});
    }
  }, [loadSessionsFirstPage, terminal]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    dispatch({ type: "SET_VIEW", view: "connecting" });
  }, [disconnect]);

  // ── Header title ──

  let headerTitle = "Claude Manager";
  let headerCost: number | undefined;
  if (state.view === "chat") {
    if (state.activeSessionMeta) {
      headerTitle = state.activeSessionMeta.title || "Untitled session";
      headerCost = state.activeSessionMeta.total_cost_usd;
    } else if (state.activeSessionId) {
      const s = state.sessions.find(
        (s) => s.session_id === state.activeSessionId,
      );
      headerTitle = s?.title || "Untitled session";
      headerCost = s?.total_cost_usd;
    } else {
      headerTitle = "New Session";
    }
  } else if (state.view === "terminal") {
    if (state.terminalOrigin === "ssh") {
      if (state.activeSshConnectionId) {
        const conn = state.sshConnections.find((c) => c.id === state.activeSshConnectionId);
        headerTitle = conn?.title || "SSH Terminal";
      } else {
        headerTitle = "SSH Terminal";
      }
    } else {
      const s = state.sessions.find(
        (s) => s.session_id === state.activeSessionId,
      );
      headerTitle = s?.title || "Terminal";
    }
  }

  const sessionPermissionMode: SessionPermissionMode = state.activeSessionId
    ? (state.sessionPermissionModes[state.activeSessionId] ?? "default")
    : state.draftPermissionMode;

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <Header
        title={headerTitle}
        status={status}
        showBack={state.view === "chat" || state.view === "terminal"}
        totalCostUsd={headerCost}
        activeTab={(state.view === "sessions" || state.view === "ssh") ? state.view as HeaderTab : undefined}
        onTabChange={handleTabChange}
        onBack={state.view === "terminal" ? handleCloseTerminal : handleReturnToSessions}
        onDisconnect={handleDisconnect}
        onSettings={(state.view === "sessions" || state.view === "ssh") ? handleOpenSettings : undefined}
      />
      {state.view === "connecting" && <ConnectingView />}
      {state.view === "sessions" && (
        <SessionsView
          sessions={state.sessions}
          loading={sessionsLoading}
          onRefresh={handleRefresh}
          onLoadMore={loadMoreSessions}
          hasMore={sessionsNextCursor !== null}
          loadingMore={sessionsLoadingMore}
          onOpenSession={handleOpenSession}
          onNewSession={handleNewSession}
          onOpenTerminal={handleOpenTerminal}
        />
      )}
      {state.view === "ssh" && (
        <SshView
          connections={state.sshConnections}
          onRefresh={handleRefreshSshConnections}
          onConnect={handleConnectSshConnection}
          onNewConnection={handleNewSshConnection}
          onDelete={handleDeleteSshConnection}
        />
      )}
      {state.view === "chat" && (
        <ChatView
          messages={state.messages}
          historyLoading={sessionHistoryLoading}
          permissionRequests={state.permissionRequests}
          activeRequestIds={state.activeRequestIds}
          sessionPermissionMode={sessionPermissionMode}
          onSend={handleSendMessage}
          onFileSearch={handleFileSearch}
          onPermissionModeChange={handleSessionPermissionModeChange}
          onCyclePermissionMode={handleCycleSessionPermissionMode}
          onRespondPermission={handlePermissionResponse}
          fileSuggestions={fileSuggestions}
          fileIndexing={fileSearchIndexing}
        />
      )}
      {state.view === "terminal" && (
        <TerminalView
          status={terminal.status}
          containerRef={terminal.containerRef}
          onClose={handleCloseTerminal}
        />
      )}
      {showSshDialog && (
        <SshDestinationDialog
          onSave={handleSshDialogSave}
          onCancel={handleSshDialogCancel}
        />
      )}
      {showRepoDialog && (
        <RepoSelectionDialog
          onSelect={handleRepoSelect}
          onCancel={handleRepoCancel}
        />
      )}
    </div>
  );
}
