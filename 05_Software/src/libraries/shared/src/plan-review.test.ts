import { expect, it } from "vitest";
import * as shared from "./index.js";

const target = {
  revision: 1,
  stepIndex: 1,
  stepText: "A😀B\nμC",
  range: { start: 1, end: 3, quote: "😀" },
};
const comment = { id: "on", text: "Vérifier 😀\nÎncă o dată", target };
const plan: shared.TodoItem[] = [
  { id: "duplicate", text: target.stepText, status: "pending" },
  { id: "duplicate", text: target.stepText, status: "in_progress" },
  { text: "", status: "done" },
];
const saved = { type: "plan.comments.saved", comments: [comment] };
const review = {
  id: "error",
  expectedPlanRevision: 1,
  expectedFeedbackRevision: 1,
  plan,
  comments: [comment],
  turnId: "on",
  messageId: "error",
  submittedAt: "2026-11-19T00:00:00.000Z",
  stopReason: null,
};
const event = (value: unknown) => shared.sessionEventSchema.parse(value);

it("accepts strict feedback metadata without losing Unicode, ranges, empty steps or duplicate IDs", () => {
  expect(shared.sessionEventSchema.safeParse(saved).success).toBe(true);
  expect(event(saved)).toEqual(saved);
  expect(event({ type: "plan.review.submitted", review })).toMatchObject({ review });
  expect(shared.sessionEventSchema.safeParse({ ...saved, permission: "bypass" }).success).toBe(false);
  expect(
    shared.sessionEventSchema.safeParse({
      ...saved,
      comments: [{ ...comment, target: { ...target, stepIndex: Number.MAX_SAFE_INTEGER + 1 } }],
    }).success,
  ).toBe(false);
});

it("refuses blank feedback text but keeps written text verbatim", () => {
  const change = (text: string) => [
    { action: "create", expectedFeedbackRevision: 0, text, target },
    { action: "edit", expectedFeedbackRevision: 1, commentId: "pc_1", text },
  ];
  for (const text of ["", " ", "\n\t "])
    for (const value of change(text))
      expect(shared.planCommentChangeSchema.safeParse(value).success).toBe(false);
  for (const value of change(" μC 😀\n"))
    expect(shared.planCommentChangeSchema.parse(value)).toMatchObject({ text: " μC 😀\n" });
});

it("validates exact UTF16 targets without trimming, normalization or surrogate splitting", () => {
  expect(shared.validPlanTarget(target)).toBe(true);
  expect(shared.validPlanTarget({ ...target, range: null, stepText: "" })).toBe(true);
  for (const range of [
    { start: -1, end: 3, quote: "😀" },
    { start: 1, end: 2, quote: "\ud83d" },
    { start: 2, end: 3, quote: "\ude00" },
    { start: 1, end: 1, quote: "" },
    { start: 3, end: 1, quote: "😀" },
    { start: 1, end: 300, quote: "😀" },
    { start: 1, end: 3, quote: "wrong" },
    { start: 0, end: Number.MAX_SAFE_INTEGER + 1, quote: "all" },
  ])
    expect(shared.validPlanTarget({ ...target, range })).toBe(false);
  expect(shared.validPlanTarget({ ...target, stepIndex: -1 })).toBe(false);
  expect(shared.validPlanTarget({ ...target, revision: 0.5 })).toBe(false);
});

it("replays revision counters and stales an old occurrence on every replacement without moving it", () => {
  const a = shared.applySessionEvent(shared.emptySessionState(), { type: "todo.updated", items: plan });
  const b = shared.applySessionEvent(a, event(saved));
  expect(b).toMatchObject({
    planRevision: 1,
    planFeedbackRevision: 1,
    planComments: [{ ...comment, stale: false }],
  });
  const c = shared.applySessionEvent(b, { type: "todo.updated", items: [...plan].reverse() });
  expect(c).toMatchObject({ planRevision: 2, planComments: [{ ...comment, stale: true }] });
  expect(b.planComments[0]?.stale).toBe(false);
  expect(b.planComments[0]?.target).toEqual(target);
  expect(c.items).toBe(b.items);
  expect(shared.foldSessionEvents([event({ type: "todo.updated", items: plan }), event(saved)])).toEqual(b);
  expect(shared.sessionStateSchema.parse(c)).toEqual(c);
  expect(saved.comments[0]).not.toHaveProperty("stale");
});

