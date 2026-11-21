import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { writeReport } from "../shared/family-cli.mjs";
import { gitState, harnessHash, reportPathFor } from "../shared/identity.mjs";
import { renderReport } from "../shared/report-html.mjs";
import { runLayout, toLayoutReportModel } from "./layout.mjs";
import { toReportModel } from "./report-model.mjs";

const software = fileURLToPath(new URL("../../", import.meta.url));
const folder = fileURLToPath(new URL(".", import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(
    ["scratch", "output", "input", "reference", "model", "cli"].map((key) => [key, { type: "string" }]),
  ),
});
const command = positionals[0] ?? "run";
if (positionals.length > 1 || !["run", "report", "layout"].includes(command)) {
  process.stderr.write(
    "usage: eval:retrieval [run] [--model <embedding model id>] [--output <run.json>] [--scratch <parent>]\n" +
      "       eval:retrieval report --input <run.json> [--reference <run.json>] [--output <report.html>]\n",
  );
  process.exit(2);
}
if (command === "report") {
  if (!values.input) throw Error("--input is required");
  const target = await writeReport(
    {
      input: resolve(values.input),
      reference: values.reference && resolve(values.reference),
      output: values.output,
    },
    (data, path) =>
      data.kind === "vera-retrieval-layout" ? toLayoutReportModel(data, path) : toReportModel(data, path),
  );
  process.stdout.write(`${target}\n`);
  process.exit(0);
}
if (command === "layout") process.exit(await runLayout(values));
const startedAt = new Date().toISOString();
const parent = resolve(values.scratch ?? join(software, "node_modules/.cache/evaluators/retrieval"));
await mkdir(parent, { recursive: true });
const scratch = await mkdtemp(join(parent, "eval-"));
try {
  // Inside 05_Software the bundle finds node_modules by walking up; a link there would point at its
  // own ancestor. Only a --scratch outside 05_Software needs one.
  const inside = relative(software, scratch);
  if (inside.startsWith("..") || isAbsolute(inside))
    await symlink(
      join(software, "node_modules"),
      join(scratch, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
  await build({
    entryPoints: {
      runtime: join(software, "evaluators/retrieval/product-eval.mjs"),
      "pdf-worker": join(software, "src/libraries/core/src/knowledge/pdf-worker.ts"),
      "embedding-worker": join(software, "src/libraries/core/src/knowledge/embedding-worker.ts"),
    },
    outdir: scratch,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    target: "node24",
    outExtension: { ".js": ".mjs" },
    alias: {
      "@vera/core": join(software, "src/libraries/core/src/index.ts"),
      "@vera/shared": join(software, "src/libraries/shared/src/index.ts"),
    },
  });
  const { evaluate } = await import(pathToFileURL(join(scratch, "runtime.mjs")).href);
  const result = await evaluate(software, scratch, values.model);
  result.fixtureSha256 = createHash("sha256")
    .update(await readFile(join(software, "evaluators/retrieval/cases/demo-board.yaml")))
    .digest("hex");
  result.identity = { harnessHash: await harnessHash([folder]), ...gitState(), startedAt };
  if (values.output) {
    // A run gets its own folder under evaluation-outputs/retrieval/; the harness creates it.
    const output = resolve(values.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    await writeFile(reportPathFor(output), renderReport(toReportModel(result, output)), { flag: "wx" });
  }
  process.stdout.write(
    `${JSON.stringify({ pass: result.pass, modelId: result.modelId, metrics: Object.fromEntries(Object.entries(result.metrics).map(([mode, m]) => [mode, { overall: m.overall, en: m.en, ro: m.ro }])) })}\n`,
  );
  if (!result.pass) process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
