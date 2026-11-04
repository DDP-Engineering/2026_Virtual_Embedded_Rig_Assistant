import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeRegisterResultSchema } from "@vera/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";
import { createToolContext, ToolRegistry } from "../index.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
vi.mock("yaml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("yaml")>();
  return { ...actual, parseDocument: vi.fn(actual.parseDocument) };
});

let root: string;
const registry = new ToolRegistry();
const args = { definitionPath: "registers.json", register: "I2C1_CR1", value: "0x81" };
const definition = () => ({
  schemaVersion: 1,
  device: { id: "VERA-DEMO-01", revision: "A" },
  sourceRefs: ["sources/reference-manual.md#L7-L7"],
  registers: [
    {
      name: "I2C1_CR1",
      widthBits: 32,
      fields: [
        { name: "ERRIE", lsb: 7, width: 1 },
        { name: "PE", lsb: 0, width: 1 },
        { name: "TXIE", lsb: 1, width: 1 },
        { name: "RXIE", lsb: 2, width: 1 },
      ],
    },
  ],
});
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "vera-decode-"));
});
afterEach(async () => {
  vi.mocked(fs.open).mockImplementation(
    (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open,
  );
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function save(value: unknown = definition()) {
  await fs.writeFile(join(root, args.definitionPath), JSON.stringify(value, null, 2) + "\n");
}
async function call(overrides: Record<string, unknown> = {}, disabled: string[] = [], bypass = false) {
  const ctx = createToolContext(root);
  if (bypass) ctx.permissionMode = () => "bypass";
  const outcome = await registry.execute(
    ctx,
    "decode_register",
    { ...args, ...overrides },
    new AbortController().signal,
    disabled,
  );
  return { ...outcome, value: JSON.parse(outcome.text) };
}
function failure(result: Awaited<ReturnType<typeof call>>, code: string, reason: string) {
  expect(result.isError).toBe(true);
  expect(result.value).toMatchObject({ isError: true, code, reason, error: expect.any(String) });
  expect(result.text.length).toBeLessThanOrEqual(32000);
}
it("decodes 0x81 exactly, sorts fields and gives complete byte provenance", async () => {
  await save();
  const result = await call();
  expect(result.isError).toBe(false);
  expect(result.truncated).toBe(false);
  expect(result.value).toMatchObject({
    valueDec: "129",
    valueHex: "0x00000081",
    widthBits: 32,
    fields: [
      { name: "PE", valueDec: "1", valueHex: "0x00000001", label: null },
      { name: "TXIE", valueDec: "0" },
      { name: "RXIE", valueDec: "0" },
      { name: "ERRIE", valueDec: "1" },
    ],
    unmappedMaskHex: "0xffffff78",
    unmappedSetBitsHex: "0x00000000",
    sourceRefs: ["sources/reference-manual.md#L7-L7"],
  });
  const bytes = await fs.readFile(join(root, args.definitionPath));
  expect(result.value.source).toEqual({
    path: args.definitionPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ref: `registers.json#L1-L${bytes.toString().trimEnd().split("\n").length}`,
  });
  for (const field of result.value.fields) expect(field.ref).toBe(result.value.source.ref);
  expect(decodeRegisterResultSchema.parse(result.value)).toEqual(result.value);
  expect((await call({ value: "129" })).value).toEqual(result.value);
  expect((await call({ value: "0X81" })).value).toEqual(result.value);
});

it("refuses adversarial wide and deep JSON before the main-process YAML duplicate-key pass", async () => {
  // Measuring elapsed time would be host-dependent; reaching YAML here is the expensive operation.
  const yaml = vi.mocked(parseDocument);
  for (const text of [
    `{${Array.from({ length: 30000 }, (_, i) => `"k${i}":0`).join(",")}}`,
    "[".repeat(10000) + "0" + "]".repeat(10000),
    JSON.stringify(definition()).replace(
      '"schemaVersion":1',
      Array(10000).fill('"schemaVersion":1').join(","),
    ),
  ]) {
    yaml.mockClear();
    await fs.writeFile(join(root, args.definitionPath), text);
    failure(await call(), "INVALID", "invalid_definition");
    expect(yaml).not.toHaveBeenCalled();
  }
});
it.each([8, 16, 32, 64])("preserves width %i, enums, unmapped bits and JSON maximum", async (widthBits) => {
  const max = (1n << BigInt(widthBits)) - 1n;
  await save({
    ...definition(),
    registers: [
      {
        name: args.register,
        widthBits,
        address: "0x10",
        sourceRefs: ["other.md#L1-L1"],
        fields: [
          {
            name: "TOP",
            lsb: widthBits - 1,
            width: 1,
            description: "Captured flag",
            enum: [{ value: "0x1", label: "SET" }],
          },
        ],
      },
    ],
  });
  const result = await call({ value: max.toString() });
  expect(result.isError).toBe(false);
  expect(JSON.parse(JSON.stringify(result.value))).toMatchObject({
    valueDec: max.toString(),
    valueHex: `0x${max.toString(16)}`,
    fields: [{ valueDec: "1", label: "SET" }],
    unmappedSetBitsHex: `0x${(max >> 1n).toString(16).padStart(widthBits / 4, "0")}`,
    sourceRefs: ["other.md#L1-L1"],
  });
  if (widthBits === 64)
    expect((await call({ value: "0x8000000000000000" })).value.valueDec).toBe("9223372036854775808");
  failure(await call({ value: (max + 1n).toString() }), "INVALID", "value_out_of_range");
});
it("rejects invalid strict arguments and unsigned value syntax", async () => {
  await save();
  for (const value of ["-1", "+1", "1.0", "1e2", "1+1", " 1", "1\n", "0x", "0xfg", "1".repeat(81), 1, ""])
    failure(await call({ value }), "INVALID", "invalid_arguments");
  for (const overrides of [
    { extra: true },
    { definitionPath: "a".repeat(257) },
    { expectedSha256: "x" },
    { device: { id: "x", extra: true } },
  ])
    failure(await call(overrides), "INVALID", "invalid_arguments");
  failure(await call({ register: "missing" }), "INVALID", "unknown_register");
});
it("rejects malformed bounded definitions and duplicate keys at every level", async () => {
  const mutate = async (change: (d: ReturnType<typeof definition>) => unknown) => {
    await save(change(definition()));
    failure(await call(), "INVALID", "invalid_definition");
  };
  await mutate((d) => ({ ...d, schemaVersion: 2 }));
  await mutate((d) => ({ ...d, registers: [...d.registers, ...d.registers] }));
  await mutate((d) => ({ ...d, sourceRefs: [] }));
  await mutate((d) => ({ ...d, sourceRefs: ["../outside#L1-L1"] }));
  await mutate((d) => ({ ...d, sourceRefs: Array(9).fill("x#L1-L1") }));
  for (const fields of [
    [
      { name: "X", lsb: 0, width: 2 },
      { name: "Y", lsb: 1, width: 1 },
    ],
    [{ name: "X", lsb: 31, width: 2 }],
    [{ name: "X", lsb: -1, width: 1 }],
    [{ name: "X", lsb: 0, width: 0 }],
    [
      { name: "X", lsb: 0, width: 1 },
      { name: "X", lsb: 1, width: 1 },
    ],
    [{ name: "X", lsb: 0, width: 1, description: "x".repeat(257) }],
    [
      {
        name: "X",
        lsb: 0,
        width: 1,
        enum: [
          { value: "1", label: "a" },
          { value: "0x1", label: "b" },
        ],
      },
    ],
    [{ name: "X", lsb: 0, width: 1, enum: [{ value: "2", label: "x" }] }],
    [{ name: "X", lsb: 0, width: 64, enum: [{ value: 9007199254740992, label: "unsafe" }] }],
    [
      {
        name: "X",
        lsb: 0,
        width: 32,
        enum: Array.from({ length: 17 }, (_, value) => ({ value, label: "x" })),
      },
    ],
  ])
    await mutate((d) => ({ ...d, registers: [{ ...d.registers[0], fields }] }));
  await mutate((d) => ({
    ...d,
    registers: Array.from({ length: 513 }, (_, i) => ({ ...d.registers[0], name: `R${i}` })),
  }));
  await mutate((d) => ({ ...d, registers: [{ ...d.registers[0], widthBits: 24 }] }));
  for (const text of [
    '{"schemaVersion":1,"schemaVersion":1}',
    '{"device":{"id":"x","id":"y"}}',
    '{"registers":[{"fields":[{"lsb":0,"lsb":1}]}]}',
  ]) {
    await fs.writeFile(join(root, args.definitionPath), text);
    failure(await call(), "INVALID", "duplicate_keys");
  }
  for (const text of ["schemaVersion: 1", "{} {}", "{}\n---\n{}", '{"x":NaN}', '{"x":1,}']) {
    await fs.writeFile(join(root, args.definitionPath), text);
    failure(await call(), "INVALID", "invalid_definition");
  }
  await fs.writeFile(join(root, args.definitionPath), Buffer.from([0xff]));
  failure(await call(), "INVALID", "invalid_utf8");
  await fs.writeFile(join(root, args.definitionPath), " ".repeat(1024 * 1024 + 1));
  failure(await call(), "INVALID", "file_too_large");
});
it("enforces device identity, expected SHA and source byte encodings", async () => {
  await save();
  const original = (await call()).value;
  expect((await call({ device: { id: "VERA-DEMO-01" } })).isError).toBe(false);
  expect(
    (await call({ device: definition().device, expectedSha256: original.source.sha256.toUpperCase() }))
      .isError,
  ).toBe(false);
  for (const device of [{ id: "other" }, { id: "VERA-DEMO-01", revision: "B" }])
    failure(await call({ device }), "CONFLICT", "device_mismatch");
  failure(await call({ expectedSha256: "0".repeat(64) }), "CONFLICT", "source_changed");
  await fs.appendFile(join(root, args.definitionPath), " ");
  failure(await call({ expectedSha256: original.source.sha256 }), "CONFLICT", "source_changed");
  const bytes = Buffer.from(
    "\ufeff" + JSON.stringify(definition(), null, 2).replaceAll("\n", "\r\n") + "\r\n",
  );
  await fs.writeFile(join(root, args.definitionPath), bytes);
  expect((await call()).value.source.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
});
it("denies outside, ignored and metadata paths even in Bypass; missing files stay distinct", async () => {
  await save();
  await fs.mkdir(join(root, ".vera"));
  await fs.writeFile(join(root, ".vera/.veraignore"), "ignored.json\n");
  for (const bypass of [false, true])
    for (const definitionPath of [
      "../outside.json",
      join(root, "registers.json"),
      ".vera/workbench.yaml",
      "ignored.json",
      ".",
      "file:stream",
      "bad\npath",
    ])
      failure(await call({ definitionPath }, [], bypass), "DENIED", "path_denied");
  failure(await call({ definitionPath: "missing.json" }), "NOT_FOUND", "not_found");
  expect(registry.specs(["decode_register"]).map((t) => t.name)).not.toContain("decode_register");
  expect(registry.bind(createToolContext(root), ["decode_register"]).map((t) => t.name)).not.toContain(
    "decode_register",
  );
  failure(await call({}, ["decode_register"]), "DENIED", "tool_disabled");
});
it("detects an in-place change and file replacement during bounded reads", async () => {
  const actualOpen = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open;
  for (const replace of [false, true]) {
    await save();
    const spy = vi.mocked(fs.open).mockImplementation(async (...openArgs) => {
      const handle = await actualOpen(...openArgs);
      const originalRead = handle.read.bind(handle);
      let changed = false;
      handle.read = (async (...readArgs: Parameters<typeof handle.read>) => {
        const result = await originalRead(...readArgs);
        if (!changed) {
          changed = true;
          if (replace) {
            await fs.writeFile(join(root, "replacement.json"), JSON.stringify(definition()));
            await fs.rename(join(root, args.definitionPath), join(root, "old.json"));
            await fs.rename(join(root, "replacement.json"), join(root, args.definitionPath));
          } else await fs.appendFile(join(root, args.definitionPath), " ");
        }
        return result;
      }) as typeof handle.read;
      return handle;
    });
    failure(await call(), "CONFLICT", "source_changed");
    spy.mockImplementation(actualOpen);
  }
});
it("returns a bounded explicit error instead of partially decoded fields", async () => {
  await save({
    ...definition(),
    registers: [
      {
        name: args.register,
        widthBits: 64,
        fields: Array.from({ length: 64 }, (_, lsb) => ({
          name: String(lsb) + '\\"'.repeat(256),
          lsb,
          width: 1,
        })),
      },
    ],
  });
  failure(await call(), "INVALID", "result_too_large");
});

it("accepts exact size and cardinality ceilings, numeric enums and full64bit enum strings", async () => {
  const d = {
    ...definition(),
    registers: Array.from({ length: 512 }, (_, i) => ({
      name: `R${i}`,
      widthBits: 64,
      fields: i
        ? []
        : [
            {
              name: "ALL",
              lsb: 0,
              width: 64,
              enum: [
                { value: "0xffffffffffffffff", label: "MAX" },
                { value: 0, label: "ZERO" },
              ],
            },
          ],
    })),
  };
  const text = JSON.stringify(d);
  await fs.writeFile(
    join(root, args.definitionPath),
    text + " ".repeat(1024 * 1024 - Buffer.byteLength(text)),
  );
  expect((await call({ register: "R0", value: "0xffffffffffffffff" })).value.fields[0].label).toBe("MAX");
  expect((await call({ register: "R0", value: "0" })).value.fields[0].label).toBe("ZERO");
  await save({
    ...definition(),
    registers: [
      {
        name: args.register,
        widthBits: 64,
        fields: Array.from({ length: 64 }, (_, lsb) => ({ name: `F${lsb}`, lsb, width: 1 })),
      },
    ],
  });
  expect((await call()).value.fields).toHaveLength(64);
  const invalid = {
    ...definition(),
    registers: [
      {
        name: args.register,
        widthBits: 64,
        fields: Array.from({ length: 65 }, (_, lsb) => ({ name: `F${lsb}`, lsb, width: 1 })),
      },
    ],
  };
  await save(invalid);
  failure(await call(), "INVALID", "invalid_definition");
  await save();
  failure(await call({ expectedSha256: "0".repeat(64) + "\n" }), "INVALID", "invalid_arguments");
});
it("denies canonical aliases outside the workbench", async () => {
  const outside = await fs.mkdtemp(join(tmpdir(), "vera-decode-outside-"));
  try {
    await fs.writeFile(join(outside, "registers.json"), JSON.stringify(definition()));
    await fs.symlink(outside, join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    failure(await call({ definitionPath: "alias/registers.json" }), "DENIED", "path_denied");
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});
it("maps descriptor read failures to a stable refusal", async () => {
  await save();
  const actualOpen = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open;
  vi.mocked(fs.open).mockImplementation(async (...openArgs) => {
    const handle = await actualOpen(...openArgs);
    handle.read = (async () => {
      throw Error("read failed");
    }) as typeof handle.read;
    return handle;
  });
  failure(await call(), "DENIED", "path_denied");
});
