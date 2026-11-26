import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const software = fileURLToPath(new URL("../../", import.meta.url));
const [provider, model] = process.argv.slice(2);
if (!["local", "hosted"].includes(provider) || process.argv.length > 4) {
  throw Error("Usage: npm run eval:analysis-skills -- <local|hosted> [model]");
}
const parent = join(software, "evaluation-outputs", "analysis-skills");
await mkdir(parent, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const output = await mkdtemp(join(parent, `${stamp}-${provider}-`));
await mkdir(join(output, "electron"));
const host = join(output, "host.mjs");
await build({
  absWorkingDir: software,
  entryPoints: ["evaluators/analysis-skills/host.mts"],
  outfile: host,
  bundle: true,
  packages: "external",
  alias: {
    "@vera/core": "./src/libraries/core/src/index.ts",
    "@vera/shared": "./src/libraries/shared/src/index.ts",
  },
  platform: "node",
  format: "esm",
});
console.log(`Evidence: ${join(output, "run.json")}`);
const child = spawn(require("electron"), [host], {
  cwd: software,
  env: {
    ...process.env,
    VERA_ANALYSIS_OUTPUT: output,
    VERA_ANALYSIS_PROVIDER: provider,
    ...(model ? { VERA_ANALYSIS_MODEL: model } : {}),
  },
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});
process.exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code) => resolve(code ?? 1));
});
