import { type PlanCommentChange, type PlanTarget, type SessionState, veraErrorSchema } from "@vera/shared";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../error-message.js";
import { currentPlanTarget, textareaPlanTarget, wholePlanTarget } from "./plan-target.js";

interface PlanEditorContext {
  text: string;
  stepIndex: number;
  target?: PlanTarget;
  projection: number;
  expectedFeedbackRevision: number;
  opener: HTMLElement;
}
export type PlanEditor = PlanEditorContext &
  ({ action: "create" } | { action: "edit" | "reanchor"; commentId: string });

export function PlanCommentEditor({
  initial,
  state,
  projection,
  disabled,
  fallback,
  save,
  close,
}: {
  initial: PlanEditor;
  state: SessionState | undefined;
  projection: number;
  disabled: boolean;
  fallback: RefObject<HTMLElement | null>;
  save: (change: PlanCommentChange) => Promise<boolean>;
  close: () => void;
}) {
  const { t } = useTranslation(),
    id = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    selector = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial.text),
    [stepIndex, setStepIndex] = useState(initial.stepIndex);
  const [capture, setCapture] = useState({ target: initial.target, projection: initial.projection });
  const [failure, setFailure] = useState<unknown>();
  const saving = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      generation.current++;
      (initial.opener.isConnected ? initial.opener : fallback.current)?.focus();
    };
  }, [initial.opener, fallback]);
  const target = capture.projection === projection ? capture.target : undefined;
  const valid = !!state && !!target && currentPlanTarget(state, target);
  useEffect(() => {
    // Chromium disables caret navigation on HTML-readonly textareas; block edits without replacing native selection.
    const node = selector.current;
    const preventEdit = (event: InputEvent) => event.preventDefault();
    node?.addEventListener("beforeinput", preventEdit);
    return () => node?.removeEventListener("beforeinput", preventEdit);
  }, []);
  const step = state?.todos[stepIndex];
  const steps =
    state?.todos.map((_item, index) => ({ identity: `${state.planRevision}/${index}`, index })) ?? [];
  async function submit() {
    if (!state || disabled || saving.current || (initial.action !== "edit" && !valid)) return;
    saving.current = true;
    const current = generation.current;
    const expectedFeedbackRevision =
      veraErrorSchema.safeParse(failure).data?.code === "CONFLICT"
        ? state.planFeedbackRevision
        : initial.expectedFeedbackRevision;
    setFailure(undefined);
    try {
      let change: PlanCommentChange;
      if (initial.action === "edit")
        change = { action: "edit", commentId: initial.commentId, text, expectedFeedbackRevision };
      else {
        if (!target) return;
        change =
          initial.action === "create"
            ? { action: "create", text, target, expectedFeedbackRevision }
            : { action: "reanchor", commentId: initial.commentId, target, expectedFeedbackRevision };
      }
      if ((await save(change)) && current === generation.current) close();
    } catch (error) {
      if (current === generation.current) setFailure(error);
    } finally {
      saving.current = false;
    }
  }
  function captureTarget(fragment: boolean) {
    if (!state) return;
    const next = wholePlanTarget(state, stepIndex);
    if (!next) return;
    const captured =
      fragment && selector.current
        ? textareaPlanTarget(
            next,
            selector.current.value,
            selector.current.selectionStart,
            selector.current.selectionEnd,
          )
        : fragment
          ? undefined
          : next;
    if (captured) setCapture({ target: captured, projection });
  }
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog plan-comment-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving.current) close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header className="plan-editor-heading">
          <h3 id={`${id}-title`}>
            {initial.action === "reanchor"
              ? t("plan.reanchor")
              : initial.action === "edit"
                ? t("plan.edit")
                : t("plan.add")}
          </h3>
          <div className="workbench-actions">
            <button
              type="button"
              disabled={disabled && saving.current}
              onClick={() => {
                if (!saving.current) close();
              }}
            >
              {t("workbench.cancel")}
            </button>
            <button
              className="primary"
              type="submit"
              disabled={disabled || !state || (initial.action !== "edit" && !valid)}
            >
              {initial.action === "reanchor" ? t("plan.saveAnchor") : t("plan.saveDraft")}
            </button>
          </div>
        </header>
        {initial.action !== "edit" && (
          <>
            <label>
              {t("plan.step")}
              <select
                aria-label={t("plan.step")}
                disabled={disabled || !state}
                value={step ? String(stepIndex) : ""}
                onChange={(event) => {
                  setStepIndex(Number(event.target.value));
                  setCapture({ target: undefined, projection });
                }}
              >
                {!step && <option value="">{t("plan.chooseStep")}</option>}
                {steps.map(({ identity, index }) => (
                  <option key={identity} value={index}>
                    {t("plan.stepNumber", { step: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("plan.stepText")}
              <textarea
                ref={selector}
                aria-label={t("plan.stepText")}
                aria-readonly="true"
                value={step?.text ?? ""}
                onChange={(event) => {
                  event.currentTarget.value = step?.text ?? "";
                }}
                onPaste={(event) => event.preventDefault()}
                onCut={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
              />
            </label>
            <div className="plan-actions">
              <button type="button" disabled={!step || disabled} onClick={() => captureTarget(false)}>
                {t("plan.entireStep")}
              </button>
              <button type="button" disabled={!step || disabled} onClick={() => captureTarget(true)}>
                {t("plan.useSelection")}
              </button>
            </div>
          </>
        )}
        {target && (
          <blockquote aria-label={t("plan.quote")}>{target.range?.quote ?? target.stepText}</blockquote>
        )}
        {initial.action !== "reanchor" ? (
          <label>
            {t("plan.feedback")}
            <textarea
              aria-label={t("plan.feedback")}
              value={text}
              readOnly={saving.current}
              onChange={(event) => {
                if (!saving.current) setText(event.target.value);
              }}
            />
          </label>
        ) : (
          <p className="plan-feedback-text">{text}</p>
        )}
        {failure !== undefined && <ErrorMessage error={failure} />}
      </form>
    </dialog>
  );
}
