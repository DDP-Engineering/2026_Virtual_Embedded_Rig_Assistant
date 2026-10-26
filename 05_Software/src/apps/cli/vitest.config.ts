import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@vera/core": fileURLToPath(new URL("../../libraries/core/src/index.ts", import.meta.url)),
      "@vera/shared": fileURLToPath(new URL("../../libraries/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    name: "cli",
    environment: "node",
    setupFiles: ["../../../tests/network-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
