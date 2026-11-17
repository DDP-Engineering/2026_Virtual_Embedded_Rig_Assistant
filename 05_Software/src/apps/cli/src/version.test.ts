import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cliVersion } from "./version.js";

it("reports the version of the CLI package", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(cliVersion).toBe(manifest.version);
  expect(cliVersion).not.toBe("0.0.0");
});
