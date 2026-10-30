import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./registry.js";

describe("PDF download tool contract", () => {
  it("offers one prepared write tool and honors its disabled-tool entry", () => {
    const registry = new ToolRegistry();
    const tool = registry.available().find((entry) => entry.name === "web_download");
    expect(tool, "public PDF downloads need a prepared write tool").toBeDefined();
    expect(tool?.class).toBe("write");
    expect(tool?.prepare).toBeTypeOf("function");
    expect(registry.available(["web_download"]).some((entry) => entry.name === "web_download")).toBe(false);
  });
});
