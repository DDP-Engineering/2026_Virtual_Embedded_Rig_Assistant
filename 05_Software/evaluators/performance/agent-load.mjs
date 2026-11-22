import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, hostname, platform, release, totalmem } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { buildCli, runCli } from "../shared/agent-runner.mjs";
import { startEgressGuard } from "../shared/egress-guard.mjs";
import { defaultRunPath, gitState, harnessHash, reportPathFor, software } from "../shared/identity.mjs";
import { formatValue, renderReport } from "../shared/report-html.mjs";

const folder = fileURLToPath(new URL(".", import.meta.url));
const preload = pathToFileURL(join(folder, "rss-preload.mjs")).href;
const sha = (data) => createHash("sha256").update(data).digest("hex");

/** Median, nearest-rank p95 and the spread (max - min) of a sample. */
export function stats(values) {
  const sorted = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: sorted.length,
    median,
    p95: sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)],
    spread: sorted.at(-1) - sorted[0],
  };
}

async function treeHash(root) {
  const parts = [];
  const walk = async (dir) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else parts.push([path.slice(root.length + 1).replaceAll("\\", "/"), sha(await readFile(path))]);
    }
  };
  await walk(root);
  return sha(JSON.stringify(parts));
}

const maxRss = (stderr) => {
  const kb = /VERA_EVAL_MAXRSS_KB=(\d+)/.exec(stderr)?.[1];
  return kb ? Number(kb) / 1024 : null;
};

/** Indexing one corpus from scratch: time, throughput and peak memory of the CLI process. */
async function indexOnce(cli, corpus, scratch, env) {
  const place = await mkdtemp(join(scratch, "index-"));
  const workbench = join(place, "workbench");
  await cp(corpus, workbench, { recursive: true });
  const result = await runCli(cli, ["index", "--workbench", workbench, "--data", join(place, "data")], {
    timeoutMs: 900_000,
    env,
    node: ["--import", preload],
  });
  if (result.exitCode !== 0) throw Error(`vera index failed: ${result.stderr.slice(-1500)}`);
  const documents = JSON.parse(result.stdout.trim().split("\n").at(-1)).documents;
  const db = new Database(join(workbench, ".vera", "vera.db"), { readonly: true });
  const chunks = db.prepare("SELECT COUNT(*) FROM chunks").pluck().get();
  db.close();
  const seconds = result.timing.totalMs / 1000;
  const pages = documents.reduce((sum, d) => sum + (d.pages ?? 1), 0);
  return {
    totalMs: result.timing.totalMs,
    documents: documents.length,
    pages,
    chunks,
    documentsPerSecond: documents.length / seconds,
    chunksPerSecond: chunks / seconds,
    peakRssMiB: maxRss(result.stderr),
  };
}

/**
 * VERA's own time per model call: a replay model answers at once, so the gap between a tool result
 * and the next tool call is prompt build, budget, scrubbing, persistence and event delivery.
 */
async function callsOnce(cli, workbench, scratch, env, steps) {
  const place = await mkdtemp(join(scratch, "calls-"));
  const copy = join(place, "workbench");
  await cp(workbench, copy, { recursive: true });
  const script = join(place, "script.jsonl");
  const lines = Array.from({ length: steps }, (_, i) =>
    JSON.stringify({
      toolCalls: [{ name: "read", args: { path: "board.txt", offset: 1 + (i % 2), limit: 1 } }],
    }),
  );
  await writeFile(script, `${[...lines, JSON.stringify({ text: "done" })].join("\n")}\n`);
  const timeline = [];
  const result = await runCli(
    cli,
    [
      "run",
      "--workbench",
      copy,
      "--data",
      join(place, "data"),
      "--prompt",
      "Read board.txt repeatedly.",
      "--provider",
      "replay",
      "--script",
      script,
      "--format",
      "jsonl",
      "--approve",
      "none",
    ],
    { timeoutMs: 300_000, env, timeline, node: ["--import", preload] },
  );
  if (result.exitCode !== 0)
    throw Error(`vera run failed: ${result.stderr.slice(-800)} ${result.stdout.slice(-1200)}`);
  const gaps = [];
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].type !== "tool.done") continue;
    const next = timeline.slice(i + 1).find((e) => e.type === "tool.started" || e.type === "message.delta");
    if (next) gaps.push(next.ms - timeline[i].ms);
  }
  const started = timeline.find((e) => e.type === "turn.started")?.ms ?? 0;
  const done = timeline.find((e) => e.type === "turn.done")?.ms ?? result.timing.totalMs;
  return {
    callGapMs: stats(gaps)?.median ?? null,
    firstCallGapMs: gaps[0] ?? null,
    lastCallGapMs: gaps.at(-1) ?? null,
    turnMs: done - started,
    processMs: result.timing.totalMs,
    peakRssMiB: maxRss(result.stderr),
  };
}

const MEASURES = {
  indexing: ["totalMs", "documentsPerSecond", "chunksPerSecond", "peakRssMiB"],
  calls: ["callGapMs", "firstCallGapMs", "lastCallGapMs", "turnMs", "processMs", "peakRssMiB"],
};
const LOWER = new Set([
  "totalMs",
  "peakRssMiB",
  "callGapMs",
  "firstCallGapMs",
  "lastCallGapMs",
  "turnMs",
  "processMs",
]);

