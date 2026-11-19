import { type PlanTarget, projectPlan, type SessionState, validPlanTarget, veraError } from "@vera/shared";

/** Check a caller's exact projection before its offsets can become a durable anchor. */
export function validatePlanTarget(
  state: SessionState,
  target: PlanTarget,
  content: (text: string) => string,
): void {
  if (!validPlanTarget(target)) throw veraError("INVALID");
  if (target.revision !== state.planRevision) throw veraError("CONFLICT");
  const step = projectPlan(state.todos, content)[target.stepIndex];
  if (!step) throw veraError("INVALID");
  if (step.text !== target.stepText) throw veraError("CONFLICT");
}

/** Compare saved context before disclosure; two newly redacted strings cannot prove continuity. */
export function projectPlanFeedback(state: SessionState, content: (text: string) => string): SessionState {
  if (!state.planComments.length) return state;
  const plan = projectPlan(state.todos, content);
  return {
    ...state,
    planComments: state.planComments.map((comment) => ({
      ...comment,
      stale:
        comment.target.revision !== state.planRevision ||
        plan[comment.target.stepIndex]?.text !== comment.target.stepText ||
        !validPlanTarget(comment.target),
    })),
  };
}