it("retains host-proven projection staleness when editing text rather than proving a new target", () => {
  const masked = shared.mapPlanCommentContent(comment, (text) => text.replaceAll("😀", "[REDACTED]"));
  const state = shared.foldSessionEvents([
    event({
      type: "todo.updated",
      items: shared.projectPlan(plan, (text) => text.replaceAll("😀", "[REDACTED]")),
    }),
    event({ type: "plan.comments.saved", comments: [masked] }),
  ]);
  state.planComments = [{ ...masked, stale: true }];
  const edited = shared.applySessionEvent(
    state,
    event({ type: "plan.comments.saved", comments: [{ ...masked, text: "Edited feedback" }] }),
  );
  expect(edited.planComments[0]?.stale).toBe(true);
  expect(state.planComments[0]?.text).toBe(masked.text);
  const reanchored = {
    ...masked,
    target: { ...masked.target, range: { start: 1, end: 11, quote: "[REDACTED]" } },
  };
  const current = shared.applySessionEvent(
    edited,
    event({ type: "plan.comments.saved", comments: [reanchored] }),
  );
  expect(current.planComments[0]?.stale).toBe(false);
});

it("captures immutable submitted history and derives retry ownership without dropping later drafts", () => {
  const later = { ...comment, id: "later", text: "Another draft", target: { ...target, range: null } };
  const events = [
    event({ type: "todo.updated", items: plan }),
    event({ type: "plan.comments.saved", comments: [comment, later] }),
    event({ type: "plan.review.submitted", review }),
    event({ type: "message.user", messageId: review.messageId, text: "Review plan" }),
    event({ type: "turn.started", turnId: review.turnId }),
  ];
  const a = shared.foldSessionEvents(events);
  expect(a.planComments).toEqual([{ ...later, stale: false }]);
  expect(a.planReviews).toEqual([review]);
  expect(a.items).toContainEqual({ kind: "user", id: "error", text: "Review plan", reviewId: "error" });
  const b = shared.applySessionEvent(a, { type: "turn.done", turnId: "on", stopReason: "error" });
  expect(b.planReviews[0]?.stopReason).toBe("error");
  expect(a.planReviews[0]?.stopReason).toBeNull();
  const restored = { ...comment, id: "retry", restoredFrom: { reviewId: "error", commentId: "on" } };
  const c = shared.applySessionEvent(
    b,
    event({
      type: "plan.review.restored",
      reviewId: "error",
      expectedFeedbackRevision: 2,
      comments: [restored],
    }),
  );
  expect(c.planFeedbackRevision).toBe(3);
  expect(c.planComments).toEqual([
    { ...later, stale: false },
    { ...restored, stale: false },
  ]);
  const d = shared.applySessionEvent(c, event({ type: "plan.comment.removed", commentId: "retry" }));
  expect(d.planComments).toEqual([{ ...later, stale: false }]);
  expect(d.planReviews).toEqual(b.planReviews);
  expect(c.planComments).toHaveLength(2);
});

it("maps feedback data without masking protocol identities or reusing old quote offsets", () => {
  const scrub = (text: string) => text.replaceAll("on", "[REDACTED]").replaceAll("😀", "[REDACTED]");
  const mapped = shared.mapPlanReviewContent(review, scrub);
  expect(mapped).toMatchObject({
    id: "error",
    turnId: "on",
    messageId: "error",
    comments: [
      {
        id: "on",
        target: { ...target, stepText: "A[REDACTED]B\nμC", range: { start: 1, end: 3, quote: "[REDACTED]" } },
      },
    ],
  });
  expect(mapped.plan[1]?.status).toBe("in_progress");
  expect(review.comments[0]?.target.range?.quote).toBe("😀");
  expect(shared.sessionEventSchema.safeParse({ type: "plan.review.submitted", review: mapped }).success).toBe(
    true,
  );
});
