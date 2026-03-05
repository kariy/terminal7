import { useCallback, useEffect, useRef, useState } from "react";
import type { WsClientMessage, WsServerMessage } from "@/types/ws";
import { getAuthToken } from "@/lib/auth";

export type WsStatus = "connecting" | "connected" | "disconnected";

interface UseWebSocketOptions {
  onMessage: (msg: WsServerMessage) => void;
}

export function useWebSocket({ onMessage }: UseWebSocketOptions) {
  const [status, setStatus] = useState<WsStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const intentionalCloseRef = useRef(false);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const token = getAuthToken();
    const tokenQs = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${proto}//${location.host}/v1/ws${tokenQs}`);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg: WsServerMessage = JSON.parse(evt.data);
        if (msg.type === "hello") {
          setStatus("connected");
        }
        onMessageRef.current(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      if (!intentionalCloseRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      // onclose fires after this
    };
  }, []);

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  useEffect(() => {
    intentionalCloseRef.current = false;
    connect();
    return () => {
      intentionalCloseRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    intentionalCloseRef.current = false;
    connect();
  }, [connect]);

  return { status, send, disconnect, reconnect };
}
