import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Node ESM evaluator modules; their behavior is what these tests check.
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const models = await load("evaluators/models/run.mjs");
const { loadCases } = await load("evaluators/shared/cases.mjs");

const base = { completed: 1, taskOk: 1, rejectedRate: 0, timedOut: 0, citationValidity: 1 };

it("applies the documented verdict rules", () => {
  expect(models.verdict(base)).toBe("recommended");
  expect(models.verdict({ ...base, taskOk: 0.7 })).toBe("degraded");
  expect(models.verdict({ ...base, citationValidity: 0.5 })).toBe("degraded");
  expect(models.verdict({ ...base, rejectedRate: 0.3 })).toBe("unsuitable");
  expect(models.verdict({ ...base, completed: 0.6 })).toBe("unsuitable");
  expect(models.verdict({ ...base, timedOut: 0.2 })).toBe("unsuitable");
});

it("scores rejected arguments, unknown tools and the estimate ratio from the events", () => {
  const line = (event: object) => JSON.stringify({ sessionId: "s", event });
  const stdout = [
    line({ type: "usage.updated", inputTokens: 0, outputTokens: 0, contextTokens: 1000, estimated: true }),
    line({ type: "usage.updated", inputTokens: 900, outputTokens: 50 }),
    line({ type: "tool.started", callId: "a", name: "decode_register", args: {} }),
    line({
      type: "tool.done",
      callId: "a",
      ok: false,
      summary: "Invalid arguments for decode_register: value",
    }),
    line({ type: "tool.started", callId: "b", name: "flash", args: {} }),
    line({
      type: "tool.done",
      callId: "b",
      ok: false,
      summary: "Tool flash is unavailable. Choose an enabled tool.",
    }),
  ].join("\n");
  const summary = {
    tools: [
      { name: "decode_register", ok: false },
      { name: "flash", ok: false },
    ],
    approvals: [],
    answer: "PE and ERRIE are set.",
    citations: [],
    usage: { input: 900, output: 50 },
    stopReason: "end",
    errors: [],
  };
  const item = {
    expect: { tools: ["decode_register"], anyTools: [], minCalls: {}, answer: [], cite: false, proposal: [] },
  };
  const result = models.spec.score(item, summary, {
    exitCode: 0,
    timedOut: false,
    stdout,
    timing: { firstTokenMs: 100, totalMs: 1000 },
  });
  expect(result.metrics).toMatchObject({
    rejectedArgs: 1,
    unknownTools: 1,
    estimateRatio: 0.9,
    taskOk: false,
  });
  expect(result.notes.toolsOk).toBe(false);
});

it("has a valid ten-case suite", async () => {
  const file = await loadCases(models.spec.casesFile, models.spec.expect);
  expect(file.cases).toHaveLength(10);
});
