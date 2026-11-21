import { expect, it } from "vitest";
import { acceptsImages, customConfigSchema } from "./providers.js";

it("detects image input from a model's declared modalities", () => {
  expect(acceptsImages({ input: ["text", "image"] })).toBe(true);
  expect(acceptsImages({ input: ["image"] })).toBe(true);
  expect(acceptsImages({ input: ["text"] })).toBe(false);
  expect(acceptsImages({ input: [] })).toBe(false);
});

it("accepts a custom response timeout of 10 to 3600 whole seconds", () => {
  const config = { name: "Local", baseUrl: "http://127.0.0.1:1234/v1", model: "m" };
  for (const seconds of [10, 3600])
    expect(
      customConfigSchema.parse({ ...config, responseTimeoutSeconds: seconds }).responseTimeoutSeconds,
    ).toBe(seconds);
  expect(customConfigSchema.parse(config).responseTimeoutSeconds).toBeUndefined();
  for (const seconds of [9, 3601, 12.5])
    expect(customConfigSchema.safeParse({ ...config, responseTimeoutSeconds: seconds }).success).toBe(false);
});
