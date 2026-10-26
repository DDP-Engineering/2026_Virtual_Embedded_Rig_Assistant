import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@vera/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) } },
  test: {
    setupFiles: [fileURLToPath(new URL("../../../tests/network-setup.ts", import.meta.url))],
    name: "core",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
