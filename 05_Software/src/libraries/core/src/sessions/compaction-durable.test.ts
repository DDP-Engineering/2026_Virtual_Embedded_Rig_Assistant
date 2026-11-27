// REQ-NFR-4721c12f, REQ-DATA-d9ca38e5, REQ-FUNC-99acfc19
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEvent } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { ContextPolicy } from "../agent/context.js";
import { ModelCalibrationStore } from "../agent/model-calibration.js";
import { zeroUsage } from "../agent/runtime.js";
import type { LlmGateway, LlmRequest } from "../llm/gateway.js";
import { openDb } from "../storage/db.js";
import { buildSessionMarkdown } from "./export.js";
import { type SessionHost, SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** A scripted provider: summary requests get a JSON summary, normal requests a short answer. */
export function scriptedGateway(window: number, reportedInput: (request: LlmRequest) => number) {
  const requests: LlmRequest[] = [];
  const summaries: LlmRequest[] = [];
  /** Order of model calls: "summary-start", "summary-done" and "normal:<last user text start>". */
  const timeline: string[] = [];
  const reply = (text: string, input: number): AssistantMessage => ({
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: { ...zeroUsage(), input },
    timestamp: 1,
    api: "scripted",
    provider: "scripted",
    model: "model",
  });
  let hold: Promise<void> | undefined;
  const gateway: LlmGateway & {
    requests: LlmRequest[];
    summaries: LlmRequest[];
    timeline: string[];
    hold(p?: Promise<void>): void;
  } = {
    requests,
    summaries,
    timeline,
    hold: (p) => {
      hold = p;
    },
    selectedModel: () => "model",
    models: async () => ({ reachability: "pass", models: [] }),
    capabilities: () => ({
      contextWindow: window,
      maxOutputTokens: 1000,
      safetyMargin: Math.max(1024, Math.ceil(window * 0.05)),
      input: ["text" as const],
      inputBudget: window - 1000 - Math.max(1024, Math.ceil(window * 0.05)),
      supportsTools: true,
    }),
    async *stream(request) {
      const summary =
        request.tools.length === 0 && request.system.includes("Summarize the completed historical");
      (summary ? summaries : requests).push(request);
      const last = request.messages.findLast((message) => message.role === "user");
      timeline.push(
        summary
          ? "summary-start"
          : `normal:${typeof last?.content === "string" ? last.content.slice(0, 12) : ""}`,
      );
      if (summary && hold) await hold;
      if (request.signal.aborted) {
        yield {
          type: "error",
          error: { code: "PROVIDER" as const, messageKey: "errors.PROVIDER" },
          aborted: true,
        };
        return;
      }
      if (summary) timeline.push("summary-done");
      const lastMessage = request.messages.at(-1);
      if (
        !summary &&
        lastMessage?.role === "user" &&
        typeof lastMessage.content === "string" &&
        lastMessage.content.includes("READFILE")
      ) {
        yield {
          type: "done",
          message: {
            ...reply("", reportedInput(request)),
            content: [
              {
                type: "toolCall",
                id: `call${requests.length}`,
                name: "read",
                arguments: { path: "big.txt" },
              },
            ],
            stopReason: "toolUse",
          },
        };
        return;
      }
      yield {
        type: "done",
        message: summary
          ? reply(JSON.stringify({ summary: "Earlier work.", decisions: ["kept"], outstandingWork: [] }), 50)
          : reply("Answer", reportedInput(request)),
      };
    },
  };
  return gateway;
}

export async function durableSetup(gateway: LlmGateway) {
  const root = await mkdtemp(join(tmpdir(), "vera-compaction-"));
  await mkdir(join(root, ".vera"));
  // A large file with a secret, for the masking case.
  await writeFile(
    join(root, "big.txt"),
    Array.from({ length: 300 }, (_, line) => `line ${line} SECRETVALUE ${"x".repeat(60)}`).join("\n"),
  );
  const path = join(root, ".vera/vera.db");
  const options = { workbenchId: "wb_test", appVersion: "0" };
  let storage = await openDb(path, options);
  const host: SessionHost = {
    root,
    db: storage.db,
    gateway,
    clock: { now: () => new Date(1_763_657_640_000), sleep: async () => {} },
    model: () => "scripted/model",
    prompt: () => "rules",
  };
  let service = new SessionService(host);
  await service.waitReady();
  cleanup.push(async () => {
    await service.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    host,
    get service() {
      return service;
    },
    events: (id: string): SessionEvent[] => service.exportSession(id).events.map((row) => row.event),
    async restart() {
      await service.close();
      storage.close();
      storage = await openDb(path, options);
      host.db = storage.db;
      service = new SessionService(host);
      await service.waitReady();
    },
  };
}

type Usage = Extract<SessionEvent, { type: "usage.updated" }>;
const preflight = (events: SessionEvent[]) =>
  events.filter((e): e is Usage => e.type === "usage.updated" && e.contextTokens !== undefined).at(-1);

it("keeps the calibration across a restart so the first request after it is counted calibrated", async () => {
  // The provider reports a quarter of the conservative byte estimate. The first request is counted cold,
  // at half of that estimate, so the report is half of its count; a calibrated count already is that
  // quarter with the 10 % margin.
  const gateway = scriptedGateway(200_000, () => 0);
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  let estimate = 0;
  gateway.stream = ((original) =>
    async function* (request: LlmRequest) {
      const own = original.call(gateway, request);
      for await (const event of own) {
        if (event.type === "done" && event.message.usage.input === 0) {
          const counted = preflight(env.events(id))?.contextTokens ?? 0;
          const cold = estimate === 0;
          estimate ||= counted;
          event.message.usage.input = Math.ceil(cold ? counted / 2 : counted / 1.1);
        }
        yield event;
      }
    })(gateway.stream);
  env.service.send(id, `First ${"context ".repeat(2000)}`);
  await env.service.waitIdle(id);
  expect(gateway.summaries).toHaveLength(0);
  const saved = env.events(id).find((e) => e.type === "usage.updated" && e.calibration);
  expect(saved).toMatchObject({ calibration: { modelRef: "scripted/model" } });
  const ratio = (saved as Usage).calibration?.ratio ?? 0;
  expect(ratio).toBeCloseTo(0.25, 2);

  await env.restart();
  env.service.send(id, "Second");
  await env.service.waitIdle(id);
  const after = preflight(env.events(id));
  // Calibrated at a quarter with the 10 % margin: clearly below the cold count (a half) of the same,
  // slightly larger request.
  expect(after?.contextTokens).toBeLessThan(estimate * 0.7);
  expect(gateway.summaries).toHaveLength(0);
});

it("uses the application calibration for a fresh session at the first 32K dispatch", async () => {
  const gateway = scriptedGateway(32_768, () => 5_000);
  const env = await durableSetup(gateway);
  const records = new Map<string, string>();
  env.host.modelCalibrations = new ModelCalibrationStore(
    env.host.root,
    {
      read: async (path) => records.get(path),
      writeAtomic: async (path, content) => {
        records.set(path, content);
      },
    },
    () => [],
  );
  // Between the two counts: over the budget at the cold ratio of a half, inside it and below the
  // compaction trigger at the measured ratio of about a third.
  const largePrompt = "word ".repeat(10_000);
  const cold = env.service.create().id;
  env.service.send(cold, largePrompt);
  expect((await env.service.waitIdle(cold))?.stopReason).toBe("limit");
  expect(gateway.requests).toHaveLength(0);
  // The refused turn's history is summarized in the background; that summary is not the warm session's.
  await env.service.waitCompaction(cold);
  const summarized = gateway.summaries.length;

  const warmup = env.service.create().id;
  env.service.send(warmup, "Measure the model");
  expect((await env.service.waitIdle(warmup))?.stopReason).toBe("end");
  const sample = env.events(warmup).find((event) => event.type === "usage.updated" && event.calibration);
  expect(sample).toMatchObject({ calibration: { modelRef: "scripted/model" } });
  await env.restart();

  const warm = env.service.create().id;
  env.service.send(warm, largePrompt);
  expect((await env.service.waitIdle(warm))?.stopReason).toBe("end");
  expect(gateway.requests).toHaveLength(2);
  const estimated = preflight(env.events(warm));
  expect(estimated?.contextTokens).toBeLessThan(estimated?.inputBudgetTokens ?? 0);
  expect(gateway.summaries).toHaveLength(summarized);

  env.host.model = () => "scripted/another";
  const other = env.service.create().id;
  env.service.send(other, largePrompt);
  expect((await env.service.waitIdle(other))?.stopReason).toBe("limit");
  expect(gateway.requests).toHaveLength(2);

  const otherWarmup = env.service.create().id;
  env.service.send(otherWarmup, "Measure the other model");
  expect((await env.service.waitIdle(otherWarmup))?.stopReason).toBe("end");
  expect(await env.host.modelCalibrations.forModel("scripted/another").read()).toBeDefined();
  env.service.send(warmup, largePrompt);
  expect((await env.service.waitIdle(warmup))?.stopReason).toBe("limit");
  expect(gateway.requests).toHaveLength(3);
});

/** A small window whose provider reports the conservative estimate, so counts stay conservative. */
function smallWindow(window = 60000) {
  return scriptedGateway(
    window,
    (request) =>
      new ContextPolicy().prepare(
        { system: request.system, tools: request.tools, messages: request.messages },
        {
          contextWindow: window,
          maxOutputTokens: 1000,
          safetyMargin: 1024,
          input: ["text"],
          inputBudget: window - 2024,
          supportsTools: true,
        },
        false,
      ).rawTokens,
  );
}
const long = (label: string) => `${label} ${"words ".repeat(3000)}`;
async function turns(env: Awaited<ReturnType<typeof durableSetup>>, id: string, labels: string[]) {
  for (const label of labels) {
    env.service.send(id, long(label));
    const done = await env.service.waitIdle(id);
    expect(done?.stopReason).toBe("end");
    await env.service.waitCompaction(id);
  }
}

// REQ-FUNC-99acfc19
it("compacts in the background right after a turn and lets the next message reuse it", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  await turns(env, id, ["one", "two", "three"]);
  expect(gateway.summaries.length).toBeGreaterThan(0);
  const summaries = gateway.summaries.length;
  // The summary ran after the turn ended, before any later request.
  const events = env.events(id);
  const lastDone = events.findLastIndex((e) => e.type === "turn.done");
  expect(events.slice(lastDone).some((e) => e.type === "context.compacted")).toBe(true);
  env.service.send(id, "short follow-up");
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  expect(gateway.summaries.length).toBe(summaries);
});

it("makes a message sent during a background compaction wait for it without a second summary", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  await turns(env, id, ["one", "two"]);
  let release!: () => void;
  gateway.hold(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  const summaries = gateway.summaries.length;
  env.service.send(id, long("three"));
  await env.service.waitIdle(id);
  await expect.poll(() => gateway.summaries.length).toBeGreaterThan(summaries);
  const started = gateway.summaries.length;
  const normal = gateway.requests.length;
  env.service.send(id, "during");
  // Admitted at once, while the summary is still held.
  expect(env.events(id).some((e) => e.type === "message.user" && e.text === "during")).toBe(true);
  release();
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  expect(gateway.requests.length).toBe(normal + 1);
  expect(gateway.summaries.length).toBe(started);
  // Its model request started only after the held summary finished.
  const timeline = gateway.timeline;
  expect(timeline.indexOf("normal:during")).toBeGreaterThan(timeline.lastIndexOf("summary-done"));
});

it("aborts a background compaction on stop and records nothing", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  await turns(env, id, ["one", "two"]);
  const before = env.events(id).filter((e) => e.type === "context.compacted").length;
  const summaries = gateway.summaries.length;
  gateway.hold(new Promise<void>(() => {}));
  env.service.send(id, long("three"));
  await env.service.waitIdle(id);
  await expect.poll(() => gateway.summaries.length).toBeGreaterThan(summaries);
  env.service.stop(id);
  await env.service.waitCompaction(id);
  expect(env.events(id).filter((e) => e.type === "context.compacted")).toHaveLength(before);
});

