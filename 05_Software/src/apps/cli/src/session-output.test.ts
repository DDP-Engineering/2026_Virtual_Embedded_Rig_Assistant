import { sessionEventSchema } from "@vera/shared";
import { expect, it } from "vitest";
import { sessionOutput } from "./session-output.js";

it("projects content independently from unconditional diagnostics without corrupting short protocol spellings", () => {
  const protect = (text: string) => text.replaceAll("on", "[REDACTED]").replaceAll("error", "[REDACTED]");
  const event = sessionEventSchema.parse({
    type: "tool.started",
    callId: "on",
    name: "read",
    args: { value: "on" },
  });
  expect(sessionEventSchema.parse(sessionOutput(event, protect, protect))).toEqual({
    ...event,
    args: { value: "[REDACTED]" },
  });
  expect(sessionOutput(event, (text) => text, protect)).toEqual(event);
  const error = sessionEventSchema.parse({
    type: "error",
    code: "PROVIDER",
    messageKey: "on",
    retryable: false,
  });
  expect(sessionEventSchema.parse(sessionOutput(error, (text) => text, protect))).toEqual({
    ...error,
    messageKey: "errors.PROVIDER",
  });
});

it.each([true, false])(
  "projects model references with agent masking=%s and preserves reference syntax",
  (mask) => {
    const event = sessionEventSchema.parse({ type: "session.updated", modelRef: "replay/script" });
    const scrub = (text: string) => text.replaceAll("script", "[REDACTED]");
    expect(sessionOutput(event, mask ? scrub : (text) => text, scrub)).toEqual({
      ...event,
      modelRef: mask ? "replay/[REDACTED]" : "replay/script",
    });
  },
);

// REQ-DATA-d9ca38e5
it("projects the derived context note of a compaction record with the content policy", () => {
  const event = sessionEventSchema.parse({
    type: "context.compacted",
    covered: 4,
    fingerprint: "abc",
    note: "[Derived historical context] secret",
    refs: [],
    images: [],
  });
  const scrub = (text: string) => text.replaceAll("secret", "[REDACTED]");
  expect(sessionOutput(event, scrub, scrub)).toMatchObject({
    note: "[Derived historical context] [REDACTED]",
  });
});
