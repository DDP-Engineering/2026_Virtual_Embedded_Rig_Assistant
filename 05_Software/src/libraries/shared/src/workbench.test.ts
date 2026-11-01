import { expect, it } from "vitest";
import {
  mergeWorkbench,
  workbenchSchema as schema,
  configWarnings as warnings,
  workbenchPatchSchema,
} from "./workbench.js";

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

// REQ-DATA-4992f40c
it("holds bounded retrieval defaults that patches merge and validation rejects out of range", () => {
  const base = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  expect(base.retrieval).toEqual({ results: 8, mode: "hybrid" });
  const merged = mergeWorkbench(base, { retrieval: { results: 12, mode: "keyword" } });
  expect(merged.retrieval).toEqual({ results: 12, mode: "keyword" });
  for (const retrieval of [
    { results: 0, mode: "hybrid" },
    { results: 21, mode: "hybrid" },
    { results: 8, mode: "fuzzy" },
  ])
    expect(workbenchPatchSchema.safeParse({ retrieval }).success).toBe(false);
  expect(schema.safeParse({ ...base, retrieval: { results: 1.5, mode: "hybrid" } }).success).toBe(false);
  const extended = schema.parse({ ...base, retrieval: { results: 4, mode: "semantic", rerank: true } });
  expect(warnings(extended)).toContainEqual({ code: "UNKNOWN_KEY", path: "retrieval.rerank" });
});
