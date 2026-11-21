// REQ-NFR-83ac0a94, REQ-REL-25ceaa1d, REQ-FUNC-25254fe8
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LlmEvent, LlmGateway, LlmRequest } from "../llm/gateway.js";
import { timedGateway } from "./timed-gateway.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function inner(
  stream: (request: LlmRequest) => AsyncIterable<LlmEvent>,
  timeouts: Record<string, number> = {},
): LlmGateway {
  return {
    selectedModel: () => "m",
    capabilities: () => {
      throw Error("unused");
    },
    models: async () => ({ reachability: "skipped", models: [] }),
    responseTimeoutMs: (reference: string) => timeouts[reference],
    stream,
  } as LlmGateway;
}
async function run(gateway: LlmGateway, model: string, elapse: number) {
  const events: LlmEvent[] = [];
  const done = (async () => {
    for await (const event of gateway.stream({
      model,
      system: "",
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    }))
      events.push(event);
  })();
  await vi.advanceTimersByTimeAsync(elapse);
  await done;
  return events;
}
const ok: LlmEvent = { type: "text", delta: "ok" };
const timeout = (seconds: number) => ({
  type: "error",
  aborted: false,
  error: { code: "PROVIDER", messageKey: "provider.timeout", params: { reason: "timeout", seconds } },
});

it("waits up to a model's own response timeout and keeps the default for other models", async () => {
  const late = async function* () {
    await sleep(60_000);
    yield ok;
  };
  const gateway = timedGateway(inner(late, { "custom:local/m": 120_000 }), 30_000);
  expect(await run(gateway, "custom:local/m", 60_000)).toEqual([ok]);
  expect(await run(gateway, "openai/m", 30_000)).toEqual([timeout(30)]);
});

it("keeps a reasoning-only stream alive while it reports activity", async () => {
  const reasoning = (report: boolean) =>
    async function* (request: LlmRequest) {
      for (let i = 0; i < 10; i++) {
        await sleep(10_000);
        if (report) request.onActivity?.();
      }
      yield ok;
    };
  expect(await run(timedGateway(inner(reasoning(true)), 30_000), "custom:local/m", 100_000)).toEqual([ok]);
  expect(await run(timedGateway(inner(reasoning(false)), 30_000), "custom:local/m", 30_000)).toEqual([
    timeout(30),
  ]);
});

it("reports a silent stream as a timeout naming the limit in seconds", async () => {
  const silent = async function* (request: LlmRequest) {
    await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve()));
  };
  expect(await run(timedGateway(inner(silent), 300_000), "openai/m", 300_000)).toEqual([timeout(300)]);
});
