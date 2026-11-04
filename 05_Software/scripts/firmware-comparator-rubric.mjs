import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const software = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [mode, outputArg, profileArg, selectedModel, selectedCases] = process.argv.slice(2);
if (!["--prepare", "--run"].includes(mode) || !outputArg || !isAbsolute(outputArg))
  throw Error(
    "Usage: node scripts/firmware-comparator-rubric.mjs --prepare ABS_OUTPUT | --run ABS_OUTPUT ABS_EXISTING_VERA_PROFILE [EXPLICIT_MODEL_REFERENCE]",
  );
const output = resolve(outputArg);
console.log(`CAP03 rubric ${mode}: building isolated host`);
const bundle = join(software, "node_modules/.cache/cap03-rubric");
await mkdir(bundle, { recursive: true });
const alias = {
  "@vera/core": join(software, "src/libraries/core/src/index.ts"),
  "@vera/shared": join(software, "src/libraries/shared/src/index.ts"),
  "@vera/core/replay": join(software, "src/libraries/core/src/llm/replay.ts"),
  "@vera/core/grep-worker": join(software, "src/libraries/core/src/tools/grep-worker.ts"),
};
await build({
  entryPoints: {
    harness: join(software, "tests/fixtures/firmware-comparator/harness.ts"),
    "grep-worker": join(software, "src/apps/cli/src/grep-worker.ts"),
    live: join(software, "tests/fixtures/firmware-comparator/live.ts"),
  },
  outdir: bundle,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  packages: "external",
  alias,
});
console.log("CAP03 host build ready");
if (mode === "--prepare") {
  // Refuse existing output; preserve original receipts and snapshots across attempts.
  await mkdir(output);
  const { cases, prepareCase, sha256 } = await import(pathToFileURL(join(bundle, "harness.js")).href);
  const worksheet = [];
  for (const item of cases) {
    const folder = join(output, item.id);
    const root = await prepareCase(software, folder, item.id);
    await writeFile(join(folder, "prompt.txt"), item.prompt, { flag: "wx" });
    const inputs = {};
    for (const path of [
      "logs/boot-0412.log",
      "logs/boot-0413.log",
      "docs/runs.md",
      "docs/boot-test.md",
      "docs/release-notes.md",
    ])
      inputs[path] = sha256(await readFile(join(root, path)));
    await writeFile(join(folder, "inputs.json"), JSON.stringify(inputs, null, 2), { flag: "wx" });
    worksheet.push({
      case: item.id,
      model: null,
      version: null,
      prompt: `${item.id}/prompt.txt`,
      artifact: null,
      criteria: item.criteria.map((criterion) => ({ criterion, verdict: "pending", evidence: null })),
    });
  }
  await writeFile(join(output, "rubric.json"), JSON.stringify(worksheet, null, 2), { flag: "wx" });
  await writeFile(
    join(output, "prepared.json"),
    JSON.stringify(
      {
        software,
        bundle,
        preparedUTC: new Date().toISOString(),
        platform: process.platform,
        node: process.version,
        egress:
          "Offline preparation. Live permits only HTTPS api.openai.com/v1/models, /v1/responses and auth.openai.com/api/accounts/oauth/token; no web tools/program host. Credentials stay in normal Electron host memory; only its normal refresh may persist in original profile. Settings are never changed.",
        faultCases: {
          "incomplete-scan":
            "Fixture-host partial scan result; first two lines only, no source SHA, timeout. Not a model simulation.",
          "log-changed-between-calls":
            "Actual first parse of264-line capture (exceeds200-event maximum), then deterministic on-disk append; actual subsequent expectedSha256 check must CONFLICT.",
        },
        limits:
          "100 tool calls/turn,90s no output,10min/case; no automatic reruns; all model output retained before manual rubric verdicts.",
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(`Prepared all seven cases and verdict worksheet: ${output}`);
} else {
  if (!profileArg || !isAbsolute(profileArg))
    throw Error("An explicit existing VERA profile is required; no key/account setup.");
  await readFile(join(output, "prepared.json"));
  await cp(bundle, join(output, "executed-bundle"), { recursive: true, force: false, errorOnExist: true });
  const electron = (await import("electron")).default;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OPENAI_API_KEY;
  const child = spawn(
    electron,
    [
      join(bundle, "live.js"),
      `--cap03-output=${output}`,
      `--cap03-profile=${resolve(profileArg)}`,
      `--cap03-worker=${pathToFileURL(join(bundle, "grep-worker.js")).href}`,
      ...(selectedModel ? [`--cap03-model=${selectedModel}`] : []),
      ...(selectedCases ? [`--cap03-cases=${selectedCases}`] : []),
    ],
    { cwd: software, env, stdio: "inherit", windowsHide: true },
  );
  console.log(`CAP03 credential host started: pid ${child.pid ?? "unavailable"}`);
  process.exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", (code) => done(code ?? 1));
  });
}
