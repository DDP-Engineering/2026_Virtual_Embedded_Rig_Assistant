import { type PlanTarget, type SessionState, validPlanTarget } from "@vera/shared";

export function currentPlanTarget(state: SessionState, target: PlanTarget): boolean {
  return (
    target.revision === state.planRevision &&
    state.todos[target.stepIndex]?.text === target.stepText &&
    validPlanTarget(target)
  );
}

export function wholePlanTarget(state: SessionState, stepIndex: number): PlanTarget | undefined {
  const step = state.todos[stepIndex];
  return step ? { revision: state.planRevision, stepIndex, stepText: step.text, range: null } : undefined;
}

function originalOffset(text: string, offset: number): number | undefined {
  let original = 0,
    displayed = 0;
  while (original < text.length && displayed < offset) {
    if (text[original] === "\r" && text[original + 1] === "\n") original++;
    original++;
    displayed++;
  }
  return displayed === offset ? original : undefined;
}

/** Textareas normalize line endings; map their view offsets without altering stored source or quote. */
export function textareaPlanTarget(
  target: PlanTarget,
  value: string,
  start: number,
  end: number,
): PlanTarget | undefined {
  if (value !== target.stepText.replace(/\r\n?/g, "\n")) return;
  const originalStart = originalOffset(target.stepText, start),
    originalEnd = originalOffset(target.stepText, end);
  if (originalStart === undefined || originalEnd === undefined) return;
  const captured = {
    ...target,
    range: {
      start: originalStart,
      end: originalEnd,
      quote: target.stepText.slice(originalStart, originalEnd),
    },
  };
  return validPlanTarget(captured) ? captured : undefined;
}

/** Capture before button focus changes selection; endpoints must both belong to one exact text span. */
export function selectedPlanTarget(
  element: Element | null | undefined,
  target: PlanTarget,
): PlanTarget | undefined {
  const selection = window.getSelection();
  if (
    !element ||
    element.textContent !== target.stepText ||
    !selection ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed
  )
    return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
  const prefix = document.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  prefix.setEnd(range.endContainer, range.endOffset);
  const end = prefix.toString().length;
  const captured = { ...target, range: { start, end, quote: target.stepText.slice(start, end) } };
  return validPlanTarget(captured) ? captured : undefined;
}
