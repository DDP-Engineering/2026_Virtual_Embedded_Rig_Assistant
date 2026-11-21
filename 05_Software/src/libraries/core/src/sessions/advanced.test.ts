// REQ-FUNC-902313e0 REQ-DATA-96ef3dd6 REQ-DATA-33a90ef2 REQ-FUNC-2e124a88
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { zeroUsage } from "../agent/runtime.js";
import type { LlmGateway } from "../llm/gateway.js";
import { openDb } from "../storage/db.js";
import { type SessionHost, SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** A model that asks to read the board file on every step, so only the tool-call cap ends a turn. */
const gateway: LlmGateway = {
  selectedModel: () => "model",
  models: async () => ({ reachability: "pass", models: [] }),
  capabilities: () => ({
    contextWindow: 400_000,
    maxOutputTokens: 1000,
    safetyMargin: 20_000,
    input: ["text" as const],
    inputBudget: 379_000,
    supportsTools: true,
  }),
  async *stream(request) {
    const message: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: `c${request.messages.length}`,
          name: "read",
          arguments: { path: "board.txt" },
        },
      ],
      stopReason: "toolUse",
      usage: zeroUsage(),
      timestamp: 1,
      api: "scripted",
      provider: "scripted",
      model: "model",
    };
    yield { type: "done", message };
  },
};

async function setup(
  advanced: {
    app?: Record<string, unknown>;
    workbench?: Record<string, unknown>;
    run?: Record<string, unknown>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "vera-advanced-"));
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, "board.txt"), "Board uses 3.3 V.\n");
  const path = join(root, ".vera/vera.db");
  const options = { workbenchId: "wb_test", appVersion: "0" };
  let storage = await openDb(path, options);
  const logs: string[] = [];
  const host: SessionHost = {
    root,
    db: storage.db,
    gateway,
    clock: { now: () => new Date(1), sleep: async () => {} },
    model: () => "scripted/model",
    prompt: () => "rules",
    log: (message) => logs.push(message),
    advanced: {
      app: () => advanced.app ?? {},
      workbench: () => advanced.workbench ?? {},
      ...(advanced.run ? { run: () => advanced.run } : {}),
    },
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
    logs,
    get service() {
      return service;
    },
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
const toolCalls = (env: Awaited<ReturnType<typeof setup>>, id: string) =>
  env.service.exportSession(id).events.filter((row) => row.event.type === "tool.done").length;

it("caps a turn at the resolved Tool calls per turn: session over workbench over app over 50", async () => {
  const env = await setup({ app: { toolCallsPerTurn: 30 }, workbench: { toolCallsPerTurn: 20 } });
  const id = env.service.create().id;
  env.service.setAdvanced(id, "toolCallsPerTurn", 12);
  env.service.send(id, "Read repeatedly");
  expect((await env.service.waitIdle(id))?.stopReason).toBe("limit");
  // Twelve calls run; the next one gets the limit result and the turn ends.
  expect(toolCalls(env, id)).toBe(12);
  env.service.setAdvanced(id, "toolCallsPerTurn", null);
  const before = toolCalls(env, id);
  env.service.send(id, "Again");
  await env.service.waitIdle(id);
  expect(toolCalls(env, id) - before).toBe(20);
});

it("keeps a session value across restart and refuses invalid or locked changes without recording", async () => {
  const env = await setup();
  const id = env.service.create().id;
  env.service.setAdvanced(id, "toolCallsPerTurn", 300);
  await env.restart();
  expect(env.service.get(id).snapshot.advanced).toEqual({ toolCallsPerTurn: 300 });
  const seq = env.service.revision(id).seq;
  for (const [key, value] of [
    ["toolCallsPerTurn", 9],
    ["toolCallsPerTurn", 501],
    ["toolCallsPerTurn", 1.5],
    ["unknown", 20],
  ] as const)
    expect(() => env.service.setAdvanced(id, key as never, value)).toThrow(
      expect.objectContaining({ code: "INVALID" }),
    );
  env.service.setArchived(id, true);
  expect(() => env.service.setAdvanced(id, "toolCallsPerTurn", 40)).toThrow(
    expect.objectContaining({ code: "DENIED" }),
  );
  env.service.setArchived(id, false);
  expect(env.service.revision(id).seq).toBe(seq + 2);
  expect(env.service.get(id).snapshot.advanced).toEqual({ toolCallsPerTurn: 300 });
});

it("ignores invalid stored values, uses the next scope and logs only the key", async () => {
  const env = await setup({
    app: { toolCallsPerTurn: 15 },
    workbench: { toolCallsPerTurn: 9999, extra: "x" },
  });
  const id = env.service.create().id;
  env.service.send(id, "Read repeatedly");
  await env.service.waitIdle(id);
  expect(toolCalls(env, id)).toBe(15);
  expect(env.logs.some((line) => line.includes("toolCallsPerTurn") && line.includes("workbench"))).toBe(true);
  expect(env.logs.some((line) => line.includes("9999"))).toBe(false);
});

// REQ-FUNC-181db660
it("applies run-level values over the session value without recording them", async () => {
  const env = await setup({ run: { toolCallsPerTurn: 11 } });
  const id = env.service.create().id;
  env.service.setAdvanced(id, "toolCallsPerTurn", 30);
  const events = env.service.revision(id).seq;
  env.service.send(id, "Read repeatedly");
  await env.service.waitIdle(id);
  expect(toolCalls(env, id)).toBe(11);
  expect(env.service.get(id).snapshot.advanced).toEqual({ toolCallsPerTurn: 30 });
  expect(
    env.service
      .exportSession(id)
      .events.filter(
        (row) => row.seq > events && row.event.type === "session.updated" && "advanced" in row.event,
      ),
  ).toHaveLength(0);
});

// REQ-DATA-33a90ef2
it("ignores an out-of-range stored session value and an invalid app value, logging each key once", async () => {
  const env = await setup({ app: { toolCallsPerTurn: "many" }, workbench: { toolCallsPerTurn: 14 } });
  const id = env.service.create().id;
  env.host.db
    .prepare("INSERT INTO events(session_id,seq,type,payload_json,created_at) VALUES (?,?,?,?,?)")
    .run(
      id,
      env.service.revision(id).seq + 1,
      "session.updated",
      JSON.stringify({ type: "session.updated", advanced: { toolCallsPerTurn: 9000 } }),
      new Date(1).toISOString(),
    );
  await env.restart();
  for (const prompt of ["One", "Two"]) {
    env.service.send(id, prompt);
    await env.service.waitIdle(id);
  }
  expect(toolCalls(env, id)).toBe(28);
  const lines = env.logs.filter((line) => line.includes("Advanced setting"));
  expect(lines.filter((line) => line.includes("session"))).toHaveLength(1);
  expect(lines.filter((line) => line.includes("app"))).toHaveLength(1);
  expect(lines.join("\n")).not.toContain("9000");
  expect(lines.join("\n")).not.toContain("many");
});
