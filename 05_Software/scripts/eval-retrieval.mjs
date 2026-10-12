import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const software = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { scratch: { type: "string" }, output: { type: "string" } } });
const parent = resolve(values.scratch ?? join(software, "node_modules/.cache/retrieval-eval"));
await mkdir(parent, { recursive: true });
const scratch = await mkdtemp(join(parent, "eval-"));
try {
  await symlink(
    join(software, "node_modules"),
    join(scratch, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await build({
    entryPoints: {
      runtime: join(software, "scripts/retrieval/product-eval.mjs"),
      "pdf-worker": join(software, "packages/core/src/knowledge/pdf-worker.ts"),
      "embedding-worker": join(software, "packages/core/src/knowledge/embedding-worker.ts"),
    },
    outdir: scratch,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    target: "node24",
    outExtension: { ".js": ".mjs" },
    alias: {
      "@vera/core": join(software, "packages/core/src/index.ts"),
      "@vera/shared": join(software, "packages/shared/src/index.ts"),
    },
  });
  const { evaluate } = await import(pathToFileURL(join(scratch, "runtime.mjs")).href);
  const result = await evaluate(software, scratch);
  result.fixtureSha256 = createHash("sha256")
    .update(await readFile(join(software, "fixtures/retrieval/demo-board.yaml")))
    .digest("hex");
  if (values.output)
    await writeFile(resolve(values.output), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ pass: result.pass, modelId: result.modelId, metrics: Object.fromEntries(Object.entries(result.metrics).map(([mode, m]) => [mode, { overall: m.overall, en: m.en, ro: m.ro }])) })}\n`,
  );
  if (!result.pass) process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
