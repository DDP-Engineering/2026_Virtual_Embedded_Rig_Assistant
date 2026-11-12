// REQ-TEST-df5ff0ba REQ-TEST-58d27601 REQ-TEST-c0e68f23 REQ-TEST-7cc7bf91 REQ-TEST-5c4d259f REQ-SEC-4bebe590
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applySessionEvent, emptySessionState, sessionEventSchema } from "@vera/shared";
import { expect, it } from "vitest";
// @ts-expect-error Node ESM fixture generator.
import { fixtures } from "../../scripts/eval-performance-harness/fixtures.mjs";
// @ts-expect-error Node ESM benchmark modules are checked by focused behavior tests.
import * as performanceReport from "../../scripts/eval-performance-harness/report.mjs";
// @ts-expect-error Node ESM native runner.
import { deadline } from "../../scripts/eval-performance-harness/runner.mjs";

const { calibrate, compare, contentHash, hash, metrics, saveReport, stats, validateReport } =
  performanceReport;

function report(mode = "full", value = 100) {
  const count = mode === "full" ? 30 : 5;
  const fixture = { format: 1, seed: "fixture" };
  return {
    format: 1,
    runId: crypto.randomUUID(),
    mode,
    repetitions: count,
    cases: ["small/first"],
    fixture,
    identity: {
      fixtureHash: hash(fixture),
      harnessHash: "a".repeat(64),
      environment: {
        host: "b".repeat(64),
        os: "win32",
        release: "fixture",
        cpu: "fixture",
        cores: 1,
        ramBytes: 100,
        runtime: { electron: "44", chromium: "1", node: "24" },
        nodeRunner: "24",
      },
      buildMode: "compiled-test-session-performance",
      viewport: [1440, 900],
      scale: 1,
    },
    source: { commit: "a".repeat(40), dirty: true, candidateHash: "b".repeat(64), buildHash: "c".repeat(64) },
    samples: Array.from({ length: count }, (_, index) => ({
      case: "small/first",
      index,
      ok: true,
      correct: true,
      externalTraffic: 0,
      providerRequests: 0,
      metrics: Object.fromEntries(metrics.map((key: string) => [key, value])),
      memory: {
        before: { main: { rssBytes: 1 }, renderer: { rssBytes: 1 } },
        after: { main: { rssBytes: 2 }, renderer: { rssBytes: 2 } },
      },
    })),
  };
}
const budgets = { "small/first": { loadMs: 250, mainGapMs: 250, rendererGapMs: 250 } };

