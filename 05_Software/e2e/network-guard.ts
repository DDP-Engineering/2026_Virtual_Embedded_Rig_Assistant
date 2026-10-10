import type { ElectronApplication } from "@playwright/test";

export async function installNetworkGuard(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session }) => {
    const attempts: string[] = [];
    Object.assign(globalThis, { veraTestOutbound: attempts });
    const local = (host: string) =>
      host === "localhost" || host === "::1" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const blocked = ["http:", "https:", "ws:", "wss:"].includes(url.protocol) && !local(url.hostname);
      if (blocked) attempts.push(details.url);
      callback({ cancel: blocked });
    });
    const { Socket } = process.getBuiltinModule("node:net");
    const connect = Socket.prototype.connect;
    Socket.prototype.connect = function (this: import("node:net").Socket, ...args: unknown[]) {
      const first: unknown = Array.isArray(args[0]) ? args[0][0] : args[0];
      const options =
        first && typeof first === "object" ? (first as { host?: string; port?: number | string }) : undefined;
      const port =
        options?.port ??
        (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)) ? first : undefined);
      const host = options?.host ?? (typeof args[1] === "string" ? args[1] : "localhost");
      if (port !== undefined && !local(host)) {
        attempts.push(`node://${host}:${port}`);
        throw new Error("Non-loopback connection blocked by VERA test guard");
      }
      return Reflect.apply(connect, this, args);
    } as typeof connect;
  });
}

export async function outboundAttempts(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => Reflect.get(globalThis, "veraTestOutbound") as string[]);
}
