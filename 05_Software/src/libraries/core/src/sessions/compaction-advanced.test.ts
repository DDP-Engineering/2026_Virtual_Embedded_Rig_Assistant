// REQ-FUNC-cae0533c REQ-FUNC-5983a9e0 REQ-FUNC-eeaf29bd REQ-FUNC-13068fbb REQ-FUNC-3e78ae47 REQ-FUNC-1cec8616
import { afterEach, expect, it, vi } from "vitest";
import { ContextPolicy } from "../agent/context.js";
import { durableSetup, scriptedGateway } from "./compaction-durable.test.js";

const timeouts = vi.hoisted(() => [] as number[]);
vi.mock("./timed-gateway.js", async (original) => {
  const actual = await original<typeof import("./timed-gateway.js")>();
  return {
    ...actual,
    timedGateway: (gateway: Parameters<typeof actual.timedGateway>[0], milliseconds: number) => {
      timeouts.push(milliseconds);
      return actual.timedGateway(gateway, milliseconds);
    },
  };
});
afterEach(() => {
  timeouts.length = 0;
});

const window = 60000;
const gatewayFor = (size = window) =>
  scriptedGateway(
    size,
    (request) =>
      new ContextPolicy().prepare(
        { system: request.system, tools: request.tools, messages: request.messages },
        {
          contextWindow: size,
          maxOutputTokens: 1000,
          safetyMargin: 1024,
          input: ["text"],
          inputBudget: size - 2024,
          supportsTools: true,
        },
        false,
      ).contextTokens,
  );
const long = (label: string, words = 3000) => `${label} ${"words ".repeat(words)}`;
type Env = Awaited<ReturnType<typeof durableSetup>>;
async function turns(env: Env, id: string, labels: string[], words?: number) {
  for (const label of labels) {
    env.service.send(id, long(label, words));
    expect((await env.service.waitIdle(id))?.stopReason).toBe("end");
    await env.service.waitCompaction(id);
  }
}
const advanced = (env: Env, app: Record<string, unknown>, workbench: Record<string, unknown> = {}) => {
  env.host.advanced = { app: () => app, workbench: () => workbench };
};

it("starts no summary after a turn while background compaction is off, and compacts at the next request", async () => {
  const gateway = gatewayFor();
  const env = await durableSetup(gateway);
  advanced(env, {}, { backgroundCompaction: false });
  const id = env.service.create().id;
  // Two long turns sit above the trigger but still fit; a third would not fit at all.
  await turns(env, id, ["one", "two"]);
  const events = env.events(id);
  const lastDone = events.findLastIndex((event) => event.type === "turn.done");
  expect(events.slice(lastDone).some((event) => event.type === "context.compacted")).toBe(false);
  // No summary ran after the last turn; the next request compacts first.
  expect(gateway.timeline.at(-1)?.startsWith("normal:")).toBe(true);
  env.service.send(id, "follow-up");
  await env.service.waitIdle(id);
  expect(gateway.timeline.slice(-3)).toEqual(["summary-start", "summary-done", "normal:follow-up"]);
  // With the switch on again, the same history is summarized right after the turn.
  advanced(env, {}, { backgroundCompaction: true });
  const other = env.service.create().id;
  await turns(env, other, ["one", "two"]);
  expect(gateway.timeline.at(-1)).toBe("summary-done");
});

it("makes no summary while the session's automatic compaction is off and stops at the context limit", async () => {
  const gateway = gatewayFor();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  env.service.setAdvanced(id, "autoCompaction", false);
  await turns(env, id, ["one", "two"]);
  env.service.send(id, long("three"));
  expect((await env.service.waitIdle(id))?.stopReason).toBe("limit");
  expect(env.events(id).some((event) => event.type === "error" && event.code === "CONTEXT_LIMIT")).toBe(true);
  expect(gateway.summaries).toHaveLength(0);
  env.service.setAdvanced(id, "autoCompaction", null);
  await turns(env, id, ["four"]);
  expect(gateway.summaries.length).toBeGreaterThan(0);
});

it("compacts at the resolved trigger: a higher workbench trigger leaves the same history uncompacted", async () => {
  // A wide window puts two turns thousands of tokens above the default trigger and below the raised one,
  // so the size of the system prompt and the tool descriptions does not decide the outcome.
  const gateway = gatewayFor(200_000);
  const env = await durableSetup(gateway);
  advanced(env, {}, { compactionTrigger: 95 });
  const id = env.service.create().id;
  await turns(env, id, ["one", "two"], 12_000);
  expect(gateway.summaries).toHaveLength(0);
  // The default trigger summarizes the same history right after the turn.
  advanced(env, {}, {});
  await turns(env, env.service.create().id, ["one", "two"], 12_000);
  expect(gateway.summaries.length).toBeGreaterThan(0);
});

it("compacts an idle session on demand below the trigger and records the summary", async () => {
  const gateway = gatewayFor();
  const env = await durableSetup(gateway);
  advanced(env, { recentTailTokens: 0 });
  const id = env.service.create().id;
  env.service.send(id, "short one");
  await env.service.waitIdle(id);
  env.service.send(id, "short two");
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  expect(gateway.summaries).toHaveLength(0);
  expect(await env.service.compactNow(id)).toBe("completed");
  expect(gateway.summaries).toHaveLength(1);
  expect(env.events(id).some((event) => event.type === "context.compacted")).toBe(true);
  // The next request starts from the summary.
  env.service.send(id, "after compacting");
  await env.service.waitIdle(id);
  expect(JSON.stringify(gateway.requests.at(-1)?.messages)).toContain("Derived historical context");
  expect(JSON.stringify(gateway.requests.at(-1)?.messages)).not.toContain("short one");
});

it("reports a Compact now that cannot reach the model as failed, not as nothing to do", async () => {
  const gateway = gatewayFor();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  env.service.send(id, "short one");
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  gateway.capabilities = () => {
    throw new Error("provider unavailable");
  };
  expect(await env.service.compactNow(id)).toBe("failed");
  expect(env.events(id).some((event) => event.type === "context.compacted")).toBe(false);
});

it("refuses Compact now while a turn runs or the session is archived, recording nothing", async () => {
  const gateway = gatewayFor();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  let release: () => void = () => {};
  gateway.hold(new Promise<void>((resolve) => (release = resolve)));
  env.service.send(id, "a reply");
  const before = env.events(id).length;
  await expect(env.service.compactNow(id)).rejects.toMatchObject({ code: "BUSY" });
  release();
  await env.service.waitIdle(id);
  env.service.setArchived(id, true);
  const archived = env.events(id).length;
  await expect(env.service.compactNow(id)).rejects.toMatchObject({ code: "DENIED" });
  expect(env.events(id).length).toBe(archived);
  expect(before).toBeGreaterThan(0);
});

it("ends silent streams after the resolved no-output timeout, session over application", async () => {
  const env = await durableSetup(gatewayFor());
  advanced(env, { noOutputTimeout: 900 });
  const id = env.service.create().id;
  env.service.send(id, "first");
  await env.service.waitIdle(id);
  env.service.setAdvanced(id, "noOutputTimeout", 45);
  env.service.send(id, "second");
  await env.service.waitIdle(id);
  expect(timeouts).toEqual([900_000, 45_000]);
});
