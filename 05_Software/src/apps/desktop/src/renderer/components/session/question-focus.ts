import type { SessionState } from "@vera/shared";
import { api } from "../../api/index.js";

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

/** Consult current activity, then deliver a still-pending card for synchronous focus. */
export async function confirmPendingQuestionFocus(
  target: QuestionFocus,
  card: HTMLElement,
  workspace: HTMLElement,
  finish: (pendingCard: HTMLElement | undefined) => void,
): Promise<void> {
  let pending = false;
  try {
    const workbenches = await api.invoke("session.activity", {});
    pending = workbenches.some(
      (workbench) =>
        workbench.workbenchId === target.workbenchId &&
        workbench.foreground &&
        workbench.sessions.some(
          (session) => session.id === target.sessionId && session.pendingQuestionId === target.questionId,
        ),
    );
  } catch {
    // A failed refresh cannot confirm pending status.
  }
  // Apply focus in this continuation so a settlement cannot change the card between check and focus.
  finish(
    pending &&
      workspace.isConnected &&
      workspace.contains(card) &&
      card.dataset.pendingQuestion === target.questionId
      ? card
      : undefined,
  );
}
