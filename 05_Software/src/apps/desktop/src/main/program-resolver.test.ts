// REQ-FUNC-83ad0f58
import { describe, expect, it } from "vitest";
import { testProgramResolver } from "./program-resolver.js";

const plugin = (id: string) => ({ manifest: { id } }) as never;
describe("testProgramResolver", () => {
  it("resolves the programs VERA_TEST_PROGRAMS names and nothing else", async () => {
    const resolver = testProgramResolver(
      JSON.stringify({ "echo-tools/echo": { executable: "C:/node/node.exe", prefix: ["--no-warnings"] } }),
    );
    expect(await resolver.resolve(plugin("echo-tools"), "echo")).toEqual({
      executable: "C:/node/node.exe",
      prefix: ["--no-warnings"],
    });
    expect(await resolver.resolve(plugin("echo-tools"), "other")).toBeUndefined();
    expect(await resolver.resolve(plugin("other-tools"), "echo")).toBeUndefined();
  });
  it("resolves nothing for a missing or malformed value", async () => {
    for (const value of [undefined, "", "{", JSON.stringify({ "echo-tools/echo": { executable: 1 } })])
      expect(await testProgramResolver(value).resolve(plugin("echo-tools"), "echo")).toBeUndefined();
  });
});
