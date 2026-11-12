import { importSoftware, software } from "../environment/software.mjs";

const { build } = await importSoftware("esbuild");
const root = software;
await build({
  absWorkingDir: root,
  entryPoints: {
    index: "src/apps/cli/src/index.ts",
    "grep-worker": "src/apps/cli/src/grep-worker.ts",
    "pdf-worker": "src/apps/cli/src/pdf-worker.ts",
    "embedding-worker": "src/apps/cli/src/embedding-worker.ts",
  },
  outdir: "src/apps/cli/dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  alias: {
    "@vera/core": "./src/libraries/core/src/index.ts",
    "@vera/core/replay": "./src/libraries/core/src/llm/replay.ts",
    "@vera/core/grep-worker": "./src/libraries/core/src/tools/grep-worker.ts",
    "@vera/core/pdf-worker": "./src/libraries/core/src/knowledge/pdf-worker.ts",
    "@vera/core/embedding-worker": "./src/libraries/core/src/knowledge/embedding-worker.ts",
    "@vera/shared": "./src/libraries/shared/src/index.ts",
  },
});
