import * as net from "net";

/** Resolve when a TCP port accepts a connection, or reject on timeout. */
export function waitForPort(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      const socket = new net.Socket();
      const onFail = (): void => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(attempt, 300);
        }
      };
      socket.setTimeout(1000);
      socket.once("error", onFail);
      socket.once("timeout", onFail);
      socket.connect(port, host, () => {
        socket.end();
        resolve();
      });
    };
    attempt();
  });
}

/** True if the port is free to bind. */
export function isPortFree(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}
