import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { findLargeText } from "./large-text-find.js";
import { LargeTextIndex } from "./large-text-index.js";
import {
  type LargeTextFile,
  LargeTextSource,
  TEXT_SCAN_BYTES,
  TEXT_WINDOW_BYTES,
} from "./large-text-source.js";
import { readTextWindow, textByteOffset } from "./large-text-window.js";
import type { TextEncoding } from "./text-encoding.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
const signal = () => new AbortController().signal;
const encode = (value: string, encoding: TextEncoding = "utf-8") => {
  if (!encoding.startsWith("utf-16")) return new TextEncoder().encode(value);
  const bytes = new Uint8Array(value.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), encoding === "utf-16le");
  return bytes;
};
const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
const joinBytes = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
function fixture(bytes: Uint8Array, encoding: TextEncoding = "utf-8") {
  const file: LargeTextFile = {
    workbenchId: "wb_fixture",
    path: "opaque.",
    size: bytes.length,
    modified: "2026-11-17T00:00:00.000Z",
    encoding,
  };
  const invoke = vi.mocked(api.invoke).mockImplementation((async (
    channel: string,
    input: { offset: number; length: number },
  ) => {
    if (channel === "docs.stat")
      return { workbenchId: file.workbenchId, properties: { ...file, type: "file" } };
    if (channel === "docs.readBytes")
      return {
        ...file,
        offset: input.offset,
        data: base64(bytes.subarray(input.offset, input.offset + input.length)),
      };
    throw Error(channel);
  }) as typeof api.invoke);
  const source = new LargeTextSource(file);
  return { source, index: new LargeTextIndex(source, encoding), invoke };
}

// REQ-FUNC-61deffee REQ-NFR-106002fa REQ-UX-051512dc
it("keeps distant text windows bounded and settles variable-length lines with sparse checkpoints", async () => {
  const lines = Array.from({ length: 90000 }, (_, i) => `${i + 1} ${"word ".repeat(i % 29)}\r\n`);
  const bytes = encode(lines.join(""));
  const { source, index } = fixture(bytes);
  for (const offset of [0, 1000000, 2000000, 3000000, 4000000, bytes.length]) {
    const view = await readTextWindow(source, "utf-8", false, offset, signal());
    expect(view.end - view.offset).toBeLessThanOrEqual(TEXT_WINDOW_BYTES);
    expect(view.lines.length).toBeLessThanOrEqual(TEXT_WINDOW_BYTES + 1);
    expect(source.retainedBytes).toBeLessThanOrEqual(4 * TEXT_WINDOW_BYTES);
  }
  const target = await index.goToLine(87931, signal());
  expect(target.line).toBe(87931);
  expect(new TextDecoder().decode(bytes.subarray(target.offset, target.offset + 6))).toBe("87931 ");
  expect((await index.position(target.offset, signal())).line).toBe(87931);
  expect(await index.goToLine(999999, signal())).toEqual({ line: 90001, offset: bytes.length });
  expect(index.checkpoints.length).toBeLessThanOrEqual(1026);
  source.dispose();
  expect(source.retainedBytes).toBe(0);
});

// REQ-FUNC-61deffee REQ-UX-4edbbb03
it.each(["utf-8", "utf-16le", "utf-16be"] as const)(
  "preserves %s split characters, CRLF and cross-chunk search",
  async (encoding) => {
    const prefix = "a".repeat(encoding === "utf-8" ? TEXT_SCAN_BYTES - 3 : TEXT_SCAN_BYTES / 2 - 1);
    const needle = "😀café\r\nNEXT";
    const bytes = encode(`${prefix}${needle}\r\nlast`, encoding);
    const { source, index } = fixture(bytes, encoding);
    const at = encode(prefix, encoding).length;
    expect(
      (await findLargeText(source, index, encoding, false, "😀café", 0, true, signal(), async () => {})).hit
        ?.offset,
    ).toBe(at);
    expect(
      (await findLargeText(source, index, encoding, false, "CAFÉ", Infinity, false, signal(), async () => {}))
        .hit?.offset,
    ).toBe(at + encode("😀", encoding).length);
    const window = await readTextWindow(source, encoding, false, at + 8193, signal());
    expect(window.lines.join("\n")).not.toContain("�");
    expect(window.lines.join("\n")).toContain("NEXT");
    expect((await index.goToLine(2, signal())).offset).toBe(at + encode("😀café\r\n", encoding).length);
  },
);

it("maps replacement sequences to original bytes and keeps newline-dense and very long lines bounded", async () => {
  const bytes = joinBytes([
    new Uint8Array(TEXT_SCAN_BYTES * 2).fill(10),
    new Uint8Array(TEXT_SCAN_BYTES * 2).fill(120),
    Uint8Array.of(255, 0x61, 0x62, 0x63),
  ]);
  const { source, index } = fixture(bytes);
  const window = await readTextWindow(source, "utf-8", false, TEXT_SCAN_BYTES * 3, signal());
  expect(window.lines).toHaveLength(1);
  expect(window.lines[0]?.length).toBe(TEXT_WINDOW_BYTES);
  expect(window).toHaveProperty("column", 8192);
  await expect(
    findLargeText(source, index, "utf-8", false, "abc", 0, true, signal(), async () => {}),
  ).rejects.toBeInstanceOf(TypeError);
  expect(
    (await findLargeText(source, index, "utf-8", true, "abc", 0, true, signal(), async () => {})).hit?.offset,
  ).toBe(bytes.length - 3);
  expect(textByteOffset(Uint8Array.of(255, 97), "utf-8", 0, 1)).toBe(1);
  expect(index.checkpoints.length).toBeLessThanOrEqual(6);
  expect(source.retainedBytes).toBeLessThanOrEqual(4 * TEXT_WINDOW_BYTES);
});

