// REQ-TEST-a14f8f9b REQ-SEC-4bebe590
import type { VeraApi } from "./client.js";

export function instrumentSessionApi(api: VeraApi) {
  let response: unknown;
  let received = false;
  let target = "",
    ipcMs = 0,
    receivedAt = 0,
    maxGap = 0,
    last = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (target) maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 20);
  const invoke = api.invoke.bind(api);
  api.invoke = async (channel, request) => {
    const selected = channel === "session.get" && "sessionId" in request && request.sessionId === target;
    const start = performance.now();
    const result = await invoke(channel, request);
    if (selected) {
      received = true;
      response = result;
      receivedAt = performance.now();
      ipcMs += receivedAt - start;
    }
    return result;
  };
  Object.assign(window, {
    veraSessionPerformance: {
      begin(id: string) {
        received = false;
        response = undefined;
        target = id;
        ipcMs = receivedAt = maxGap = 0;
        last = performance.now();
      },
      async end() {
        if (!received) throw Error("missing session IPC measurement");
        target = "";
        const timings = {
          ipcMs,
          presentationMs: performance.now() - receivedAt,
          rendererGapMs: Math.max(maxGap, performance.now() - last),
        };
        const stable = JSON.stringify(response, (_key, item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(
                Object.keys(item)
                  .sort()
                  .map((key) => [key, item[key]]),
              )
            : item,
        );
        response = undefined;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
        const snapshotHash = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        return { ...timings, snapshotHash };
      },
    },
  });
}
