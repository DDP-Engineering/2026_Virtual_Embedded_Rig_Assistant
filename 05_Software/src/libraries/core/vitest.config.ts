import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Native startup deadlines and high-volume filesystem fixtures must not compete with other workers.
export const resourceTests = [
  "src/knowledge/processor.test.ts",
  "src/tools/parse-log.test.ts",
  "src/workers/node-host.test.ts",
  "src/knowledge/ingest-guard.test.ts",
  "src/knowledge/search.test.ts",
  "src/plugins/catalog-source.test.ts",
  "src/sessions/artifacts.test.ts",
  "src/tools/input-bypass.test.ts",
];

export default defineConfig({
  resolve: { alias: { "@vera/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) } },
  test: {
    setupFiles: [fileURLToPath(new URL("../../../tests/support/network-setup.ts", import.meta.url))],
    name: "core",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: resourceTests,
  },
});
