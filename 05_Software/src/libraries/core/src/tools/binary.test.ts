import { expect, it } from "vitest";
import * as api from "../index.js";

it("detects binary NUL and replacement ratio only in the first8192 bytes", () => {
  expect(api.isBinary).toBeTypeOf("function");
  expect(api.isBinary(Buffer.from("Banc ă 日本語"))).toBe(false);
  expect(api.isBinary(Buffer.from([0]))).toBe(true);
  expect(api.isBinary(Buffer.from([0xff, ...Buffer.from("123456789")]))).toBe(false);
  expect(api.isBinary(Buffer.from([0xff, ...Buffer.from("12345678")]))).toBe(true);
  expect(api.isBinary(Buffer.concat([Buffer.alloc(8192, 65), Buffer.from([0])]))).toBe(false);
});
