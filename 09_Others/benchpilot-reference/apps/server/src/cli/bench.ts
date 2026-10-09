// Runner + chat CLI (`npm run bench -- <cmd>`).
import { readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { PlanItem } from "@benchpilot/shared";
import { loadCatalog } from "../catalog/load.ts";
import { config, ROOT_DIR } from "../config.ts";
import { hasData, readPools } from "../data/datasets.ts";
import { dbFile, openDb } from "../db/index.ts";
import { createPlan, decidePlan } from "../db/repos/plans.ts";
import { hasPool } from "../db/repos/pools.ts";
import { getTestbenchConfig } from "../db/repos/testbenches.ts";
import { consoleEmitter } from "../runner/emitter.ts";
import { createRun, evaluateRun, ingestRun, mapLimit } from "../runner/pipeline.ts";
import { reportDir } from "../runner/report.ts";
import { runPlan } from "../runner/run-plan.ts";
import { chat } from "./chat.ts";

const USAGE = `Usage: npm run bench -- <command>

Commands:
  run --fw <version> --tests <id,id,…> [--testbench TB-01] [--speed <n>]
                       create an approved plan and execute it headless (consumes live pools;
                       re-run \`npm run seed\` afterwards). --speed overrides DEMO_SPEED (0 = no waiting).
  eval-all [--jobs <n>]
                       ingest + evaluate every dataset in a scratch DB and print the verdicts
  chat [--script <fixture>] [--testbench TB-01] [--speed <n>]
                       talk to the agent in the terminal (active provider from Settings). --script plays a
                       replay fixture (apps/server/fixtures/replay/<name>.jsonl) headless and auto-approves
                       its plans. Runs consume live pools; re-run \`npm run seed\` afterwards.`;

async function run(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { fw: { type: "string" }, tests: { type: "string" }, testbench: { type: "string", default: "TB-01" }, speed: { type: "string" } },
  });
  if (!values.fw || !values.tests) throw new UsageError("run needs --fw and --tests");
  const testIds = values.tests.split(",").map((s) => s.trim()).filter(Boolean);
  const db = openDb(dbFile(config.runtimeDir));
  try {
    const tb = getTestbenchConfig(db, values.testbench!);
    if (!tb) throw new Error(`testbench ${values.testbench} not found — run \`npm run seed\` first`);
    const catalog = loadCatalog(config.contentDir);
    const pools = readPools(config.dataDir);
    const items: PlanItem[] = testIds.map((id) => {
      const t = catalog.get(id);
      if (!t) throw new Error(`unknown test ${id}`);
      if (!tb.enabled_tests.includes(id)) throw new Error(`${id} is not enabled on ${tb.id}`);
      if (!hasPool(pools, values.fw!, id)) throw new Error(`no simulated data for ${id} on firmware ${values.fw}`);
      return { testId: id, rationale: "Requested on the command line.", name: t.name, version: t.version, duration: t.duration };
    });
    // The operator running the CLI is the approver: the plan goes through the same pending → approved gate.
    const plan = createPlan(db, {
      sessionId: null,
      testbenchId: tb.id,
      title: `CLI run: ${testIds.join(", ")}`,
      device: tb.device.model,
      fw: values.fw,
      items,
      rationale: "Headless run from `npm run bench -- run`.",
    });
    decidePlan(db, plan.id, { decision: "approve" });
    const speed = values.speed !== undefined ? Number(values.speed) : config.demoSpeed;
    const result = await runPlan(
      { db, catalog, pools, dataDir: config.dataDir, runtimeDir: config.runtimeDir, tsharkPath: config.tsharkPath, demoSpeed: speed, emitter: consoleEmitter() },
      plan.id,
    );
    for (const r of result.results)
      for (const c of r.failingChecks) console.log(`  ${r.testRunId} ${r.testId} ✗ ${c.id}: ${c.measured} (expected ${c.expected})`);
    for (const e of result.errors) console.error(`  ${e.testRunId} error: ${e.message}`);
    const dir = reportDir(config.runtimeDir, result.reportId);
    console.log(`report: ${path.relative(ROOT_DIR, path.join(dir, "junit.xml"))} · ${path.relative(ROOT_DIR, path.join(dir, "report.md"))}`);
    if (result.errors.length) process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function evalAll(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { jobs: { type: "string", default: "6" } } });
  if (!hasData(config.dataDir)) throw new Error(`no data in ${config.dataDir} — run \`npm run seed\` first`);
  // Scratch DB: re-evaluation never touches the seeded DB or the live pools.
  const db = openDb(":memory:");
  const catalog = loadCatalog(config.contentDir);
  const deps = { db, catalog, dataDir: config.dataDir, tsharkPath: config.tsharkPath, runtimeDir: null };
  const ids = readdirSync(path.join(config.dataDir, "datasets")).filter((d) => /^DS-\d+$/.test(d)).sort();
  const started = Date.now();
  const rows = await mapLimit(ids, Number(values.jobs), async (datasetId, i) => {
    const run = createRun(deps, { testRunId: `RUN-${String(i + 1).padStart(4, "0")}`, reportId: "EVAL", testbenchId: "TB-01", datasetId });
    await ingestRun(deps, run);
    const e = await evaluateRun(deps, run);
    return { datasetId, fw: run.manifest.fw, testId: run.test.id, verdict: e.verdict, checks: e.checks, errors: e.errors };
  });
  console.log("dataset  fw     test         verdict  checks");
  for (const r of rows) {
    const checks = r.checks.map((c) => `${c.pass ? "" : "✗ "}${c.id}=${c.measured}`).join(" · ");
    console.log(`${r.datasetId}  ${r.fw.padEnd(5)}  ${r.testId.padEnd(11)}  ${r.verdict.toUpperCase().padEnd(7)}  ${checks}${r.errors.length ? `  [${r.errors.join("; ")}]` : ""}`);
  }
  const count = (v: string) => rows.filter((r) => r.verdict === v).length;
  console.log(`${rows.length} datasets: ${count("pass")} pass, ${count("fail")} fail, ${count("error")} error — ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (count("error")) process.exitCode = 1;
  db.close();
}

class UsageError extends Error {}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") console.log(USAGE);
  else if (cmd === "run") await run(rest);
  else if (cmd === "eval-all") await evalAll(rest);
  else if (cmd === "chat") process.exitCode = await chat(rest);
  else throw new UsageError(`unknown command '${cmd}'`);
} catch (err) {
  console.error(`bench: ${(err as Error).message}${err instanceof UsageError ? `\n\n${USAGE}` : ""}`);
  process.exitCode = 1;
}
