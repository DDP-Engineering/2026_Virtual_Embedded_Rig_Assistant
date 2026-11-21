import { z } from "zod";
import type { SessionEvent } from "./events.js";
import { stopReasonSchema, type TodoItem, todoItemsSchema } from "./session.js";

export const planRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const planFeedbackIdSchema = z.string().min(1);
export const planTargetSchema = z.strictObject({
  revision: planRevisionSchema,
  stepIndex: planRevisionSchema,
  stepText: z.string().max(200),
  range: z.strictObject({ start: planRevisionSchema, end: planRevisionSchema, quote: z.string() }).nullable(),
});
export type PlanTarget = z.infer<typeof planTargetSchema>;
export const planCommentSchema = z.strictObject({
  id: planFeedbackIdSchema,
  text: z.string(),
  target: planTargetSchema,
  restoredFrom: z
    .strictObject({ reviewId: planFeedbackIdSchema, commentId: planFeedbackIdSchema })
    .optional(),
});
export type PlanComment = z.infer<typeof planCommentSchema>;
export const planCommentViewSchema = planCommentSchema.extend({ stale: z.boolean() });
export const planReviewSchema = z.strictObject({
  id: planFeedbackIdSchema,
  expectedPlanRevision: planRevisionSchema,
  expectedFeedbackRevision: planRevisionSchema,
  plan: todoItemsSchema,
  comments: z.array(planCommentSchema),
  turnId: planFeedbackIdSchema,
  messageId: planFeedbackIdSchema,
  submittedAt: z.string().datetime(),
  stopReason: stopReasonSchema.nullable(),
});
export type PlanReview = z.infer<typeof planReviewSchema>;
export const planReviewRequestSchema = z.strictObject({
  expectedPlanRevision: planRevisionSchema,
  expectedFeedbackRevision: planRevisionSchema,
});
export type PlanReviewRequest = z.infer<typeof planReviewRequestSchema>;
export const planReviewRestoreSchema = z.strictObject({
  reviewId: planFeedbackIdSchema,
  expectedFeedbackRevision: planRevisionSchema,
});
export type PlanReviewRestore = z.infer<typeof planReviewRestoreSchema>;
/** Feedback text as written (never trimmed), with at least one non-space character. */
const planCommentTextSchema = z.string().refine((text) => text.trim().length > 0);
export const planCommentChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    expectedFeedbackRevision: planRevisionSchema,
    text: planCommentTextSchema,
    target: planTargetSchema,
  }),
  z.strictObject({
    action: z.literal("edit"),
    expectedFeedbackRevision: planRevisionSchema,
    commentId: planFeedbackIdSchema,
    text: planCommentTextSchema,
  }),
  z.strictObject({
    action: z.literal("reanchor"),
    expectedFeedbackRevision: planRevisionSchema,
    commentId: planFeedbackIdSchema,
    target: planTargetSchema,
  }),
]);
export type PlanCommentChange = z.infer<typeof planCommentChangeSchema>;
export const planCommentDeleteSchema = z.strictObject({
  commentId: planFeedbackIdSchema,
  expectedFeedbackRevision: planRevisionSchema,
});

function splitsSurrogate(text: string, index: number): boolean {
  return /[\uD800-\uDBFF]/.test(text.charAt(index - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(index));
}

/** Admission validation, separate from shapes whose historical strings may have been remasked. */
export function validPlanTarget(value: unknown): value is PlanTarget {
  const result = planTargetSchema.safeParse(value);
  if (!result.success) return false;
  const { stepText, range } = result.data;
  return (
    range === null ||
    (range.start < range.end &&
      range.end <= stepText.length &&
      !splitsSurrogate(stepText, range.start) &&
      !splitsSurrogate(stepText, range.end) &&
      stepText.slice(range.start, range.end) === range.quote)
  );
}

/** Structural equality preserves proven staleness; equality alone never establishes continuity. */
export function equalPlanTarget(left: PlanTarget, right: PlanTarget): boolean {
  return (
    left.revision === right.revision &&
    left.stepIndex === right.stepIndex &&
    left.stepText === right.stepText &&
    (left.range === null
      ? right.range === null
      : right.range !== null &&
        left.range.start === right.range.start &&
        left.range.end === right.range.end &&
        left.range.quote === right.range.quote)
  );
}

/** The exact todo presentation used for both selection and authoritative anchor validation. */
export function projectPlan(items: readonly TodoItem[], content: (text: string) => string): TodoItem[] {
  return items.map((item) => ({
    ...item,
    text: content(item.text).slice(0, 200),
    ...(item.id === undefined ? {} : { id: content(item.id) }),
  }));
}

/** Scrub data only; a retained quote is not sliced again using offsets into a previous projection. */
export function mapPlanCommentContent<T extends PlanComment>(
  comment: T,
  content: (text: string) => string,
): T {
  return {
    ...comment,
    text: content(comment.text),
    target: {
      ...comment.target,
      stepText: content(comment.target.stepText).slice(0, 200),
      range: comment.target.range
        ? { ...comment.target.range, quote: content(comment.target.range.quote) }
        : null,
    },
  };
}

export function mapPlanReviewContent(review: PlanReview, content: (text: string) => string): PlanReview {
  return {
    ...review,
    plan: projectPlan(review.plan, content),
    comments: review.comments.map((comment) => mapPlanCommentContent(comment, content)),
  };
}

/** Shared desktop/CLI disclosure for feedback events; control fields always remain protocol data. */
export function mapPlanFeedbackEventContent(
  event: SessionEvent,
  content: (text: string) => string,
): SessionEvent {
  if (event.type === "plan.comments.saved" || event.type === "plan.review.restored")
    return { ...event, comments: event.comments.map((comment) => mapPlanCommentContent(comment, content)) };
  if (event.type === "plan.review.submitted")
    return { ...event, review: mapPlanReviewContent(event.review, content) };
  return event;
}
