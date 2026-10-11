import { Socket } from "node:net";

let installed = false;
const attempts: string[] = [];
const loopback = (host: string) =>
  host === "localhost" || host === "::1" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
function assertLoopback(host: string) {
  if (!loopback(host)) {
    attempts.push(host);
    throw new Error("Non-loopback connection blocked by VERA test guard");
  }
}
export function takeNetworkAttempts(): string[] {
  return attempts.splice(0);
}
export function installTestNetworkGuard(): void {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assertLoopback(url.hostname);
    return originalFetch(input, init);
  };
  const connect = Socket.prototype.connect;
  Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options =
      first && typeof first === "object"
        ? (first as { host?: string; port?: number | string; path?: string })
        : undefined;
    const port =
      options?.port ??
      (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)) ? first : undefined);
    if (port !== undefined)
      assertLoopback(options?.host ?? (typeof args[1] === "string" ? args[1] : "localhost"));
    return Reflect.apply(connect, this, args);
  } as typeof connect;
}
