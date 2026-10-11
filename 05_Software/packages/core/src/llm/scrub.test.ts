import { existsSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";

let scrub: typeof import("./scrub.js").scrub;
beforeAll(async () => {
  expect(existsSync(new URL("./scrub.ts", import.meta.url)), "known-secret scrubber exists").toBe(true);
  ({ scrub } = await import("./scrub.js"));
});
it("scrubs embedded errors, overlapping keys and JSON escaped secrets without treating regex", () => {
  const key = 'fake-WP08[secret]"\\private';
  expect(scrub(`error ${key} ${JSON.stringify(key).slice(1, -1)} fake-WP08`, ["", "fake-WP08", key])).toBe(
    "error [REDACTED] [REDACTED] [REDACTED]",
  );
  expect(scrub("ordinary failure", [key])).toBe("ordinary failure");
});
