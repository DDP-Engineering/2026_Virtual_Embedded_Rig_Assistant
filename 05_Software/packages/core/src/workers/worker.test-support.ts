import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

export function workerFixture() {
  const folder = mkdtempSync(join(tmpdir(), "vera-worker-bundle-"));
  const output = join(folder, "grep-worker.mjs");
  buildSync({
    entryPoints: [fileURLToPath(new URL("../tools/grep-worker.ts", import.meta.url))],
    alias: { "@vera/shared": fileURLToPath(new URL("../../../shared/src/index.ts", import.meta.url)) },
    outfile: output,
    platform: "node",
    format: "esm",
    bundle: true,
    target: "node24",
  });
  return { url: pathToFileURL(output), close: () => rmSync(folder, { recursive: true, force: true }) };
}
