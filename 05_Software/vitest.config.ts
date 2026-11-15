import { defineConfig } from "vitest/config";

// Workspaces contain local unit/component tests; root projects group cross-cutting verification.
export default defineConfig({
  test: {
    // Native CLI/build fixtures share output paths; serialize files to preserve their ownership.
    maxWorkers: 1,
    projects: [
      "src/libraries/*",
      "src/apps/*",
      // `plugins` holds one suite per official plugin; npm test leaves it out (npm run test:plugins).
      ...["tooling", "integration", "packaging", "plugins"].map((name) => ({
        test: {
          name,
          setupFiles: ["tests/support/network-setup.ts"],
          include: [`tests/${name}/**/*.test.ts`],
          environment: "node",
        },
      })),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
