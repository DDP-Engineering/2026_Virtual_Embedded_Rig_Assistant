import { sessionEventSchema } from "@vera/shared";
import { expect, it } from "vitest";
import { sessionOutput } from "./session-output.js";

it("projects every feedback event with the live choice while preserving nested protocol identities", () => {
  const comment = {
    id: "on",
    text: "sensitive",
    target: {
      revision: 1,
      stepIndex: 0,
      stepText: "sensitive",
      range: { start: 0, end: 9, quote: "sensitive" },
    },
  };
  const review = {
    id: "error",
    expectedPlanRevision: 1,
    expectedFeedbackRevision: 1,
    plan: [{ id: "sensitive", text: "sensitive", status: "pending" }],
    comments: [comment],
    turnId: "on",
    messageId: "error",
    submittedAt: "2026-11-19T00:00:00.000Z",
    stopReason: null,
  };
  const protect = (text: string) =>
    text
      .replaceAll("sensitive", "[REDACTED]")
      .replaceAll("on", "[REDACTED]")
      .replaceAll("error", "[REDACTED]");
  for (const raw of [
    { type: "plan.comments.saved", comments: [comment] },
    { type: "plan.review.submitted", review },
    { type: "plan.review.restored", reviewId: "error", expectedFeedbackRevision: 2, comments: [comment] },
  ]) {
    const event = sessionEventSchema.parse(raw);
    const masked = sessionOutput(event, protect, protect);
    expect(JSON.stringify(masked)).not.toContain("sensitive");
    expect(sessionEventSchema.parse(masked)).toEqual(masked);
    if (masked.type === "plan.review.submitted")
      expect(masked.review).toMatchObject({
        id: "error",
        messageId: "error",
        turnId: "on",
        comments: [{ id: "on" }],
      });
    expect(sessionOutput(event, (text) => text, protect)).toEqual(event);
  }
});

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
