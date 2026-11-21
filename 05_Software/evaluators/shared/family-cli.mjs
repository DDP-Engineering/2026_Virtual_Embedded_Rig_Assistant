import { access, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { agentReportModel } from "./agent-report.mjs";
import { runAgentFamily } from "./agent-runner.mjs";
import { loadCases } from "./cases.mjs";
import { parseEventLines, summarizeEvents } from "./events.mjs";
import { harnessHash, reportPathFor, software } from "./identity.mjs";
import { renderReport } from "./report-html.mjs";

const USAGE = (family) => `usage:
  npm run eval:${family} -- run [--provider custom|openai|replay] [--model <id>] [--base-url <url>]
      [--reasoning off|low|medium|high|xhigh] [--key-env <NAME>] [--repeats <n>] [--cases <id,id>]
      [--label <text>] [--output <run.json>] [--timeout <seconds>] [--approve none|all]
      [--web off|blocked|on]
  npm run eval:${family} -- report --input <run.json> [--reference <run.json>] [--output <report.html>]

Defaults come from VERA_EVAL_PROVIDER, VERA_EVAL_MODEL, VERA_EVAL_BASE_URL, VERA_EVAL_REASONING and
VERA_EVAL_KEY_ENV; a run writes evaluation-outputs/${family}/<run-id>/run.json and report.html.`;

async function refuseExisting(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw Error(`Output already exists: ${path}`);
}

/** Writes the HTML report of a saved run, optionally compared with a reference run. */
export async function writeReport({ input, reference, output }, toModel) {
  const model = toModel(JSON.parse(await readFile(input, "utf8")), input);
  const referenceModel = reference
    ? toModel(JSON.parse(await readFile(reference, "utf8")), reference)
    : undefined;
  const target = resolve(output ?? reportPathFor(input));
  await refuseExisting(target);
  await writeFile(target, renderReport(model, referenceModel), { flag: "wx" });
  return target;
}

/**
 * Scores a saved run again from its events with the current scoring code, without asking the model
 * again: `rescore --input <run.json> [--output <new run.json>]`. The cases must be unchanged. Model
 * requests are not kept in a run, so checks that need them (the safety canary in requests) only see
 * the printed output.
 */
async function rescore(spec, values) {
  if (!values.input) throw Error("--input is required");
  const input = resolve(values.input);
  const folder = dirname(input);
  const run = JSON.parse(await readFile(input, "utf8"));
  const cases = await loadCases(spec.casesFile, spec.expect);
  if (cases.sha256 !== run.identity.casesSha256)
    throw Error("The case file changed since this run; rescore needs the same cases.");
  const byId = new Map(cases.cases.map((item) => [item.id, item]));
  for (const result of run.cases) {
    const item = byId.get(result.id);
    for (const repeat of result.repeats) {
      const stdout = await readFile(join(folder, repeat.eventsPath), "utf8");
      const stderr = await readFile(join(folder, repeat.stderrPath), "utf8").catch(() => "");
      const summary = summarizeEvents(parseEventLines(stdout).lines);
      const scored = spec.score(item, summary, {
        exitCode: repeat.exitCode,
        timedOut: repeat.timedOut,
        stdout,
        stderr,
        timing: repeat.timing,
        egress: repeat.egress ?? [],
        modelRequests: [],
        workbench: null,
      });
      Object.assign(repeat, { summary, metrics: scored.metrics, pass: scored.pass });
      if (scored.notes) repeat.notes = scored.notes;
      else delete repeat.notes;
    }
    result.pass = result.repeats.every((r) => r.pass);
  }
  run.aggregate = spec.aggregate(run.cases);
  run.status = run.aggregate.thresholds.length
    ? run.aggregate.thresholds.every((t) => t.pass)
      ? "passed"
      : "failed"
    : "measured";
  const hash = await harnessHash([fileURLToPath(new URL(".", import.meta.url)), spec.folder]);
  run.rescored = {
    from: basename(input),
    at: new Date().toISOString(),
    originalHarnessHash: run.identity.harnessHash,
  };
  run.identity.harnessHash = hash;
  run.compatibility.harnessHash = hash;
  const output = resolve(values.output ?? join(folder, "run-rescored.json"));
  await refuseExisting(output);
  await writeFile(output, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  await writeFile(reportPathFor(output), renderReport(agentReportModel(run, spec, output)), { flag: "wx" });
  process.stderr.write(`${relative(software, output)}: ${run.status}\n`);
  return run.status === "failed" ? 1 : 0;
}

/** Entry point of an agent family: `run` or `report`. Exit 0 passed or measured, 1 failed, 2 invalid. */
export async function familyMain(spec, argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "provider",
        "model",
        "base-url",
        "reasoning",
        "key-env",
        "repeats",
        "cases",
        "label",
        "output",
        "timeout",
        "approve",
        "cli",
        "scratch",
        "input",
        "reference",
        "inputs",
        "web",
      ].map((key) => [key, { type: "string" }]),
    ),
  });
  const command = positionals[0];
  const extra = spec.commands ?? {};
  if (positionals.length !== 1 || !["run", "report", "rescore", ...Object.keys(extra)].includes(command))
    throw Error(USAGE(spec.family));
  if (Object.hasOwn(extra, command)) return extra[command](values);
  if (command === "rescore") return rescore(spec, values);
  if (command === "report") {
    if (!values.input) throw Error("--input is required");
    const target = await writeReport(
      {
        input: resolve(values.input),
        reference: values.reference && resolve(values.reference),
        output: values.output,
      },
      (run, path) => agentReportModel(run, spec, path),
    );
    process.stderr.write(`${relative(software, target)}\n`);
    return 0;
  }
  const env = process.env;
  const baseUrl = values["base-url"] ?? env.VERA_EVAL_BASE_URL;
  const options = {
    provider: values.provider ?? env.VERA_EVAL_PROVIDER ?? (baseUrl ? "custom" : undefined),
    model: values.model ?? env.VERA_EVAL_MODEL,
    baseUrl,
    reasoning: values.reasoning ?? env.VERA_EVAL_REASONING,
    keyEnv: values["key-env"] ?? env.VERA_EVAL_KEY_ENV,
    repeats: Number(values.repeats ?? 3),
    caseIds: values.cases?.split(",").filter(Boolean),
    label: values.label,
    output: values.output,
    timeoutSeconds: values.timeout === undefined ? undefined : Number(values.timeout),
    approve: values.approve ?? "none",
    web: values.web ?? "off",
    cli: values.cli,
    scratch: values.scratch,
  };
  if (!options.provider) throw Error(`--provider or --base-url is required\n\n${USAGE(spec.family)}`);
  if (options.reasoning && !["off", "low", "medium", "high", "xhigh", "on"].includes(options.reasoning))
    throw Error("--reasoning must be off, low, medium, high, xhigh or on");
  if (options.timeoutSeconds !== undefined && !(options.timeoutSeconds >= 10))
    throw Error("--timeout must be ≥ 10 s");
  const { run } = await runAgentFamily(spec, spec.runOptions ? await spec.runOptions(options) : options);
  return run.status === "failed" ? 1 : 0;
}

/** Runs `main` when the module is the process entry point, with the shared exit codes. */
export async function runAsScript(main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : error}\n`);
    process.exitCode = 2;
  }
}
