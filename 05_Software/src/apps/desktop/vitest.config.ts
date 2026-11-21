import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@vera/shared": fileURLToPath(new URL("../../libraries/shared/src/index.ts", import.meta.url)),
      // Before "@vera/core", which would otherwise claim the subpath: the replay gateway of instrumented builds.
      "@vera/core/replay": fileURLToPath(new URL("../../libraries/core/src/llm/replay.ts", import.meta.url)),
      "@vera/core": fileURLToPath(new URL("../../libraries/core/src/index.ts", import.meta.url)),
    },
  },
  define: {
    __VERA_VERSION__: JSON.stringify("0.0.0"),
    __VERA_THIRD_PARTY__: JSON.stringify([]),
    __VERA_LICENSE__: JSON.stringify(""),
    __VERA_RELEASE_NOTES__: JSON.stringify([]),
  },
  test: {
    setupFiles: [fileURLToPath(new URL("../../../tests/support/network-setup.ts", import.meta.url))],
    name: "desktop",
    environment: "node",
    include: ["src/main/**/*.test.ts", "src/preload/**/*.test.ts", "src/renderer/**/*.test.ts"],
  },
});
