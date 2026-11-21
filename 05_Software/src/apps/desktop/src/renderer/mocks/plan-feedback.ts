import {
  channels,
  foldSessionEvents,
  type PlanComment,
  type PlanReview,
  type PlanTarget,
  type SessionEvent,
  validPlanTarget,
  veraError,
} from "@vera/shared";

type FeedbackChannel =
  | "session.plan.comment.save"
  | "session.plan.comment.delete"
  | "session.plan.review"
  | "session.plan.review.restore";
export function isFeedbackChannel(channel: string): channel is FeedbackChannel {
  return (
    channel === "session.plan.comment.save" ||
    channel === "session.plan.comment.delete" ||
    channel === "session.plan.review" ||
    channel === "session.plan.review.restore"
  );
}

/** Browser fixture implementation only: strict user channels and shared events, never execution tools. */
export function mockPlanFeedback(
  channel: FeedbackChannel,
  raw: unknown,
  host: {
    events: SessionEvent[];
    workbenchId: string;
    active: boolean;
    archived: boolean;
    writable: () => void;
    nextId: () => string;
    emit: (event: SessionEvent) => void;
    start: (review: PlanReview) => void;
  },
): unknown {
  const input = channels[channel].request.safeParse(raw);
  if (!input.success) throw veraError("INVALID");
  if (input.data.workbenchId !== host.workbenchId) throw veraError("CONFLICT");
  host.writable();
  if (host.archived) throw veraError("DENIED");
  const state = foldSessionEvents(host.events);
  const feedbackRevision = (expected: number) => {
    if (expected !== state.planFeedbackRevision) throw veraError("CONFLICT");
  };
  const validate = (target: PlanTarget) => {
    if (!validPlanTarget(target)) throw veraError("INVALID");
    if (target.revision !== state.planRevision || state.todos[target.stepIndex]?.text !== target.stepText)
      throw veraError("CONFLICT");
  };
  if (channel === "session.plan.comment.save") {
    const change = channels[channel].request.parse(raw);
    feedbackRevision(change.expectedFeedbackRevision);
    let comment: PlanComment;
    if (change.action === "create") {
      validate(change.target);
      comment = { id: host.nextId(), text: change.text, target: change.target };
    } else {
      const found = state.planComments.find((comment) => comment.id === change.commentId);
      if (!found) throw veraError("NOT_FOUND");
      const { stale: _, ...saved } = found;
      if (change.action === "reanchor") {
        validate(change.target);
        comment = { ...saved, target: change.target };
      } else comment = { ...saved, text: change.text };
    }
    host.emit({ type: "plan.comments.saved", comments: [comment] });
    return {};
  }
  if (channel === "session.plan.comment.delete") {
    const change = channels[channel].request.parse(raw);
    feedbackRevision(change.expectedFeedbackRevision);
    if (!state.planComments.some((comment) => comment.id === change.commentId)) throw veraError("NOT_FOUND");
    host.emit({ type: "plan.comment.removed", commentId: change.commentId });
    return {};
  }
  if (channel === "session.plan.review.restore") {
    const request = channels[channel].request.parse(raw);
    const review = state.planReviews.find((review) => review.id === request.reviewId);
    if (!review) throw veraError("NOT_FOUND");
    if (
      host.events.some(
        (event) =>
          event.type === "plan.review.restored" &&
          event.reviewId === review.id &&
          event.expectedFeedbackRevision === request.expectedFeedbackRevision,
      )
    )
      return {};
    feedbackRevision(request.expectedFeedbackRevision);
    if (host.active) throw veraError("BUSY");
    if (review.stopReason === null || review.stopReason === "end") throw veraError("INVALID");
    const comments = review.comments
      .filter(
        (comment) =>
          !state.planComments.some(
            (draft) =>
              draft.restoredFrom?.reviewId === review.id && draft.restoredFrom.commentId === comment.id,
          ),
      )
      .map((comment) => ({
        ...comment,
        id: host.nextId(),
        restoredFrom: { reviewId: review.id, commentId: comment.id },
      }));
    host.emit({
      type: "plan.review.restored",
      reviewId: review.id,
      expectedFeedbackRevision: request.expectedFeedbackRevision,
      comments,
    });
    return {};
  }
  const request = channels["session.plan.review"].request.parse(raw);
  const accepted = state.planReviews.find(
    (review) =>
      review.expectedPlanRevision === request.expectedPlanRevision &&
      review.expectedFeedbackRevision === request.expectedFeedbackRevision,
  );
  if (accepted) return { reviewId: accepted.id, turnId: accepted.turnId, messageId: accepted.messageId };
  if (host.active || state.items.some((item) => item.kind === "user" && item.pending))
    throw veraError("BUSY");
  feedbackRevision(request.expectedFeedbackRevision);
  if (state.planRevision !== request.expectedPlanRevision) throw veraError("CONFLICT");
  if (!state.todos.length || !state.planComments.length) throw veraError("INVALID");
  for (const comment of state.planComments) {
    if (comment.stale) throw veraError("CONFLICT");
    validate(comment.target);
  }
  const review: PlanReview = {
    id: host.nextId(),
    expectedPlanRevision: request.expectedPlanRevision,
    expectedFeedbackRevision: request.expectedFeedbackRevision,
    plan: state.todos,
    comments: state.planComments.map(({ stale: _, ...comment }) => comment),
    turnId: host.nextId(),
    messageId: host.nextId(),
    submittedAt: new Date().toISOString(),
    stopReason: null,
  };
  host.start(review);
  return { reviewId: review.id, turnId: review.turnId, messageId: review.messageId };
}
