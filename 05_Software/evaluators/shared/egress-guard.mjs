import { createServer } from "node:net";

/**
 * A loopback HTTP proxy that refuses every request and records where it was going. A run's CLI gets
 * it through NODE_USE_ENV_PROXY and HTTP(S)_PROXY, so any fetch to an outside host (a web search, a
 * parts supplier) fails at once and is counted instead of leaving the computer. Loopback stays direct
 * (NO_PROXY), which keeps the model proxy reachable. It covers Node's fetch and http modules, the
 * ones VERA's web providers use; it is a guard for evaluations, not a sandbox.
 */
export async function startEgressGuard() {
  const attempts = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", (data) => {
      const line = data.toString("latin1").split("\r\n")[0] ?? "";
      const target =
        /^CONNECT\s+(\S+)/.exec(line)?.[1] ?? /^[A-Z]+\s+(?:https?:\/\/)?([^/\s]+)/.exec(line)?.[1];
      attempts.push(target ?? line.slice(0, 200));
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    env: {
      NODE_USE_ENV_PROXY: "1",
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
    /** The hosts attempted since the last call, distinct, in order. */
    take: () => [...new Set(attempts.splice(0))],
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
