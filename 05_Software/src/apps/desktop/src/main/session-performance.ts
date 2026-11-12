// REQ-TEST-a14f8f9b REQ-SEC-4bebe590
// Imported only by the dedicated instrumented build; never part of normal/release composition.

import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { EventsRepository, SessionHub } from "@vera/core";
import { app, ipcMain } from "electron";

export function installSessionPerformance() {
  let earlyTraffic = 0;
  const local = (host: string) =>
    ["localhost", "::1", "[::1]"].includes(host) || /^127\.\d+\.\d+\.\d+$/.test(host);
  const connect = Socket.prototype.connect;
  Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
    const first: unknown = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options =
      first && typeof first === "object" ? (first as { host?: string; port?: unknown }) : undefined;
    const port =
      options?.port ??
      (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)) ? first : undefined);
    const host = options?.host ?? (typeof args[1] === "string" ? args[1] : "localhost");
    if (port !== undefined && !local(host)) {
      earlyTraffic++;
      throw Error("performance egress refused");
    }
    return Reflect.apply(connect, this, args);
  } as typeof connect;
  app.on("session-created", (session) =>
    session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const blocked = ["http:", "https:", "ws:", "wss:"].includes(url.protocol) && !local(url.hostname);
      if (blocked) earlyTraffic++;
      callback({ cancel: blocked });
    }),
  );
  let response: unknown;
  let target = "";
  let storageMs = 0;
  let snapshotMs = 0;
  let mainHandlerMs = 0;
  let payloadBytes = 0;
  let providerRequests = 0;
  let maxGap = 0;
  let last = performance.now();
  let stall = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    if (target) maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 20);
  heartbeat.unref();
  const list = EventsRepository.prototype.list;
  EventsRepository.prototype.list = function (id, after) {
    const start = performance.now();
    try {
      return list.call(this, id, after);
    } finally {
      if (id === target) storageMs += performance.now() - start;
    }
  };
  const get = SessionHub.prototype.get;
  SessionHub.prototype.get = function (id) {
    const start = performance.now(),
      before = storageMs;
    if (id === target && stall) {
      const delay = stall;
      stall = 0;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
    try {
      return get.call(this, id);
    } finally {
      if (id === target) snapshotMs += performance.now() - start - (storageMs - before);
    }
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, name: unknown, request: unknown) => {
      if (name === "session.send") providerRequests++;
      const selected =
        name === "session.get" &&
        request &&
        typeof request === "object" &&
        "sessionId" in request &&
        request.sessionId === target;
      const start = performance.now();
      const result: unknown = await listener(event, name, request);
      if (selected) {
        response = result;
        mainHandlerMs += performance.now() - start;
        payloadBytes = Buffer.byteLength(JSON.stringify(result));
      }
      return result;
    });
  Object.assign(globalThis, {
    veraSessionPerformance: {
      traffic: () => earlyTraffic,
      begin(id: string, delay = 0) {
        response = undefined;
        target = id;
        stall = delay;
        storageMs = snapshotMs = mainHandlerMs = payloadBytes = maxGap = providerRequests = 0;
        last = performance.now();
      },
      end() {
        maxGap = Math.max(maxGap, performance.now() - last);
        target = "";
        const value =
          response &&
          typeof response === "object" &&
          "ok" in response &&
          response.ok === true &&
          "value" in response
            ? response.value
            : undefined;
        const stable = JSON.stringify(value, (_key, item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(
                Object.keys(item)
                  .sort()
                  .map((key) => [key, item[key]]),
              )
            : item,
        );
        const snapshotHash = stable ? createHash("sha256").update(stable).digest("hex") : "";
        response = undefined;
        return {
          snapshotHash,
          storageMs,
          snapshotMs,
          mainHandlerMs,
          payloadBytes,
          mainGapMs: maxGap,
          providerRequests,
        };
      },
    },
  });
}