/** `eval:performance agent-load [--repeats 3] [--steps 4] [--output <run.json>]` */
export async function runAgentLoad(values) {
  const repeats = Number(values.repeats ?? 3);
  // Replay reports no token counts, so VERA's estimate is never calibrated and a 32 K budget is
  // reached after about five tool calls; four keeps every turn complete.
  const steps = Number(values.steps ?? 4);
  if (!Number.isInteger(repeats) || repeats < 2 || repeats > 30) throw Error("--repeats must be 2 to 30");
  const output = resolve(values.output ?? defaultRunPath("performance", "agent-load"));
  try {
    await access(output);
    throw Error(`Output already exists: ${output}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const cli = buildCli();
  const parent = join(software, "node_modules/.cache/evaluators/performance");
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, "load-"));
  const guard = await startEgressGuard();
  const env = { ...process.env, ...guard.env };
  delete env.VERA_REPLAY_DIR;
  try {
    const { writeHardCorpus } = await import(
      pathToFileURL(join(software, "evaluators/retrieval/hard-corpus.mjs")).href
    );
    const hard = join(scratch, "hard-corpus");
    await writeHardCorpus(hard);
    const demo = join(software, "tests/fixtures/workbenches/demo-board");
    const corpora = { "indexing/demo": demo, "indexing/hard": hard };
    const samples = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
      for (const [key, path] of Object.entries(corpora))
        samples.push({ case: key, repeat, ...(await indexOnce(cli, path, scratch, env)) });
      samples.push({ case: "calls/replay", repeat, ...(await callsOnce(cli, demo, scratch, env, steps)) });
      process.stderr.write(`[performance] agent load ${repeat}/${repeats}\n`);
    }
    const cases = [...new Set(samples.map((s) => s.case))];
    const summary = Object.fromEntries(
      cases.map((key) => [
        key,
        Object.fromEntries(
          MEASURES[key.split("/")[0]].map((m) => [
            m,
            stats(samples.filter((s) => s.case === key).map((s) => s[m])),
          ]),
        ),
      ]),
    );
    const report = {
      kind: "vera-performance-agent-load",
      format: 1,
      identity: {
        harnessHash: await harnessHash([folder]),
        corpusHash: await treeHash(demo),
        hardCorpusHash: await treeHash(hard),
        cliHash: sha(await readFile(cli)),
        host: sha(hostname()),
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? "unknown",
        ramGiB: Math.round(totalmem() / 2 ** 30),
        node: process.version,
        steps,
      },
      source: gitState(),
      startedAt: new Date().toISOString(),
      repeats,
      samples,
      summary,
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    await writeFile(reportPathFor(output), renderReport(toAgentLoadReportModel(report, output)), {
      flag: "wx",
    });
    process.stdout.write(`${output}\n`);
    return 0;
  } finally {
    await guard.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Report model of an agent-load run. Each median carries a noise tolerance, the larger of 10 % and
 * twice the spread between repeats, so a comparison calls a change within it "same".
 */
export function toAgentLoadReportModel(report, path = "run.json") {
  const unit = (m) => (m.endsWith("Ms") ? "ms" : undefined);
  const metrics = Object.entries(report.summary).flatMap(([key, measures]) =>
    Object.entries(measures)
      .filter(([, s]) => s)
      .map(([m, s]) => ({
        key: `${key}/${m}`,
        label: `${key} ${m} (median)`,
        value: s.median,
        unit: unit(m),
        better: LOWER.has(m) ? "lower" : "higher",
        tolerance: Math.max(Math.abs(s.median) * 0.1, 2 * s.spread),
      })),
  );
  const id = report.identity;
  return {
    title: "Performance: indexing and per-call agent overhead",
    status: "measured",
    source: `${basename(dirname(path))}/${basename(path)}`,
    identity: [
      ["Host", `${id.os}, ${id.cpu}, ${id.ramGiB} GiB`],
      ["Node", id.node],
      ["Commit", `${report.source.commit ?? "unknown"}${report.source.dirty ? " (dirty)" : ""}`],
      ["CLI bundle", id.cliHash],
      ["Harness hash", id.harnessHash],
      ["Repeats", String(report.repeats)],
      ["Replay steps per turn", String(id.steps)],
    ],
    // Same host, corpora and harness; the CLI may differ, since that is what a comparison measures.
    compatibility: {
      host: id.host,
      harnessHash: id.harnessHash,
      corpusHash: id.corpusHash,
      hardCorpusHash: id.hardCorpusHash,
      steps: id.steps,
    },
    thresholds: [],
    metrics,
    tables: Object.entries(report.summary).map(([key, measures]) => ({
      title: key,
      columns: ["Measure", "Median", "p95", "Spread", "Samples"],
      rows: Object.entries(measures)
        .filter(([, s]) => s)
        .map(([m, s]) => [
          m,
          formatValue(s.median, unit(m)),
          formatValue(s.p95, unit(m)),
          formatValue(s.spread, unit(m)),
          String(s.count),
        ]),
    })),
    cases: [],
  };
}
