import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Node ESM evaluator modules; their behavior is what these tests check.
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const cases = await load("evaluators/shared/cases.mjs");
const events = await load("evaluators/shared/events.mjs");
const html = await load("evaluators/shared/report-html.mjs");
const agent = await load("evaluators/shared/agent-report.mjs");
const identity = await load("evaluators/shared/identity.mjs");
const performance = await load("evaluators/performance/report-model.mjs");
const retrieval = await load("evaluators/retrieval/report-model.mjs");

const expectSchema = z.strictObject({ answer: z.string() });
const caseFile = (items: string) =>
  `schema: 1\nworkbench: tests/fixtures/workbenches/demo-board\ncases:\n${items}`;
const external = /(?:href|src)="(?:[a-z][a-z0-9+.-]*:|\/\/)|<script|<link|@import|url\(/i;

describe("case files", () => {
  it("accepts a valid file and rejects duplicates, escaping paths, unknown keys and bad expectations", () => {
    const ok = cases.parseCases(
      caseFile("  - id: one\n    language: en\n    prompt: Hi\n    expect: { answer: x }\n"),
      expectSchema,
    );
    expect(ok.cases[0].id).toBe("one");
    const bad = [
      caseFile(
        "  - id: one\n    language: en\n    prompt: a\n    expect: { answer: x }\n  - id: one\n    language: en\n    prompt: b\n    expect: { answer: y }\n",
      ),
      caseFile(
        "  - id: one\n    language: en\n    prompt: a\n    replay: ../x.jsonl\n    expect: { answer: x }\n",
      ),
      caseFile("  - id: one\n    language: en\n    prompt: a\n    extra: 1\n    expect: { answer: x }\n"),
      caseFile("  - id: one\n    language: en\n    prompt: a\n    expect: { answer: 1 }\n"),
      caseFile("  - id: One\n    language: en\n    prompt: a\n    expect: { answer: x }\n"),
    ];
    for (const text of bad) expect(() => cases.parseCases(text, expectSchema)).toThrow(/Invalid case file/);
  });
});

describe("event extraction", () => {
  const line = (event: object, seq?: number) =>
    JSON.stringify({ sessionId: "s", ...(seq ? { seq } : {}), event });
  const stream = [
    line({ type: "turn.started", turnId: "t" }, 1),
    line({ type: "usage.updated", inputTokens: 100, outputTokens: 10 }, 2),
    line({ type: "tool.started", callId: "c1", name: "search_docs", args: { query: "I2C" } }, 3),
    line({ type: "tool.done", callId: "c1", ok: true, summary: "{}" }, 4),
    line({ type: "tool.started", callId: "c2", name: "write", args: { path: "a.md" } }, 5),
    line(
      {
        type: "approval.requested",
        approvalId: "a1",
        callId: "c2",
        tool: "write",
        path: "a.md",
        diff: "",
        bytes: 1,
      },
      6,
    ),
    line({ type: "approval.decided", approvalId: "a1", decision: "denied", by: "mode" }, 7),
    line({ type: "tool.done", callId: "c2", ok: false, summary: "The user denied this change." }, 8),
    line({ type: "message.delta", messageId: "m", text: "0x" }),
    "not json",
    line(
      {
        type: "message.done",
        messageId: "m",
        text: "Address 0x48 [[a#p=2]] [[b#p=9]]",
        citations: [
          { ref: "a#p=2", valid: true },
          { ref: "b#p=9", valid: false },
        ],
      },
      9,
    ),
    line({ type: "usage.updated", inputTokens: 250, outputTokens: 40 }, 10),
    line({ type: "turn.done", turnId: "t", stopReason: "end" }, 11),
  ].join("\n");

  it("collects tools, approvals, the answer, citations, cumulative usage and the stop reason", () => {
    const { lines, invalid } = events.parseEventLines(stream);
    expect(invalid).toBe(1);
    const summary = events.summarizeEvents(lines);
    expect(summary.tools.map((t: { name: string; ok: boolean }) => [t.name, t.ok])).toEqual([
      ["search_docs", true],
      ["write", false],
    ]);
    expect(summary.approvals).toMatchObject([
      { tool: "write", path: "a.md", decision: "denied", by: "mode" },
    ]);
    expect(summary.answer).toBe("Address 0x48 [[a#p=2]] [[b#p=9]]");
    expect(summary.usage).toEqual({ input: 250, output: 40 });
    expect(summary.stopReason).toBe("end");
    expect(events.citationValidity(summary)).toBe(0.5);
  });
});

const model = (overrides: object = {}) => ({
  title: "T <b>",
  status: "passed",
  source: "run/run.json",
  identity: [
    ["Model", "custom/a"],
    ["Harness hash", "h"],
  ],
  compatibility: { harnessHash: "h" },
  thresholds: [{ name: "Done", value: 1, op: ">=", limit: 1, unit: "ratio", pass: true }],
  metrics: [{ key: "done", label: "Done", value: 0.75, unit: "ratio", better: "higher" }],
  tables: [],
  caseColumns: ["Language"],
  cases: [
    {
      id: "case-one",
      status: "failed",
      values: ["en"],
      blocks: [
        { title: "Answer", text: "<script>alert(1)</script> see https://example.com" },
        {
          details: "Repeat 1",
          blocks: [{ title: "Events", link: { label: "events", href: "events/case-one.1.jsonl" } }],
        },
      ],
    },
  ],
  ...overrides,
});

