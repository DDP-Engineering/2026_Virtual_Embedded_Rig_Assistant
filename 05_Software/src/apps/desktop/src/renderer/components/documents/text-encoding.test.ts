import { expect, it } from "vitest";
import { decodeTextLines, detectTextEncoding } from "./text-encoding.js";

// REQ-FUNC-c5def0c3 REQ-UX-5a886e34
it("detects UTF BOM variants and defaults to strict UTF8 with explicit replacement", () => {
  for (const [bytes, encoding] of [
    [Uint8Array.of(0xef, 0xbb, 0xbf, 0x61), "utf-8"],
    [Uint8Array.of(0xff, 0xfe, 0x61, 0), "utf-16le"],
    [Uint8Array.of(0xfe, 0xff, 0, 0x61), "utf-16be"],
  ] as const) {
    expect(detectTextEncoding(bytes)).toBe(encoding);
    expect(decodeTextLines(bytes, encoding)).toEqual(["a"]);
  }
  expect(detectTextEncoding(Uint8Array.of(0x61))).toBe("utf-8");
  expect(decodeTextLines(new TextEncoder().encode("first\r\nlast\n"), "utf-8")).toEqual([
    "first",
    "last",
    "",
  ]);
  expect(decodeTextLines(Uint8Array.of(0), "utf-8")).toBeNull();
  expect(decodeTextLines(Uint8Array.of(0xff), "utf-8")).toBeNull();
  expect(decodeTextLines(Uint8Array.of(0xff), "utf-8", true)).toEqual(["�"]);
  expect(decodeTextLines(Uint8Array.of(0xa1), "iso-8859-2")).toEqual(["Ą"]);
  expect(decodeTextLines(Uint8Array.of(0x80), "windows-1252")).toEqual(["€"]);
  expect(decodeTextLines(Uint8Array.of(0x80), "iso-8859-1")).toEqual(["€"]);
  expect(decodeTextLines(Uint8Array.of(0x80), "latin1")).toEqual(["\x80"]);
  expect(decodeTextLines(Uint8Array.of(0x61), "utf-16le")).toBeNull();
  expect(decodeTextLines(new Uint8Array(), "utf-8")).toEqual([""]);
});
