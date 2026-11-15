// @vitest-environment jsdom
// REQ-TEST-df5ff0ba REQ-TEST-a14f8f9b REQ-SEC-4bebe590
import { createHash, webcrypto } from "node:crypto";
import { channels, emptySessionState } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import type { VeraApi } from "../../src/apps/desktop/src/renderer/api/client.js";
import { instrumentSessionApi } from "../../src/apps/desktop/src/renderer/api/session-performance.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "veraSessionPerformance");
});
it.each([false, true])("hashes the actual delivered API payload; truncated=%s", async (truncated) => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", webcrypto);
  const expected = { snapshot: { items: [{ kind: "tool", preview: "x".repeat(65536) }] }, seq: 1 };
  const delivered = truncated ? { snapshot: { items: [{ kind: "tool" }] }, seq: 1 } : expected;
  const api = { invoke: vi.fn(async () => delivered) } as unknown as VeraApi;
  instrumentSessionApi(api);
  const probe = Reflect.get(window, "veraSessionPerformance") as {
    begin(id: string): void;
    end(): Promise<{ snapshotHash: string }>;
  };
  const id = `ses_${"0".repeat(26)}`;
  probe.begin(id);
  await api.invoke("session.get", { sessionId: id });
  const actual = await probe.end();
  const stable = JSON.stringify(expected, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
  const expectedHash = createHash("sha256").update(stable).digest("hex");
  expect(actual.snapshotHash === expectedHash).toBe(!truncated);
});
it("records the stream until the final assistant text is rendered", async () => {
  instrumentSessionApi({ invoke: vi.fn() } as unknown as VeraApi);
  const probe = Reflect.get(window, "veraSessionPerformance") as {
    streamBegin(): void;
    streamEnd(marker: string, timeoutMs: number): Promise<{ streamMs: number; rendererGapMs: number }>;
  };
  document.body.innerHTML =
    '<div data-transcript><article data-message-kind="assistant">old END</article><article data-message-kind="assistant">live</article></div>';
  probe.streamBegin();
  const done = probe.streamEnd("END", 5000);
  const last = document.querySelectorAll("article")[1];
  if (last) last.textContent = "live END";
  const result = await done;
  expect(result.streamMs).toBeGreaterThanOrEqual(0);
  expect(result.rendererGapMs).toBeGreaterThanOrEqual(0);
  probe.streamBegin();
  await expect(probe.streamEnd("MISSING", 30)).rejects.toThrow("stream-not-rendered");
  document.body.innerHTML = "";
});
// PERF-05: the renderer's one session.get response validation is reported on its own.
it("times the renderer's session.get response validation while a load is measured", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const value = { snapshot: emptySessionState(), seq: 0 };
  const now = vi.spyOn(performance, "now");
  const api = {
    invoke: vi.fn(async () => channels["session.get"].response.parse(value)),
  } as unknown as VeraApi;
  instrumentSessionApi(api);
  const probe = Reflect.get(window, "veraSessionPerformance") as {
    begin(id: string): void;
    end(): Promise<{ rendererValidateMs: number; ipcMs: number }>;
  };
  const id = `ses_${"0".repeat(26)}`;
  probe.begin(id);
  let clock = 0;
  now.mockImplementation(() => (clock += 5));
  expect(channels["session.get"].response.safeParse(value).success).toBe(true);
  await api.invoke("session.get", { sessionId: id });
  now.mockRestore();
  const actual = await probe.end();
  // Earlier tests' probes wrap the same schema, so only a positive duration is asserted.
  expect(actual.rendererValidateMs).toBeGreaterThan(0);
  expect(actual.ipcMs).toBeGreaterThan(0);
});
