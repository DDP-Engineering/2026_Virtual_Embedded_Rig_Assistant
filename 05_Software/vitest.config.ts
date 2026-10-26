import { defineConfig } from "vitest/config";

// Workspaces contain local unit/component tests; root projects group cross-cutting verification.
export default defineConfig({
  test: {
    projects: [
      "src/libraries/*",
      "src/apps/*",
      ...["tooling", "integration", "packaging"].map((name) => ({
        test: {
          name,
          setupFiles: ["tests/network-setup.ts"],
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
