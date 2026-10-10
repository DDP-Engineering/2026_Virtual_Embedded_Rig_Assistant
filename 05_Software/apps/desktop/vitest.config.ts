import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@vera/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)) },
  },
  define: { __VERA_VERSION__: JSON.stringify("0.0.0") },
  test: {
    name: "desktop",
    environment: "node",
    include: ["src/main/**/*.test.ts", "src/preload/**/*.test.ts", "src/renderer/**/*.test.ts"],
  },
});
