import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: {
    index: "apps/cli/src/index.ts",
    "grep-worker": "apps/cli/src/grep-worker.ts",
    "pdf-worker": "apps/cli/src/pdf-worker.ts",
    "embedding-worker": "apps/cli/src/embedding-worker.ts",
  },
  outdir: "apps/cli/dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  alias: {
    "@vera/core": "./packages/core/src/index.ts",
    "@vera/core/replay": "./packages/core/src/llm/replay.ts",
    "@vera/core/grep-worker": "./packages/core/src/tools/grep-worker.ts",
    "@vera/core/pdf-worker": "./packages/core/src/knowledge/pdf-worker.ts",
    "@vera/core/embedding-worker": "./packages/core/src/knowledge/embedding-worker.ts",
    "@vera/shared": "./packages/shared/src/index.ts",
  },
});
