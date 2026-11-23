import type { SessionState } from "@vera/shared";

/** The activity entry pins a focus request to one session in one workbench. */
export interface QuestionFocus {
  workbenchId: string;
  sessionId: string;
  questionId: string;
}

export function pendingQuestionFocus(
  target: QuestionFocus,
  workbenchId: string,
  sessionId: string,
  state: SessionState,
  workspace: HTMLElement | null,
): HTMLElement | undefined {
  if (target.workbenchId !== workbenchId || target.sessionId !== sessionId) return;
  const question = state.questions.find(
    (item) =>
      item.questionId === target.questionId && item.outcome === null && item.turnId === state.activeTurnId,
  );
  if (!question) return;
  return [...(workspace?.querySelectorAll<HTMLElement>("[data-pending-question]") ?? [])].find(
    (element) => element.dataset.pendingQuestion === question.questionId,
  );
}
