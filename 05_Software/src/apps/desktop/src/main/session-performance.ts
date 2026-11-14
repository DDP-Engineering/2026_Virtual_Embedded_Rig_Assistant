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
  /** The hub that served each opened session; the stream injector emits through the real hub. */
  const hubs = new Map<string, SessionHub>();
  const get = SessionHub.prototype.get;
  SessionHub.prototype.get = function (id) {
    hubs.set(id, this);
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
      /**
       * Replays one reply into an opened session through its real hub: durable events are recorded
       * (the renderer cursor stays equal to session.revision) and every event reaches the renderer as
       * its own IPC message. Deltas are paced at `intervalMs`; a late timer sends every due delta.
       */
      async stream(id: string, options: { deltas: number; intervalMs: number; marker: string }) {
        const hub = hubs.get(id);
        if (!hub) throw Error("stream target not opened");
        target = id;
        maxGap = providerRequests = 0;
        last = performance.now();
        const turnId = `turn_${options.marker}`,
          messageId = `assistant_${options.marker}`;
        // 20 characters each; every 40th ends a paragraph so the Markdown keeps growing in blocks.
        const piece = (index: number) =>
          index % 40 === 39 ? "sit amet consecte.\n\n" : "lorem ipsum dolor s ";
        const start = performance.now();
        hub.emit(id, { type: "turn.started", turnId });
        let text = "";
        for (let sent = 0; sent < options.deltas; ) {
          const due = Math.min(
            options.deltas,
            Math.floor((performance.now() - start) / options.intervalMs) + 1,
          );
          for (; sent < due; sent++) {
            const delta = piece(sent);
            text += delta;
            hub.emit(id, { type: "message.delta", messageId, text: delta });
          }
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        hub.emit(id, { type: "message.done", messageId, text: `${text}${options.marker}`, citations: [] });
        hub.emit(id, { type: "turn.done", turnId, stopReason: "end" });
        const emitMs = performance.now() - start;
        maxGap = Math.max(maxGap, performance.now() - last);
        target = "";
        return { emitMs, mainGapMs: maxGap, providerRequests };
      },
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
