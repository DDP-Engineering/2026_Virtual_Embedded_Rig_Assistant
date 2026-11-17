import { expect, it } from "vitest";
import { createStreamScrubber } from "./stream-scrub.js";

it("holds split and JSON-escaped credentials while on and resolves live transitions", () => {
  const secret = 'private-"credential';
  const encoded = JSON.stringify(secret).slice(1, -1);
  let enabled = true;
  const scrub = (text: string) => text.replaceAll(secret, "[REDACTED]").replaceAll(encoded, "[REDACTED]");
  const stream = createStreamScrubber(
    () => [secret],
    scrub,
    () => enabled,
  );
  expect(stream.push(secret.slice(0, 8))).toBe("");
  expect(stream.push(`${secret.slice(8)} suffix`) + stream.flush()).toBe("[REDACTED] suffix");
  expect(stream.push(encoded.slice(0, 10))).toBe("");
  expect(stream.push(encoded.slice(10)) + stream.flush()).toBe("[REDACTED]");
  expect(stream.push(secret.slice(0, 8))).toBe("");
  enabled = false;
  expect(stream.push(secret.slice(8))).toBe(secret);
  expect(stream.push(secret)).toBe(secret);
  enabled = true;
  expect(stream.push(secret) + stream.flush()).toBe("[REDACTED]");
});
