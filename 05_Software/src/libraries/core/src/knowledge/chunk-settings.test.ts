import { expect, it } from "vitest";
import { chunkDocument } from "./chunk.js";

it("applies overlap across more than sixty short log lines with accurate source locators", () => {
  const lines = Array.from({ length: 180 }, (_, i) => `SIGNAL_${i}`);
  const chunks = chunkDocument({ kind: "text", lines }, false, { chunkSize: 200, overlap: 50 });
  expect(chunks.length).toBeGreaterThan(3);
  for (let i = 1; i < chunks.length; i++) {
    expect(chunks[i]?.text.slice(0, 50)).toBe(chunks[i - 1]?.text.slice(-50));
  }
  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(200);
    expect(chunk.locator.type).toBe("lines");
    if (chunk.locator.type === "lines")
      expect(lines.slice(chunk.locator.start - 1, chunk.locator.end).join("\n")).toContain(
        chunk.text.replace(/\n$/, ""),
      );
  }
});
it("bounds overlap against actual fragment capacity", () => {
  const chunks = chunkDocument(
    {
      kind: "markdown",
      sections: [{ path: ["X".repeat(170)], slug: "x", start: 1, end: 1, text: "signal ".repeat(90) }],
    },
    false,
    { chunkSize: 200, overlap: 199 },
  );
  expect(chunks.length).toBeLessThan(100);
  expect(chunks.every((chunk) => chunk.text.length <= 200)).toBe(true);
});
