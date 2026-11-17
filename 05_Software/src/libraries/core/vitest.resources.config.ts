import { defineConfig } from "vitest/config";
import core, { resourceTests } from "./vitest.config.js";

export default defineConfig({
  ...core,
  test: {
    ...core.test,
    name: "core-resources",
    include: resourceTests,
    exclude: [],
    fileParallelism: false,
    sequence: { groupOrder: 1 },
  },
});