// REQ-DATA-d9ca38e5
it("reuses the saved summary after a restart without a summary call and keeps it out of chat and Markdown", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  await turns(env, id, ["one", "two", "three"]);
  const record = env.events(id).findLast((e) => e.type === "context.compacted");
  expect(record).toMatchObject({ type: "context.compacted", covered: expect.any(Number) });
  const summaries = gateway.summaries.length;
  const before = env.service.get(id).snapshot;
  await env.restart();
  // Opening the session makes no summary call and shows the same transcript.
  expect(env.service.get(id).snapshot).toEqual(before);
  expect(gateway.summaries.length).toBe(summaries);
  env.service.send(id, "after restart");
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  expect(gateway.summaries.length).toBe(summaries);
  const last = gateway.requests.at(-1);
  expect(JSON.stringify(last?.messages)).toContain("Derived historical context");
  expect(JSON.stringify(last?.messages)).not.toContain("one words");
  // The JSON export carries the record; the transcript projection and Markdown do not.
  expect(JSON.stringify(env.service.exportSession(id))).toContain("context.compacted");
  expect(JSON.stringify(env.service.get(id).snapshot.items)).not.toContain("Derived historical context");
  expect(buildSessionMarkdown(env.service.exportSession(id), [])).not.toContain("Derived historical context");
});

