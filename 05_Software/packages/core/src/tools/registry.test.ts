import { expect, it } from "vitest";
import { z } from "zod";
import * as api from "../index.js";

it("converts every tool schema and validates samples while filtering disabled names", () => {
  expect(api.ToolRegistry).toBeTypeOf("function");
  const registry = new api.ToolRegistry();
  const samples = {
    read: { path: "docs/a.txt" },
    list: {},
    glob: { pattern: "**/*.md" },
    grep: { pattern: "hello" },
    write: { path: "notes.txt", content: "hello" },
    edit: { path: "notes.txt", oldString: "hello", newString: "world" },
    artifact_save: { name: "summary.md", content: "hello" },
    todo: { items: [{ text: "Verify", status: "pending" }] },
    search_docs: { query: "I2C1_CR1" },
    read_doc: { path: "docs/a.pdf", page: 1 },
    load_skill: { name: "reader" },
  };
  for (const tool of registry.available()) {
    const sample = samples[tool.name as keyof typeof samples];
    expect(tool.params.safeParse(sample).success).toBe(true);
    expect(JSON.parse(JSON.stringify(z.toJSONSchema(tool.params)))).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  }
  expect(registry.specs(["read"]).map((tool) => tool.name)).toEqual([
    "list",
    "glob",
    "grep",
    "write",
    "edit",
    "artifact_save",
    "todo",
    "search_docs",
    "read_doc",
    "load_skill",
  ]);
  expect(registry.available(["read"]).map((tool) => tool.name)).not.toContain("read");
});
it("validates calls, returns actionable errors and preserves the runtime error outcome", async () => {
  expect(api.ToolRegistry).toBeTypeOf("function");
  const registry = new api.ToolRegistry();
  const ctx = api.createToolContext("unused");
  const signal = new AbortController().signal;
  expect(await registry.execute(ctx, "read", { path: "x" }, signal, ["read"])).toMatchObject({
    isError: true,
  });
  expect(await registry.execute(ctx, "missing", {}, signal)).toMatchObject({ isError: true });
  expect(await registry.execute(ctx, "read", { path: "x", limit: 2001 }, signal)).toMatchObject({
    isError: true,
    text: expect.stringMatching(/Invalid arguments/),
  });
  const broken = new api.ToolRegistry([
    {
      name: "broken",
      class: "read",
      description: "test",
      params: z.strictObject({}),
      execute: async () => {
        throw Error("Choose another file.");
      },
    },
  ]);
  expect(await broken.execute(ctx, "broken", {}, signal)).toMatchObject({
    isError: true,
    text: expect.stringMatching(/Choose another file/),
  });
  await expect(broken.bind(ctx)[0]?.execute({}, signal)).rejects.toThrow(/Choose another file/);
});
it("caps nested text and arrays to valid JSON within32000 characters with truncation", () => {
  expect(api.capToolResult).toBeTypeOf("function");
  for (const value of [
    { text: '"\\\n'.repeat(100000), ref: "docs/x#L1-L1" },
    { rows: Array.from({ length: 2000 }, (_, i) => ({ text: "data".repeat(50), i })) },
    { nested: { huge: "a".repeat(100000) } },
  ]) {
    const result = api.capToolResult(value);
    expect(result.text.length).toBeLessThanOrEqual(32000);
    expect(JSON.parse(result.text).truncated).toBe(true);
    expect(result.truncated).toBe(true);
  }
  expect(api.capToolResult({ x: 1 })).toMatchObject({ text: '{"x":1}', truncated: false });
});
it("contains serialization failures and honors explicit tool error results", async () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const ctx = api.createToolContext("unused");
  for (const result of [cycle, { value: 1n }, { isError: true, error: "Read a file first." }]) {
    const registry = new api.ToolRegistry([
      {
        name: "test",
        class: "read",
        description: "test",
        params: z.strictObject({}),
        execute: async () => result,
      },
    ]);
    expect(await registry.execute(ctx, "test", {}, new AbortController().signal)).toMatchObject({
      isError: true,
    });
  }
});
