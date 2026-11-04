// REQ-FUNC-13ab0007
import { expect, it } from "vitest";
import { parseCommand } from "./args.js";

it("parses user scoped list/review/trust with persistent data and exact hash", () => {
  expect(parseCommand(["plugin", "list", "--workbench", ".", "--data", "data"])).toMatchObject({
    kind: "plugin-list",
  });
  expect(
    parseCommand(["plugin", "review", "--workbench", ".", "--data", "data", "--id", "echo-tools"]),
  ).toMatchObject({ kind: "plugin-review", id: "echo-tools" });
  expect(() =>
    parseCommand(["plugin", "trust", "--workbench", ".", "--data", "data", "--id", "echo-tools"]),
  ).toThrow();
  expect(
    parseCommand([
      "plugin",
      "trust",
      "--workbench",
      ".",
      "--data",
      "data",
      "--id",
      "echo-tools",
      "--sha256",
      "a".repeat(64),
    ]),
  ).toMatchObject({ kind: "plugin-trust", sha256: "a".repeat(64) });
});