it("ignores a saved summary whose history no longer matches", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  await turns(env, id, ["one", "two", "three"]);
  env.host.db
    .prepare(
      "UPDATE events SET payload_json=json_set(payload_json,'$.fingerprint','0000') WHERE session_id=? AND type='context.compacted'",
    )
    .run(id);
  await env.restart();
  const summaries = gateway.summaries.length;
  await turns(env, id, ["four"]);
  expect(gateway.summaries.length).toBeGreaterThan(summaries);
});

it("keeps the in-memory summary when its durable record cannot be written", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  env.host.db.exec(
    "CREATE TEMP TRIGGER refuse_record BEFORE INSERT ON events WHEN NEW.type='context.compacted' BEGIN SELECT RAISE(ABORT, 'test persistence failure'); END",
  );
  await turns(env, id, ["one", "two", "three"]);
  expect(gateway.summaries.length).toBeGreaterThan(0);
  expect(env.events(id).some((e) => e.type === "context.compacted")).toBe(false);
  const summaries = gateway.summaries.length;
  env.service.send(id, "follow-up");
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  expect(gateway.summaries.length).toBe(summaries);
  expect(JSON.stringify(gateway.requests.at(-1)?.messages)).toContain("Derived historical context");
});

it("starts no summary after a turn below the trigger and reports running only after the turn ended", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  env.service.send(id, "short question");
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  expect(gateway.summaries).toHaveLength(0);
  expect(env.events(id).some((e) => e.type === "usage.updated" && e.compactionStatus === "running")).toBe(
    false,
  );
  await turns(env, id, ["one", "two"]);
  const events = env.events(id);
  const running = events.findIndex((e) => e.type === "usage.updated" && e.compactionStatus === "running");
  expect(running).toBeGreaterThan(events.findIndex((e, index) => index > 0 && e.type === "turn.done"));
  expect(
    events[running - 1]?.type === "turn.done" || events.slice(0, running).some((e) => e.type === "turn.done"),
  ).toBe(true);
});

