import { builtinToolNames } from "@vera/shared";
import { expect, it } from "vitest";
import { z } from "zod";
import * as api from "../index.js";

it("converts every tool schema and validates samples while filtering disabled names", () => {
  expect(api.ToolRegistry).toBeTypeOf("function");
  const registry = new api.ToolRegistry();
  expect(registry.available().map((tool) => tool.name)).toEqual(builtinToolNames);
  const samples = {
    read: { path: "docs/a.txt" },
    list: {},
    glob: { pattern: "**/*.md" },
    grep: { pattern: "hello" },
    parse_log: { path: "logs/boot-0412.log", profile: "iso" },
    decode_register: { definitionPath: "registers.json", register: "CR1", value: "0x81" },
    write: { path: "notes.txt", content: "hello" },
    edit: { path: "notes.txt", oldString: "hello", newString: "world" },
    artifact_save: { name: "summary.md", content: "hello" },
    todo: { items: [{ text: "Verify", status: "pending" }] },
    search_docs: { query: "I2C1_CR1" },
    read_doc: { path: "docs/a.pdf", page: 1 },
    load_skill: { name: "reader" },
    web_search: { query: "general topic" },
    web_read: { url: "https://example.com/" },
    web_download: { url: "https://example.com/chip.pdf" },
    parts_search: { query: "N-channel MOSFET" },
    run_program: { program: "esptool", args: ["version"] },
    program_output: { handle: "01JB8Z6Q4M7N2K5R9T3V8X1Y0C", until: "READY", waitMs: 1000 },
    plugin_validate: { path: "plugins/fixture" },
    plugin_install: { path: "plugins/fixture" },
    program_stop: { handle: "01JB8Z6Q4M7N2K5R9T3V8X1Y0C" },
    apply_candidate: { run: "electronics-results/r1" },
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
    "parse_log",
    "decode_register",
    "write",
    "edit",
    "artifact_save",
    "todo",
    "search_docs",
    "read_doc",
    "load_skill",
    "web_search",
    "web_read",
    "web_download",
    "parts_search",
    "run_program",
    "program_output",
    "program_stop",
    "plugin_validate",
    "plugin_install",
    "apply_candidate",
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

it("exposes parse_log as a read tool and excludes it when disabled", () => {
  const registry = new api.ToolRegistry();
  expect(registry.available().find((tool) => tool.name === "parse_log")?.class).toBe("read");
  expect(registry.specs(["parse_log"]).map((tool) => tool.name)).not.toContain("parse_log");
});
