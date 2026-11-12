import { spawnSync } from "node:child_process";
// REQ-TEST-df5ff0ba REQ-TEST-c0e68f23 REQ-TEST-7cc7bf91
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { calibrate, compare, saveReport } from "./eval-performance-harness/report.mjs";

export async function main(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "mode",
        "output",
        "cases",
        "scenarios",
        "reference",
        "report",
        "runs",
        "budgets",
        "timeout",
        "inject-stall-ms",
      ].map((key) => [key, { type: "string" }]),
    ),
  });
  const json = async (path) => JSON.parse(await readFile(path, "utf8"));
  if (positionals.length !== 1 || !["run", "calibrate", "compare"].includes(positionals[0]))
    throw Error("usage: perf:sessions run|calibrate|compare --output <new file> [options]");
  const command = positionals[0];
  if (!values.output) throw Error("--output is required");
  for (const path of [values.output, `${values.output}.md`]) {
    try {
      await access(path);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    throw Error("output already exists");
  }
  if (command === "run") {
    // Read reference before spending time on a build; comparison still validates its full provenance.
    const reference = values.reference ? await json(values.reference) : undefined;
    const { run } = await import("./eval-performance-harness/runner.mjs");
    const report = await run(values);
    let exit = report.status === "failed" ? 1 : 0;
    if (reference && !exit) {
      try {
        report.comparison = compare(report, reference);
        exit = report.comparison.status === "failed" ? 1 : 0;
      } catch {
        report.comparison = { status: "invalid-evidence" };
        exit = 2;
      }
    }
    await saveReport(values.output, report);
    console.log(
      `${values.output}: ${report.comparison?.status ?? report.status} (${report.samples.length} samples)`,
    );
    return exit;
  }
  if (command === "calibrate") {
    if (!values.runs || !values.budgets) throw Error("--runs and --budgets are required");
    const paths = values.runs.split(",");
    if (new Set(paths.map((p) => resolve(p))).size !== paths.length)
      throw Error("distinct reference runs required");
    const reference = calibrate(await Promise.all(paths.map(json)), await json(values.budgets));
    await saveReport(values.output, reference);
    console.log(
      `${values.output}: reference recorded; ${reference.existingBudgetFailures.length} existing budget failures`,
    );
    return reference.existingBudgetFailures.length ? 1 : 0;
  }
  if (!values.report || !values.reference) throw Error("--report and --reference are required");
  const result = compare(await json(values.report), await json(values.reference));
  await saveReport(values.output, { kind: "session-performance-comparison", format: 1, ...result });
  console.log(`${values.output}: ${result.status}`);
  return result.status === "passed" ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform === "linux" && !process.env.DISPLAY) {
      const child = spawnSync(
        "xvfb-run",
        ["-a", process.execPath, process.argv[1], ...process.argv.slice(2)],
        { stdio: "inherit" },
      );
      if (child.error) throw child.error;
      process.exitCode = child.status ?? 2;
    } else process.exitCode = await main(process.argv.slice(2));
  } catch {
    console.error(
      "Invalid performance arguments/evidence or preparation failure; no passing comparison produced.",
    );
    process.exitCode = 2;
  }
}
