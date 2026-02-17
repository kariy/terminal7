import { useCallback, useEffect, useReducer, useRef } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import type { WsServerMessage } from "@/types/ws";
import type { SDKMessage } from "@/types/sdk-messages";
import type { SessionListItem, HistoryMessage } from "@/types/api";
import { fetchSessions, fetchHistory } from "@/lib/api";
import { Header } from "@/components/layout/Header";
import { ConnectingView } from "@/components/views/ConnectingView";
import { SessionsView } from "@/components/views/SessionsView";
import { ChatView } from "@/components/views/ChatView";
import type { ChatMessage, ContentBlockState } from "@/types/chat";

// ── State ──

type View = "connecting" | "sessions" | "chat";

interface AppState {
  view: View;
  sessions: SessionListItem[];
  activeSessionId: string | null;
  activeEncodedCwd: string | null;
  messages: ChatMessage[];
  activeRequestIds: Set<string>;
}

const initialState: AppState = {
  view: "connecting",
  sessions: [],
  activeSessionId: null,
  activeEncodedCwd: null,
  messages: [],
  activeRequestIds: new Set(),
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
  | { type: "SEND_MESSAGE"; text: string; requestId: string }
  | {
      type: "SESSION_CREATED";
      sessionId: string;
      encodedCwd: string;
    }
  | { type: "SESSION_STATE"; sessionId?: string; encodedCwd?: string }
  | { type: "SDK_MESSAGE"; requestId: string; sdkMessage: SDKMessage }
  | { type: "STREAM_DONE"; requestId: string }
  | { type: "ERROR"; requestId?: string; message: string };

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
        activeRequestIds: new Set(),
      };
    }

    case "START_NEW_SESSION":
      return {
        ...state,
        view: "chat",
        activeSessionId: null,
        activeEncodedCwd: null,
        messages: [],
        activeRequestIds: new Set(),
      };

    case "RETURN_TO_SESSIONS":
      return {
        ...state,
        view: "sessions",
        activeRequestIds: new Set(),
      };

    case "SET_HISTORY": {
      if (state.activeSessionId !== action.sessionId) return state;
      if (state.activeRequestIds.size > 0) return state;
      return { ...state, messages: action.messages };
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

    case "SESSION_CREATED":
      return {
        ...state,
        activeSessionId: action.sessionId,
        activeEncodedCwd: action.encodedCwd,
      };

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
            return {
              ...m,
              contentBlocks: [...m.contentBlocks, newBlock],
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
            const target = blocks[index];
            if (!target) return m;

            if (delta.type === "text_delta") {
              blocks[index] = { ...target, text: target.text + delta.text };
            } else if (delta.type === "input_json_delta") {
              blocks[index] = { ...target, toolInput: (target.toolInput ?? "") + delta.partial_json };
            } else if (delta.type === "thinking_delta") {
              blocks[index] = { ...target, text: target.text + delta.thinking };
            }
            return { ...m, contentBlocks: blocks };
          });
          return { ...state, messages: msgs };
        }

        if (event.type === "content_block_stop") {
          const msgs = state.messages.map((m) => {
            if (m.requestId !== action.requestId) return m;
            const blocks = [...m.contentBlocks];
            const target = blocks[event.index];
            if (!target) return m;
            blocks[event.index] = { ...target, isComplete: true };
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

    default:
      return state;
  }
}

// ── Routing helpers ──

function getRouteFromPath(): {
  view: "sessions" | "chat";
  sessionId: string | null;
} {
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

  const handleWsMessage = useCallback((msg: WsServerMessage) => {
    switch (msg.type) {
      case "hello":
        // Connection established — load initial data
        if (!hasConnectedRef.current) {
          hasConnectedRef.current = true;
          const route = getRouteFromPath();

          fetchSessions(true)
            .then((data) => {
              dispatch({
                type: "SET_SESSIONS",
                sessions: data.sessions,
              });

              if (route.view === "chat" && route.sessionId) {
                const s = data.sessions.find(
                  (s) => s.session_id === route.sessionId,
                );
                dispatch({
                  type: "OPEN_SESSION",
                  sessionId: route.sessionId!,
                  encodedCwd: s?.encoded_cwd ?? null,
                });
                if (s?.encoded_cwd) {
                  fetchHistory(route.sessionId!, s.encoded_cwd).then(
                    (hist) => {
                      dispatch({
                        type: "SET_HISTORY",
                        sessionId: route.sessionId!,
                        messages: mapHistoryToChat(hist.messages),
                      });
                    },
                  );
                }
              } else {
                dispatch({ type: "SET_VIEW", view: "sessions" });
              }
            })
            .catch(() => {
              dispatch({ type: "SET_VIEW", view: "sessions" });
            });
        } else {
          // Reconnecting — refresh sessions
          fetchSessions(false)
            .then((data) => {
              dispatch({
                type: "SET_SESSIONS",
                sessions: data.sessions,
              });
            })
            .catch(() => {});

          const current = stateRef.current;
          if (current.view === "connecting") {
            dispatch({ type: "SET_VIEW", view: "sessions" });
          }
        }
        break;

      case "session.created":
        dispatch({
          type: "SESSION_CREATED",
          sessionId: msg.session_id,
          encodedCwd: msg.encoded_cwd,
        });
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
        if (
          msg.status === "index_refreshed" &&
          stateRef.current.view === "sessions"
        ) {
          fetchSessions(false)
            .then((data) =>
              dispatch({
                type: "SET_SESSIONS",
                sessions: data.sessions,
              }),
            )
            .catch(() => {});
        }
        break;

      case "stream.message":
        dispatch({
          type: "SDK_MESSAGE",
          requestId: msg.request_id,
          sdkMessage: msg.sdk_message,
        });
        break;

      case "stream.done":
        dispatch({ type: "STREAM_DONE", requestId: msg.request_id });
        break;

      case "error":
        dispatch({
          type: "ERROR",
          requestId: msg.request_id,
          message: msg.message || "Unknown error",
        });
        break;

      case "pong":
        break;
    }
  }, []);

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
        if (s?.encoded_cwd) {
          fetchHistory(route.sessionId, s.encoded_cwd).then((hist) => {
            dispatch({
              type: "SET_HISTORY",
              sessionId: route.sessionId!,
              messages: mapHistoryToChat(hist.messages),
            });
          });
        }
      } else {
        dispatch({ type: "RETURN_TO_SESSIONS" });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [status]);

  // ── Handlers ──

  const handleRefresh = useCallback(() => {
    fetchSessions(true)
      .then((data) =>
        dispatch({ type: "SET_SESSIONS", sessions: data.sessions }),
      )
      .catch(() => {});
  }, []);

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
      if (s.encoded_cwd) {
        fetchHistory(s.session_id, s.encoded_cwd).then((hist) => {
          dispatch({
            type: "SET_HISTORY",
            sessionId: s.session_id,
            messages: mapHistoryToChat(hist.messages),
          });
        });
      }
    },
    [state.sessions],
  );

  const handleNewSession = useCallback(() => {
    dispatch({ type: "START_NEW_SESSION" });
  }, []);

  const handleReturnToSessions = useCallback(() => {
    dispatch({ type: "RETURN_TO_SESSIONS" });
    pushUrl("/");
    fetchSessions(false)
      .then((data) =>
        dispatch({ type: "SET_SESSIONS", sessions: data.sessions }),
      )
      .catch(() => {});
  }, []);

  const handleSendMessage = useCallback(
    (text: string) => {
      if (status !== "connected") return;

      const requestId = crypto.randomUUID();
      dispatch({ type: "SEND_MESSAGE", text, requestId });

      const current = stateRef.current;
      if (current.activeSessionId && current.activeEncodedCwd) {
        send({
          type: "session.send",
          request_id: requestId,
          session_id: current.activeSessionId,
          encoded_cwd: current.activeEncodedCwd,
          prompt: text,
        });
      } else {
        send({
          type: "session.create",
          request_id: requestId,
          prompt: text,
        });
      }
    },
    [status, send],
  );

  const handleDisconnect = useCallback(() => {
    disconnect();
    dispatch({ type: "SET_VIEW", view: "connecting" });
  }, [disconnect]);

  // ── Header title ──

  let headerTitle = "Claude Manager";
  if (state.view === "chat") {
    if (state.activeSessionId) {
      const s = state.sessions.find(
        (s) => s.session_id === state.activeSessionId,
      );
      headerTitle = s?.title || "Untitled session";
    } else {
      headerTitle = "New Session";
    }
  }

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <Header
        title={headerTitle}
        status={status}
        showBack={state.view === "chat"}
        onBack={handleReturnToSessions}
        onDisconnect={handleDisconnect}
      />
      {state.view === "connecting" && <ConnectingView />}
      {state.view === "sessions" && (
        <SessionsView
          sessions={state.sessions}
          onRefresh={handleRefresh}
          onOpenSession={handleOpenSession}
          onNewSession={handleNewSession}
        />
      )}
      {state.view === "chat" && (
        <ChatView
          messages={state.messages}
          activeRequestIds={state.activeRequestIds}
          onSend={handleSendMessage}
        />
      )}
    </div>
  );
}
