import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importSoftware, software } from "./software.mjs";

const { build } = await importSoftware("esbuild");
const root = software;

/** Each zip of a bundled catalog release has the size and SHA-256 its index lists; returns the index. */
export async function checkBundledPlugins(folder) {
  const index = JSON.parse(await readFile(join(folder, "index.json"), "utf8"));
  for (const entry of index.plugins) {
    const bytes = await readFile(join(folder, entry.url));
    if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw new Error(`bundled plugin integrity: ${entry.url}`);
  }
  return index;
}

/**
 * A private build of the CLI in node_modules/.cache (external packages resolve from the workspace), so the
 * shared `src/apps/cli/dist` that `npm run vera` and other suites run is never rewritten underneath them.
 */
async function buildCli() {
  await mkdir(join(root, "node_modules/.cache"), { recursive: true });
  const outdir = await mkdtemp(join(root, "node_modules/.cache/vera-prepare-plugins-"));
  await build({
    absWorkingDir: root,
    entryPoints: { index: "src/apps/cli/src/index.ts" },
    outdir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    packages: "external",
    logLevel: "error",
    alias: {
      "@vera/core": "./src/libraries/core/src/index.ts",
      "@vera/core/replay": "./src/libraries/core/src/llm/replay.ts",
      "@vera/core/grep-worker": "./src/libraries/core/src/tools/grep-worker.ts",
      "@vera/core/pdf-worker": "./src/libraries/core/src/knowledge/pdf-worker.ts",
      "@vera/core/embedding-worker": "./src/libraries/core/src/knowledge/embedding-worker.ts",
      "@vera/shared": "./src/libraries/shared/src/index.ts",
    },
  });
  return outdir;
}

/**
 * Builds the official plugins (`plugins/`, a catalog source) into a catalog release with
 * `vera catalog build`: `src/bundled-plugins/` by default, which development runs read and packaging
 * ships as `<resources>/plugins/`. The folder is replaced as a whole.
 */
export async function prepareBundledPlugins({
  source = join(root, "plugins"),
  target = join(root, "src/bundled-plugins"),
} = {}) {
  const cli = await buildCli();
  const staging = `${target}.staging`;
  try {
    await rm(staging, { recursive: true, force: true });
    const result = spawnSync(
      process.execPath,
      [join(cli, "index.js"), "catalog", "build", "--source", source, "--out", staging],
      { cwd: root, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`vera catalog build failed:\n${result.stdout}${result.stderr}`);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(cli, { recursive: true, force: true });
  }
  return checkBundledPlugins(target);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = await prepareBundledPlugins();
  console.log(`Bundled ${index.plugins.length} official plugins: ${join(root, "src/bundled-plugins")}`);
}
