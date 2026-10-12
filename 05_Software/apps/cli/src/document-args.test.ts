import { expect, it } from "vitest";
import { parseCommand } from "./args.js";

it("accepts owned index/search commands with strict bounds and arguments", () => {
  expect(parseCommand(["index", "--workbench", "."])).toMatchObject({ kind: "index" });
  expect(parseCommand(["search", "--workbench", ".", "--query", "I2C1_CR1"])).toMatchObject({
    kind: "search",
    query: "I2C1_CR1",
    k: 8,
    mode: "hybrid",
  });
  for (const args of [
    ["search", "--workbench", ".", "--query", "x", "--k", "21"],
    ["index", "--workbench", ".", "--query", "x"],
    ["search", "--workbench", ".", "--query", "x", "--mode", "remote"],
    ["index", "--workbench", ".", "--workbench", "."],
  ])
    expect(() => parseCommand(args)).toThrow();
});