it("uses medians, nearest-rank p95 and no quick p95", () => {
  expect(stats([4, 1, 3, 2])).toEqual({ count: 4, median: 2.5, max: 4 });
  expect(
    stats(
      Array.from({ length: 30 }, (_, i) => i + 1),
      true,
    ).p95,
  ).toBe(29);
  expect(() => stats([Number.NaN])).toThrow();
});
it("uses an external deadline even when the observed operation never resolves", async () => {
  let stopped = false;
  await expect(
    deadline(
      () => new Promise(() => {}),
      10,
      () => {
        stopped = true;
      },
    ),
  ).rejects.toThrow("external-deadline");
  expect(stopped).toBe(true);
});
it("calibrates distinct repeated full runs and rejects deliberate regressions", () => {
  const reference = calibrate([report(), report("full", 102)], budgets);
  expect(compare(report("quick", 105), reference).status).toBe("passed");
  expect(
    compare(report("quick", 160), reference).failures.some((f: { kind: string }) => f.kind === "regression"),
  ).toBe(true);
  expect(
    compare(report("quick", 300), reference).failures.some((f: { kind: string }) => f.kind === "budget"),
  ).toBe(true);
  expect(
    calibrate([report("full", 300), report("full", 300)], budgets).existingBudgetFailures.length,
  ).toBeGreaterThan(0);
});
it("does not let edited reference summaries bypass recalculation", () => {
  const reference = calibrate([report(), report()], budgets);
  reference.thresholds = {};
  expect(compare(report("quick", 200), reference).status).toBe("failed");
});
it("rejects duplicated executions, quick references and unconfigured budgets", () => {
  const one = report();
  expect(() => calibrate([one, one], budgets)).toThrow();
  expect(() => calibrate([report("quick"), report("quick")], budgets)).toThrow();
  expect(() => calibrate([report(), report()], {})).toThrow();
});
it.each(["host", "os", "cpu"])("rejects incompatible %s evidence", (field) => {
  const reference = calibrate([report(), report()], budgets),
    candidate = report("quick");
  Object.assign(candidate.identity.environment, { [field]: "different" });
  expect(() => compare(candidate, reference)).toThrow();
});
it.each([
  "incomplete",
  "failed",
  "negative",
  "infinite",
  "duplicate",
  "network",
  "memory",
  "provenance",
  "fixture",
])("rejects %s evidence", (kind) => {
  const candidate = report();
  if (kind === "incomplete") candidate.samples.pop();
  if (kind === "failed") candidate.samples[0]!.ok = false;
  if (kind === "negative") candidate.samples[0]!.metrics.loadMs = -1;
  if (kind === "infinite") candidate.samples[0]!.metrics.loadMs = Infinity;
  if (kind === "duplicate") candidate.samples[0]!.index = 1;
  if (kind === "network") candidate.samples[0]!.externalTraffic = 1;
  if (kind === "memory") candidate.samples[0]!.memory.before.renderer.rssBytes = 0;
  if (kind === "provenance") candidate.source.candidateHash = "";
  if (kind === "fixture") candidate.fixture.seed = "changed";
  expect(() => validateReport(candidate)).toThrow();
});
it("freezes deterministic mixed current-format fixture counts and bounded payload", () => {
  const data = fixtures();
  expect(fixtures().fixtureHash).toBe(data.fixtureHash);
  expect(data.manifest.format).toBe(1);
  for (const session of data.sessions) {
    expect(session.stored).toHaveLength(session.messages);
    expect(
      session.events.filter((e: { type: string }) => ["message.user", "message.done"].includes(e.type)),
    ).toHaveLength(session.messages);
    for (const event of session.events) expect(sessionEventSchema.safeParse(event).success).toBe(true);
    expect(Math.max(...session.events.map((e: { preview?: string }) => e.preview?.length ?? 0))).toBe(
      session.tier === "payload" ? 65536 : 11,
    );
  }
});

it("exposes the repeatable session performance command", async () => {
  const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  expect(pkg.scripts["perf:sessions"]).toBe("node scripts/perf-sessions.mjs");
});

it("detects a quick maximum regression even when its median and absolute budget pass", () => {
  const reference = calibrate([report(), report()], budgets),
    candidate = report("quick");
  candidate.samples[0]!.metrics.loadMs = 190;
  expect(
    compare(candidate, reference).failures.some((f: { percentile?: string }) => f.percentile === "max"),
  ).toBe(true);
});
it("verifies the full expected projection including interior messages and tool previews", () => {
  const session = fixtures().sessions[0];
  const snapshot = session.events.reduce(applySessionEvent, emptySessionState());
  expect(contentHash({ snapshot, seq: session.events.length })).toBe(session.snapshotHash);
  snapshot.items[2].text = "wrong interior content";
  expect(contentHash({ snapshot, seq: session.events.length })).not.toBe(session.snapshotHash);
});
it("preserves useful reference differences and failures in standalone comparison Markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-perf-report-"));
  try {
    const reference = calibrate([report(), report()], budgets);
    for (const value of [105, 300]) {
      const result = compare(report("quick", value), reference);
      const file = join(root, `${value}.json`);
      await saveReport(file, { format: 1, kind: "session-performance-comparison", ...result });
      const markdown = await readFile(`${file}.md`, "utf8");
      expect(markdown).toContain("small/first");
      expect(markdown).toContain("Reference | Candidate | Delta | Limit");
      if (value === 300) expect(markdown).toContain("budget");
      await expect(saveReport(file, result)).rejects.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
