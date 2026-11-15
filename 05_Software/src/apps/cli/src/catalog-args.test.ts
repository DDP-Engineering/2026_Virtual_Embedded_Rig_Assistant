import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseCommand } from "./args.js";

// REQ-DATA-532b02f5
it("parses catalog kit with a source, a kit platform and an output folder", () => {
  expect(
    parseCommand(["catalog", "kit", "--source", "plugins", "--platform", "linux-x64", "--out", "kit"]),
  ).toEqual({ kind: "catalog-kit", source: resolve("plugins"), platform: "linux-x64", out: resolve("kit") });
  expect(
    parseCommand([
      "catalog",
      "kit",
      "--source",
      "p",
      "--platform",
      "windows-x64",
      "--out",
      "k",
      "--skip",
      "sigrok,wokwi",
    ]),
  ).toMatchObject({ kind: "catalog-kit", skip: ["sigrok", "wokwi"] });
  for (const args of [
    ["catalog", "kit", "--source", "plugins", "--platform", "linux-arm64", "--out", "kit"],
    ["catalog", "kit", "--source", "plugins", "--out", "kit"],
    ["catalog", "kit", "--source", "plugins", "--platform", "windows-x64"],
    ["catalog", "kit", "--source", "p", "--platform", "windows-x64", "--out", "k", "--out", "k"],
    ["catalog", "kit", "--source", "p", "--platform", "windows-x64", "--out", "k", "--skip", "../x"],
  ])
    expect(() => parseCommand(args), args.join(" ")).toThrow();
});
