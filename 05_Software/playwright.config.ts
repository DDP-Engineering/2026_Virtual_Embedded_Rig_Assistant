import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Workers inherit the same owned temporary directory from the runner.
const outputDir = process.env.VERA_E2E_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), "vera-e2e-output-"));
process.env.VERA_E2E_OUTPUT_DIR = outputDir;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir,
  preserveOutput: "never",
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["./tests/support/cleanup-e2e-output.mjs", { outputDir }]],
  use: { trace: "off", screenshot: "off", video: "off" },
});
