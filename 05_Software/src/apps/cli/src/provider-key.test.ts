import { expect, it } from "vitest";
import { parseCommand, UsageError } from "./args.js";
import { environmentKey } from "./provider-key.js";

// REQ-SEC-ac9095ec
it("takes OPENAI_API_KEY for the OpenAI provider only and names --key-file and --key-env otherwise", () => {
  const env = { OPENAI_API_KEY: "fictional-openai-key" };
  expect(environmentKey("openai", env)).toEqual({ key: "fictional-openai-key" });
  expect(environmentKey("openai", {}).note).toMatch(/OPENAI_API_KEY or pass --key-file .* --key-env/);
  const custom = environmentKey("custom", env);
  expect(custom.key).toBeUndefined();
  expect(custom.note).toMatch(/--key-file .* --key-env/);
  expect(custom.note).not.toContain("fictional-openai-key");
  // A custom gateway without a key (a local model server) and a replay run need none.
  expect(environmentKey("custom", {})).toEqual({});
  expect(environmentKey("replay", env)).toEqual({});
});

// REQ-SEC-ac9095ec
it("takes the key from the variable that --key-env names, for any provider", () => {
  const env = { OPENAI_API_KEY: "fictional-openai-key", GATEWAY_KEY: " fictional-gateway-key\n" };
  expect(environmentKey("custom", env, "GATEWAY_KEY")).toEqual({ key: "fictional-gateway-key" });
  // The named variable wins over OPENAI_API_KEY, and naming that one sends it on purpose.
  expect(environmentKey("openai", env, "GATEWAY_KEY")).toEqual({ key: "fictional-gateway-key" });
  expect(environmentKey("custom", env, "OPENAI_API_KEY")).toEqual({ key: "fictional-openai-key" });
  for (const missing of [{}, { GATEWAY_KEY: "  " }]) {
    const attempt = () => environmentKey("custom", missing, "GATEWAY_KEY");
    expect(attempt).toThrow(UsageError);
    expect(attempt).toThrow(/--key-env GATEWAY_KEY/);
  }
});

it("parses --key-env as a variable name and refuses it together with --key-file", () => {
  const run = ["run", "--workbench", "w", "--prompt", "p", "--provider", "custom"];
  const custom = [...run, "--base-url", "http://127.0.0.1:1/v1", "--model", "m"];
  expect(parseCommand([...custom, "--key-env", "GATEWAY_KEY"])).toMatchObject({ keyEnv: "GATEWAY_KEY" });
  expect(parseCommand(custom)).not.toHaveProperty("keyEnv");
  expect(() => parseCommand([...custom, "--key-env", "NOT A NAME"])).toThrow("Invalid --key-env.");
  expect(() => parseCommand([...custom, "--key-env", "1KEY"])).toThrow("Invalid --key-env.");
  expect(() => parseCommand([...custom, "--key-env", "A", "--key-file", "k.txt"])).toThrow(/not both/);
});
