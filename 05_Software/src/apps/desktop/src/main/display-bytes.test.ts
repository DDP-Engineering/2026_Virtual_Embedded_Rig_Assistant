import { existsSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";

let mask: typeof import("./display-bytes.js").maskByteWindow;
beforeAll(async () => {
  expect(existsSync(new URL("./display-bytes.ts", import.meta.url)), "byte masking exists").toBe(true);
  ({ maskByteWindow: mask } = await import("./display-bytes.js"));
});
const encoded = [
  { name: "UTF8", secret: "pāss🔑", bytes: Buffer.from("pāss🔑", "utf8") },
  { name: "UTF16LE", secret: "pāss🔑", bytes: Buffer.from("pāss🔑", "utf16le") },
  { name: "UTF16BE", secret: "pāss🔑", bytes: Buffer.from("pāss🔑", "utf16le").swap16() },
  { name: "ISO88591", secret: "clé-é", bytes: Buffer.from("636ce92de9", "hex") },
  { name: "Windows1252", secret: "clé€", bytes: Buffer.from("636ce980", "hex") },
  { name: "ISO88592", secret: "Łódź", bytes: Buffer.from("a3f364bc", "hex") },
];

it.each(encoded)(
  "masks $name secrets at every left/right window split without shifting bytes",
  ({ secret, bytes }) => {
    const full = Buffer.concat([Buffer.from([0, 1, 2]), bytes, Buffer.from([3, 4, 5])]);
    const expected = Buffer.from(full);
    expected.fill(42, 3, 3 + bytes.length);
    for (let offset = 0; offset < full.length; offset++) {
      for (const length of [1, 2, bytes.length, full.length]) {
        const source = { path: "file", offset, start: 0, size: full.length, bytes: full };
        expect(mask(source, length, [secret])).toEqual(expected.subarray(offset, offset + length));
      }
    }
    expect(full.subarray(3, 3 + bytes.length)).toEqual(bytes);
  },
);

it("matches overlapping and escaped representations against original bytes", () => {
  const secret = 'pass"word\n';
  const text = `abcdef ${secret} ${JSON.stringify(secret).slice(1, -1)}`;
  const bytes = Buffer.from(text);
  const source = { path: "file", offset: 0, start: 0, size: bytes.length, bytes };
  const shown = mask(source, bytes.length, ["abcd", "cdef", secret]);
  expect(shown.toString()).toBe(
    `****** ${"*".repeat(secret.length)} ${"*".repeat(JSON.stringify(secret).length - 2)}`,
  );
});

it("masks beyond the fixed context bound conservatively and keeps EOF empty", () => {
  const source = { path: "file", offset: 2, start: 0, size: 6, bytes: Buffer.from("abcdef") };
  expect(mask(source, 3, ["x".repeat(32769)])).toEqual(Buffer.from("***"));
  expect(mask(source, 3, ["\n".repeat(20000)])).toEqual(Buffer.from("***"));
  expect(
    mask({ ...source, offset: 100, start: 100, bytes: Buffer.alloc(0) }, 4, ["x".repeat(40000)]).length,
  ).toBe(0);
  expect(mask(source, 3, [""])).toEqual(Buffer.from("cde"));
});

it("matches a maximum supported secret across the context boundary", () => {
  const secret = "a".repeat(32768);
  const bytes = Buffer.concat([Buffer.from([1]), Buffer.from(secret, "utf16le"), Buffer.from([2])]);
  const source = { path: "file", offset: 32768, start: 0, size: bytes.length, bytes };
  expect(mask(source, 1, [secret])).toEqual(Buffer.from("*"));
});
