import { defineConfig } from "vitest/config";

// Workspace packages (packages/*, apps/*) become Vitest projects as WP-01 creates them;
// "tooling" tests the repository's own checks, such as the import boundaries in biome.json.
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      { test: { name: "tooling", include: ["tests/tooling/**/*.test.ts"], environment: "node" } },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
