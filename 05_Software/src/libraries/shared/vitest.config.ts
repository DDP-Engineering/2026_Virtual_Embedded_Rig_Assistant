import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@vera/shared",
    setupFiles: ["../../../tests/network-setup.ts"],
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
