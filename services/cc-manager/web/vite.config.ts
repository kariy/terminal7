import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const managerPort = process.env.CC_MANAGER_PORT ?? "8787";
const managerTarget = `http://localhost:${managerPort}`;
const benignProxyErrorCodes = new Set(["EPIPE", "ECONNRESET"]);

function isBenignProxySocketError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && benignProxyErrorCodes.has(code);
}

function installProxyErrorFilter(proxy: any) {
  // Vite registers its proxy error handlers after `configure()` returns.
  // Defer wrapping until those listeners are present.
  queueMicrotask(() => {
    const proxyErrorListeners = proxy.listeners?.("error") as Array<(...args: unknown[]) => unknown> | undefined;
    if (proxyErrorListeners && proxyErrorListeners.length > 0) {
      proxy.removeAllListeners("error");
      for (const listener of proxyErrorListeners) {
        proxy.on("error", function wrappedProxyError(err: unknown, ...rest: unknown[]) {
          if (isBenignProxySocketError(err)) return;
          return listener.call(this, err, ...rest);
        });
      }
    }

    const proxyReqWsListeners = proxy.listeners?.("proxyReqWs") as Array<(...args: unknown[]) => unknown> | undefined;
    if (proxyReqWsListeners && proxyReqWsListeners.length > 0) {
      proxy.removeAllListeners("proxyReqWs");
      for (const listener of proxyReqWsListeners) {
        proxy.on(
          "proxyReqWs",
          function wrappedProxyReqWs(proxyReq: unknown, req: unknown, socket: any, options: unknown) {
            if (socket && typeof socket.on === "function") {
              const originalSocketOn = socket.on.bind(socket);
              socket.on = (event: string, socketListener: (...args: unknown[]) => unknown) => {
                if (event !== "error") {
                  return originalSocketOn(event, socketListener);
                }
                return originalSocketOn(event, (err: unknown, ...rest: unknown[]) => {
                  if (isBenignProxySocketError(err)) return;
                  return socketListener(err, ...rest);
                });
              };
            }

            return listener.call(this, proxyReq, req, socket, options);
          },
        );
      }
    }
  });
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/v1": {
        target: managerTarget,
        ws: true,
        configure(proxy) {
          installProxyErrorFilter(proxy);
        },
      },
      "/health": {
        target: managerTarget,
      },
    },
  },
});
