import { expect, it } from "vitest";
import { workbenchSchema as schema, configWarnings as warnings } from "./workbench.js";

it("validates format1, defaults and retains nested extensions with warning paths", () => {
  const config = schema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Board",
    vendor: { enabled: true },
    agent: { extension: 42 },
  });
  expect(config.docs).toEqual({ include: ["docs/**"], exclude: [] });
  expect(config.agent).toEqual({ permission_mode: "ask", model: null, extension: 42 });
  expect(config.vendor).toEqual({ enabled: true });
  expect(warnings(config)).toEqual([
    { code: "UNKNOWN_KEY", path: "vendor" },
    { code: "UNKNOWN_KEY", path: "agent.extension" },
  ]);
  for (const patch of [{ format: 2 }, { name: "" }, { id: "wb_bad" }, { agent: { permission_mode: "bad" } }])
    expect(schema.safeParse({ ...config, ...patch }).success).toBe(false);
});
