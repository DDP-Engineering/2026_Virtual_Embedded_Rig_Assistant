import { existsSync } from "node:fs";
import { beforeAll, expect } from "vitest";
import type * as Runtime from "./runtime.js";
import { runtimeMatrix } from "./runtime-matrix.test-support.js";

let ReferenceRuntime: typeof Runtime.ReferenceRuntime;
beforeAll(async () => {
  expect(existsSync(new URL("./runtime.ts", import.meta.url)), "reference AgentRuntime exists").toBe(true);
  ({ ReferenceRuntime } = await import("./runtime.js"));
});
runtimeMatrix("reference loop", (host) => new ReferenceRuntime(host));