it("aborts a background compaction when the workbench closes", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  const id = env.service.create().id;
  await turns(env, id, ["one", "two"]);
  const summaries = gateway.summaries.length;
  gateway.hold(new Promise<void>(() => {}));
  env.service.send(id, long("three"));
  await env.service.waitIdle(id);
  await expect.poll(() => gateway.summaries.length).toBeGreaterThan(summaries);
  const records = env.events(id).filter((e) => e.type === "context.compacted").length;
  // Close settles although the held summary never answers: the abort ends it.
  await env.service.close();
  await env.restart();
  expect(env.events(id).filter((e) => e.type === "context.compacted")).toHaveLength(records);
});

it("keeps background summaries usable when masking rewrites the stored transcript", async () => {
  const gateway = smallWindow();
  const env = await durableSetup(gateway);
  env.host.scrub = (text) => text.replaceAll("SECRETVALUE", "[REDACTED]");
  const id = env.service.create().id;
  for (const label of ["one", "two", "three READFILE"]) {
    env.service.send(id, `${long(label)} SECRETVALUE`);
    expect((await env.service.waitIdle(id))?.stopReason).toBe("end");
    await env.service.waitCompaction(id);
  }
  expect(gateway.summaries.length).toBeGreaterThan(0);
  // The last turn read a file: its tool result is part of the history the background summary covered.
  expect(JSON.stringify(gateway.summaries.at(-1)?.messages)).toContain("three READFILE");
  const summaries = gateway.summaries.length;
  env.service.send(id, "short follow-up");
  await env.service.waitIdle(id);
  await env.service.waitCompaction(id);
  // The next turn starts from the masked stored transcript and still reuses the background summary.
  expect(gateway.summaries.length).toBe(summaries);
  expect(JSON.stringify(env.events(id).filter((e) => e.type === "context.compacted"))).not.toContain(
    "SECRETVALUE",
  );
});
