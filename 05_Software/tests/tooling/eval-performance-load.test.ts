import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Node ESM evaluator modules; their behavior is what these tests check.
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const agentLoad = await load("evaluators/performance/agent-load.mjs");
const html = await load("evaluators/shared/report-html.mjs");

it("summarizes a sample with its median, nearest-rank p95 and spread", () => {
  expect(agentLoad.stats([30, 10, 20])).toEqual({ count: 3, median: 20, p95: 30, spread: 20 });
  expect(agentLoad.stats([1, 2, 3, 4])).toMatchObject({ median: 2.5, p95: 4 });
  expect(agentLoad.stats([])).toBeNull();
});

it("compares agent-load runs within their noise band", () => {
  const report = (callGap: number, spread: number) => ({
    kind: "vera-performance-agent-load",
    identity: {
      host: "h",
      harnessHash: "x",
      corpusHash: "c",
      hardCorpusHash: "d",
      steps: 4,
      os: "os",
      cpu: "cpu",
      ramGiB: 1,
      node: "v24",
      cliHash: "cli",
    },
    source: { commit: "abc", dirty: false },
    repeats: 3,
    summary: { "calls/replay": { callGapMs: { count: 3, median: callGap, p95: callGap, spread } } },
  });
  const base = agentLoad.toAgentLoadReportModel(report(17, 1));
  const noise = html.compareModels(agentLoad.toAgentLoadReportModel(report(18, 1)), base);
  expect(noise.deltas[0]).toMatchObject({ verdict: "same" });
  const slower = html.compareModels(agentLoad.toAgentLoadReportModel(report(30, 1)), base);
  expect(slower.deltas[0]).toMatchObject({ verdict: "worse" });
  const otherHost = agentLoad.toAgentLoadReportModel({
    ...report(17, 1),
    identity: { ...report(17, 1).identity, host: "z" },
  });
  expect(html.compareModels(otherHost, base).compatible).toBe(false);
});
