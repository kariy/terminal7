import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

export type TerminalStatus = "idle" | "connecting" | "connected" | "closed";

interface PendingSessionConnection {
  kind: "session";
  sessionId: string;
  encodedCwd: string;
  sshDestination: string;
  sshPassword?: string;
}

interface PendingSshConnection {
  kind: "ssh";
  sshDestination: string;
  sshPassword?: string;
}

type PendingConnection = PendingSessionConnection | PendingSshConnection;

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
      let endpoint: string;
      if (pending.kind === "session") {
        const params = new URLSearchParams({
          session_id: pending.sessionId,
          encoded_cwd: pending.encodedCwd,
          ssh_destination: pending.sshDestination,
          cols: String(cols),
          rows: String(rows),
        });
        if (pending.sshPassword) {
          params.set("ssh_password", pending.sshPassword);
        }
        endpoint = `${proto}//${location.host}/v1/terminal?${params}`;
      } else {
        const params = new URLSearchParams({
          ssh_destination: pending.sshDestination,
          cols: String(cols),
          rows: String(rows),
        });
        if (pending.sshPassword) {
          params.set("ssh_password", pending.sshPassword);
        }
        endpoint = `${proto}//${location.host}/v1/ssh?${params}`;
      }
      const ws = new WebSocket(endpoint);
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
      const pending: PendingSessionConnection = { kind: "session", sessionId, encodedCwd, sshDestination, sshPassword };
      pendingRef.current = pending;

      if (containerRef.current) {
        connect(containerRef.current, pending);
      }
    },
    [cleanup, connect],
  );

  const openSsh = useCallback(
    (sshDestination: string, sshPassword?: string) => {
      cleanup();
      setStatus("connecting");
      const pending: PendingSshConnection = { kind: "ssh", sshDestination, sshPassword };
      pendingRef.current = pending;

      if (containerRef.current) {
        connect(containerRef.current, pending);
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

  return { status, open, openSsh, close, containerRef };
}
