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
it("builds the token list of a secret set once and again only after a secret is added", () => {
  let builds = 0;
  class Counted extends Set<string> {
    override [Symbol.iterator]() {
      builds++;
      return super[Symbol.iterator]();
    }
  }
  const secrets = new Counted(["fake-first-private"]);
  expect(scrub("a fake-first-private", secrets)).toBe("a [REDACTED]");
  expect(scrub("b fake-first-private fake-second-private", secrets)).toBe("b [REDACTED] fake-second-private");
  expect(builds).toBe(1);
  secrets.add("fake-second-private");
  expect(scrub("c fake-first-private fake-second-private", secrets)).toBe("c [REDACTED] [REDACTED]");
  expect(builds).toBe(2);
});
