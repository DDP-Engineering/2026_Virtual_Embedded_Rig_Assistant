import { expect, it } from "vitest";
import { acceptsImages } from "./providers.js";

it("detects image input from a model's declared modalities", () => {
  expect(acceptsImages({ input: ["text", "image"] })).toBe(true);
  expect(acceptsImages({ input: ["image"] })).toBe(true);
  expect(acceptsImages({ input: ["text"] })).toBe(false);
  expect(acceptsImages({ input: [] })).toBe(false);
});
