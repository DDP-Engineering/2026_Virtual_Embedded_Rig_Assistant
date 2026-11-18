import { expect, it } from "vitest";
import { environmentKey } from "./provider-key.js";

// REQ-SEC-ac9095ec
it("takes OPENAI_API_KEY for the OpenAI provider only and names --key-file otherwise", () => {
  const env = { OPENAI_API_KEY: "fictional-openai-key" };
  expect(environmentKey("openai", env)).toEqual({ key: "fictional-openai-key" });
  expect(environmentKey("openai", {}).note).toMatch(/OPENAI_API_KEY or pass --key-file/);
  const custom = environmentKey("custom", env);
  expect(custom.key).toBeUndefined();
  expect(custom.note).toMatch(/--key-file/);
  expect(custom.note).not.toContain("fictional-openai-key");
  // A custom gateway without a key (a local model server) and a replay run need none.
  expect(environmentKey("custom", {})).toEqual({});
  expect(environmentKey("replay", env)).toEqual({});
});