describe("HTML report", () => {
  it("is self-contained, escapes content and links each case to its section and events", () => {
    const page = html.renderReport(model());
    expect(page).not.toMatch(external);
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain('href="#case-case-one"');
    expect(page).toContain('id="case-case-one"');
    expect(page).toContain('href="events/case-one.1.jsonl"');
    expect(page).toContain("prefers-color-scheme:dark");
  });

  it("refuses an external link", () => {
    const bad = model({
      cases: [
        { id: "x", status: "passed", blocks: [{ link: { label: "x", href: "https://example.com/x" } }] },
      ],
    });
    expect(() => html.renderReport(bad)).toThrow(/External link/);
  });

  it("compares compatible runs and reports incompatible ones without deltas", () => {
    const reference = model({
      metrics: [{ key: "done", label: "Done", value: 0.5, unit: "ratio", better: "higher" }],
    });
    const same = html.compareModels(model(), reference);
    expect(same.compatible).toBe(true);
    expect(same.deltas).toMatchObject([{ key: "done", delta: 0.25, verdict: "better" }]);
    const other = model({ compatibility: { harnessHash: "other" }, identity: [["Harness hash", "other"]] });
    const incompatible = html.compareModels(other, reference);
    expect(incompatible.compatible).toBe(false);
    expect(incompatible.deltas).toEqual([]);
    expect(html.renderReport(other, reference)).toContain("Incompatible runs");
  });
});

describe("report models", () => {
  it("renders an agent run with per-repeat details", () => {
    const repeat = {
      repeat: 1,
      exitCode: 0,
      timedOut: false,
      eventsPath: "events/a.1.jsonl",
      stderrPath: "events/a.1.stderr.txt",
      invalidLines: 0,
      timing: { firstEventMs: 10, firstTokenMs: 20, totalMs: 1234.5 },
      summary: {
        tools: [{ name: "read", args: { path: "board.txt" }, ok: true }],
        approvals: [],
        answer: "3.3 V",
        messages: ["3.3 V"],
        citations: [{ ref: "board.txt#L1", valid: true }],
        usage: { input: 1, output: 2 },
        compactions: 0,
        stopReason: "end",
        errors: [],
      },
      metrics: { completed: true, totalMs: 1234.5 },
      pass: true,
    };
    const run = {
      family: "smoke",
      status: "passed",
      identity: { family: "smoke", provider: "replay", model: "script", repeats: 1, cases: "c.yaml" },
      compatibility: { family: "smoke" },
      startedAt: "2026-11-21T00:00:00.000Z",
      durationMs: 1500,
      aggregate: {
        metrics: [{ key: "totalMs", label: "Mean time", value: 1234.5, unit: "ms", better: "lower" }],
        thresholds: [],
      },
      cases: [{ id: "a", language: "en", prompt: "p", expect: {}, repeats: [repeat], pass: true }],
    };
    const page = html.renderReport(agent.agentReportModel(run, {}, "x/run.json"));
    expect(page).not.toMatch(external);
    expect(page).toContain("Repeat 1: passed");
    expect(page).toContain('href="events/a.1.jsonl"');
    expect(page).toContain("1235 ms");
  });

  it("renders the retained performance baseline and compares it with itself", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = join(root, "evaluators/performance/baselines/2026-11-12-windows-session-loading/run.json");
    const report = JSON.parse(await readFile(path, "utf8"));
    const result = performance.toReportModel(report, path);
    expect(result.cases).toHaveLength(12);
    const comparison = html.compareModels(result, result);
    expect(comparison.compatible).toBe(true);
    expect(comparison.deltas.every((d: { verdict: string }) => d.verdict === "same")).toBe(true);
    expect(html.renderReport(result, result)).not.toMatch(external);
  });

  it("applies the retrieval thresholds and compares embedding models on the same questions", () => {
    const group = (hits: number, total: number) => ({ hits, total, recallAt5: hits / total });
    const metrics = (hit: boolean) => ({
      overall: group(1, 2),
      en: group(1, 1),
      ro: group(0, 1),
      questions: [
        { id: "q-en", language: "en", expected: { path: "d.pdf", page: 1 }, hit: true, top5: [] },
        { id: "q-ro", language: "ro", expected: { path: "d.pdf", page: 1 }, hit, top5: [] },
      ],
    });
    const result = (modelId: string) => ({
      pass: false,
      modelId,
      thresholds: { overall: 0.85, en: 0.95, ro: 0.75 },
      fixtureSha256: "f",
      identity: { harnessHash: "h" },
      metrics: { keyword: metrics(false), semantic: metrics(false), hybrid: metrics(false) },
    });
    const a = retrieval.toReportModel(result("bge"));
    expect(a.thresholds.map((t: { pass: boolean }) => t.pass)).toEqual([false, true, false]);
    expect(html.compareModels(a, retrieval.toReportModel(result("e5"))).compatible).toBe(true);
  });
});

describe("run identity", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("hashes only the harness code and names runs and reports predictably", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vera-eval-identity-"));
    dirs.push(dir);
    await writeFile(join(dir, "run.mjs"), "export const a = 1;\n");
    await writeFile(join(dir, "README.md"), "one");
    const first = await identity.harnessHash([dir]);
    await writeFile(join(dir, "README.md"), "two");
    expect(await identity.harnessHash([dir])).toBe(first);
    await writeFile(join(dir, "run.mjs"), "export const a = 2;\n");
    expect(await identity.harnessHash([dir])).not.toBe(first);
    expect(identity.runId("Custom qwen/qwen3.8-27b low", new Date(2026, 10, 21, 9, 5, 7))).toBe(
      "20261121-090507-custom-qwen-qwen3.8-27b-low",
    );
    expect(identity.reportPathFor(join("a", "run.json"))).toBe(join("a", "report.html"));
    expect(identity.reportPathFor(join("a", "x.json"))).toBe(join("a", "x.html"));
  });
});
