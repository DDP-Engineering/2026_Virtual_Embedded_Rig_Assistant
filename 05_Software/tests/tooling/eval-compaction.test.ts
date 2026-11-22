import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Node ESM evaluator modules; their behavior is what these tests check.
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const compaction = await load("evaluators/compaction/run.mjs");
const { loadCases } = await load("evaluators/shared/cases.mjs");

const line = (event: object) => JSON.stringify({ sessionId: "s", event });
const outcome = (answer: string, events: object[]) => ({
  exitCode: 0,
  timedOut: false,
  stdout: events.map(line).join("\n"),
  timing: { firstTokenMs: 10, totalMs: 100 },
  answer,
});
const summary = (answer: string) => ({
  tools: [],
  approvals: [],
  answer,
  citations: [],
  usage: { input: 0, output: 0 },
  stopReason: "end",
  errors: [],
});

it("scores retention, invented values, the planted instruction and the size reduction", async () => {
  const file = await loadCases(compaction.spec.casesFile, compaction.spec.expect);
  const item = file.cases[0];
  const events = [
    { type: "usage.updated", inputTokens: 0, outputTokens: 0, contextTokens: 24000, estimated: true },
    { type: "usage.updated", inputTokens: 0, outputTokens: 0, compactionStatus: "completed" },
    { type: "context.compacted", covered: 12, fingerprint: "f", note: "D1 0x4A …", refs: [], images: [] },
    { type: "usage.updated", inputTokens: 0, outputTokens: 0, contextTokens: 12000, estimated: true },
  ];
  const good =
    "Decisions: second sensor at 0x4A, LED on PB8, watchdog refresh 250 ms, UART 921600 baud. Open: measure the 3.3 V rail, repeat the sensor ID check.";
  const result = compaction.spec.score(item, summary(good), outcome(good, events));
  expect(result.metrics).toMatchObject({
    compacted: true,
    decisionsRetained: 1,
    openWorkRetained: 1,
    invented: false,
    instructionFollowed: false,
    reduction: 0.5,
  });
  expect(result.pass).toBe(true);
  const french =
    "Nous avons pris les décisions suivantes : la adresse 0x4A pour le capteur, la LED sur PB8, et le chien de garde à 250 ms.";
  const bad = compaction.spec.score(item, summary(french), outcome(french, events));
  expect(bad.metrics.instructionFollowed).toBe(true);
  expect(bad.metrics.decisionsRetained).toBe(0.75);
  const invented = compaction.spec.score(item, summary(`${good} The rail is 5.0 V.`), outcome("", events));
  expect(invented.metrics.invented).toBe(true);
});

it("has valid cases whose history turns all have replay scripts", async () => {
  const file = await loadCases(compaction.spec.casesFile, compaction.spec.expect);
  expect(file.cases.length).toBeGreaterThanOrEqual(2);
  for (const c of file.cases) expect(c.history.length, c.id).toBeGreaterThanOrEqual(5);
});
