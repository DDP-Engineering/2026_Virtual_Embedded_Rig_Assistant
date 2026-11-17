import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

// Workspaces contain local unit/component tests; root projects group cross-cutting verification.
export default defineConfig({
  test: {
    maxWorkers: Math.min(4, availableParallelism()),
    projects: [
      "src/libraries/*",
      "src/apps/*",
      "src/libraries/core/vitest.resources.config.ts",
      // `plugins` holds one suite per official plugin; npm test leaves it out (npm run test:plugins).
      ...["tooling", "integration", "packaging", "plugins"].map((name, index) => ({
        test: {
          name,
          // Finish workspace tests first; shared build writers never overlap across projects.
          sequence: { groupOrder: index + 2 },
          fileParallelism: false,
          ...(name === "integration" ? { globalSetup: ["tests/support/cli-bundle-setup.ts"] } : {}),
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