// REQ-REL-2c5c00b6
it.each(["owner", "path", "offset", "size", "short", "base64", "modified"])(
  "rejects inconsistent %s replies",
  async (failure) => {
    const { source } = fixture(encode("some content"));
    vi.mocked(api.invoke).mockImplementation((async (channel: string) =>
      channel === "docs.stat"
        ? {
            workbenchId: source.file.workbenchId,
            properties: { ...source.file, type: "file", modified: "changed" },
          }
        : {
            ...source.file,
            workbenchId: failure === "owner" ? "other" : source.file.workbenchId,
            path: failure === "path" ? "other" : source.file.path,
            offset: failure === "offset" ? 1 : 0,
            size: source.file.size + (failure === "size" ? 1 : 0),
            data: failure === "base64" ? "!!!!" : base64(encode(failure === "short" ? "x" : "some content")),
          }) as typeof api.invoke);
    await expect(
      failure === "modified" ? source.verify(signal()) : source.read(0, 12, signal()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  },
);

// REQ-UX-4edbbb03 REQ-UX-051512dc
it("cancels scans between chunks and discards cancelled byte replies without caching", async () => {
  const { source, index, invoke } = fixture(new Uint8Array(TEXT_SCAN_BYTES * 3).fill(97));
  const controller = new AbortController();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((async (...args: Parameters<typeof api.invoke>) => {
    const reply = await original?.(...args);
    if (args[0] === "docs.readBytes") controller.abort();
    return reply;
  }) as typeof api.invoke);
  await expect(
    findLargeText(source, index, "utf-8", false, "missing", 0, true, controller.signal, async () => {}),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke.mock.calls.filter(([channel]) => channel === "docs.readBytes")).toHaveLength(1);
  expect(source.retainedBytes).toBe(0);
  expect(index.cursor.offset).toBe(0);
});

it("counts matching source lines and wraps with scalar navigation across long-line fragments", async () => {
  const { source, index, invoke } = fixture(
    encode(`HIT twice HIT\n${"x".repeat(TEXT_SCAN_BYTES * 2)}HIT\nlast HIT\n`),
  );
  const reveal = vi.fn(async () => {});
  const first = await findLargeText(source, index, "utf-8", false, "hit", 0, true, signal(), reveal);
  expect(first).toMatchObject({ hit: { line: 1, offset: 0 }, current: 1, total: 3 });
  invoke.mockClear();
  expect(await findLargeText(source, index, "utf-8", false, "hit", 1, false, signal(), reveal)).toMatchObject(
    { hit: { line: 3 }, current: 3, total: 3 },
  );
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(["docs.stat"]);
  expect(await findLargeText(source, index, "utf-8", false, "hit", 3, true, signal(), reveal)).toMatchObject({
    hit: { line: 1 },
    current: 1,
    total: 3,
  });
  expect(await findLargeText(source, index, "utf-8", false, "absent", 0, true, signal(), reveal)).toEqual({
    current: 0,
    total: 0,
  });
});

it("uses verified original newline positions for masked CRLF/CR text and permits verified control logs", async () => {
  const bytes = encode("a**b*c\0");
  const { source, index, invoke } = fixture(bytes);
  source.file.verified = { revision: "sealed", lines: 3, utf8Log: true };
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((async (channel: string, input: { offset: number; length: number }) => {
    const result = await original?.(channel as never, input as never);
    if (channel === "docs.readBytes")
      return {
        ...(result as object),
        revision: "sealed",
        lineEnds: [3, 5]
          .filter((end) => end > input.offset && end <= input.offset + input.length)
          .map((end) => end - input.offset),
      };
    return result;
  }) as typeof api.invoke);
  expect((await readTextWindow(source, "utf-8", false, 0, signal())).lines).toEqual(["a**", "b*", "c\0"]);
  expect(await index.goToLine(3, signal())).toEqual({ line: 3, offset: 5 });
  expect(
    await findLargeText(source, index, "utf-8", false, "b*", 0, true, signal(), async () => {}),
  ).toMatchObject({ hit: { line: 2, offset: 3 }, total: 1 });
});

it("clamps verified EOF to its original last line without a synthetic trailing row", async () => {
  const { source, index, invoke } = fixture(encode("a**"));
  source.file.verified = { revision: "sealed", lines: 1, utf8Log: false };
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((async (channel: string, input: { offset: number; length: number }) => {
    const result = await original?.(channel as never, input as never);
    return channel === "docs.readBytes"
      ? {
          ...(result as object),
          revision: "sealed",
          lineEnds: input.offset + input.length >= 3 ? [3 - input.offset] : [],
        }
      : result;
  }) as typeof api.invoke);
  expect((await readTextWindow(source, "utf-8", false, 3, signal())).lines).toEqual(["a**"]);
  expect(await index.goToLine(999, signal())).toEqual({ line: 1, offset: 0 });
});

it.each(["revision", "order", "range", "missing"])(
  "rejects inconsistent verified %s metadata",
  async (failure) => {
    const { source, invoke } = fixture(encode("some content"));
    source.file.verified = { revision: "sealed", lines: 1, utf8Log: false };
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((async (channel: string, input: unknown) => {
      const result = await original?.(channel as never, input as never);
      return channel === "docs.readBytes"
        ? {
            ...(result as object),
            revision: failure === "revision" ? "other" : "sealed",
            lineEnds:
              failure === "order"
                ? [3, 2]
                : failure === "range"
                  ? [13]
                  : failure === "missing"
                    ? undefined
                    : [],
          }
        : result;
    }) as typeof api.invoke);
    await expect(source.read(0, 12, signal())).rejects.toMatchObject({ code: "CONFLICT" });
  },
);
