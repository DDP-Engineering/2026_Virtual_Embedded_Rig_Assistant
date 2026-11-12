// @vitest-environment jsdom
// REQ-TEST-df5ff0ba REQ-TEST-a14f8f9b REQ-SEC-4bebe590
import { createHash, webcrypto } from "node:crypto";
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
