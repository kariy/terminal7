import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

export type TerminalStatus = "idle" | "connecting" | "connected" | "closed";

interface PendingConnection {
  sessionId: string;
  encodedCwd: string;
  sshDestination: string;
  sshPassword?: string;
}

export function useTerminal() {
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const pendingRef = useRef<PendingConnection | null>(null);

  const cleanup = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
    pendingRef.current = null;
  }, []);

  const connect = useCallback(
    (container: HTMLDivElement, pending: PendingConnection) => {
      const { sessionId, encodedCwd, sshDestination, sshPassword } = pending;
      pendingRef.current = null;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#fafafa",
          selectionBackground: "#27272a",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      termRef.current = term;
      fitRef.current = fitAddon;

      term.open(container);
      fitAddon.fit();

      const cols = term.cols;
      const rows = term.rows;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        session_id: sessionId,
        encoded_cwd: encodedCwd,
        ssh_destination: sshDestination,
        cols: String(cols),
        rows: String(rows),
      });
      if (sshPassword) {
        params.set("ssh_password", sshPassword);
      }
      const ws = new WebSocket(`${proto}//${location.host}/v1/terminal?${params}`);
      wsRef.current = ws;

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setStatus("connected");
      };

      ws.onmessage = (evt) => {
        if (typeof evt.data === "string") {
          term.write(evt.data);
        } else if (evt.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(evt.data));
        }
      };

      ws.onclose = () => {
        setStatus("closed");
        term.write("\r\n\x1b[90m[Terminal closed]\x1b[0m\r\n");
      };

      ws.onerror = () => {
        // onclose fires after this
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      term.onBinary((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          const buf = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            buf[i] = data.charCodeAt(i) & 0xff;
          }
          ws.send(buf);
        }
      });

      const sendResize = () => {
        if (!fitRef.current || !termRef.current) return;
        fitRef.current.fit();
        const newCols = termRef.current.cols;
        const newRows = termRef.current.rows;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: newCols, rows: newRows }));
        }
      };

      const observer = new ResizeObserver(() => {
        sendResize();
      });
      observer.observe(container);
      resizeObserverRef.current = observer;
    },
    [],
  );

  const open = useCallback(
    (sessionId: string, encodedCwd: string, sshDestination: string, sshPassword?: string) => {
      cleanup();
      setStatus("connecting");
      pendingRef.current = { sessionId, encodedCwd, sshDestination, sshPassword };

      // If the container is already mounted, connect immediately.
      // Otherwise, the effect below will pick it up after render.
      if (containerRef.current) {
        connect(containerRef.current, { sessionId, encodedCwd, sshDestination, sshPassword });
      }
    },
    [cleanup, connect],
  );

  // After render: if there's a pending connection and the container is now available, connect.
  useEffect(() => {
    if (pendingRef.current && containerRef.current && !termRef.current) {
      connect(containerRef.current, pendingRef.current);
    }
  });

  const close = useCallback(() => {
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { status, open, close, containerRef };
}
