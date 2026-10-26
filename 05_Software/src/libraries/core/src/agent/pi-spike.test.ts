import { existsSync } from "node:fs";
import { beforeAll, expect } from "vitest";
import type * as Pi from "./pi-spike.test-support.js";
import { runtimeMatrix } from "./runtime-matrix.test-support.js";

let PiSpikeRuntime: typeof Pi.PiSpikeRuntime;
beforeAll(async () => {
  expect(
    existsSync(new URL("./pi-spike.test-support.ts", import.meta.url)),
    "measured pi Agent adapter exists",
  ).toBe(true);
  ({ PiSpikeRuntime } = await import("./pi-spike.test-support.js"));
});
runtimeMatrix("pi-agent-core1.1.0 measured", (host) => new PiSpikeRuntime(host), false);
