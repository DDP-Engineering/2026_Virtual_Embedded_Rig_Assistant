import {
  type PlanComment,
  type PlanCommentChange,
  type PlanReviewRequest,
  veraErrorSchema,
} from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionView } from "../../hooks/session-view.js";
import { ErrorMessage } from "../error-message.js";
import { Disclosure } from "./disclosure.js";
import { PlanCommentEditor, type PlanEditor } from "./plan-comment-editor.js";
import { PlanComments, PlanFeedbackHistory } from "./plan-feedback-history.js";
import { PlanItems } from "./plan-items.js";
import { currentPlanTarget, selectedPlanTarget, wholePlanTarget } from "./plan-target.js";

/** Owns live actions and local unsaved text; all durable feedback comes from the shared session view. */
export function PlanFeedback({
  workbenchId,
  sessionId,
  readOnly,
  archived,
}: {
  workbenchId: string;
  sessionId: string;
  readOnly: boolean;
  archived: boolean;
}) {
  const { t } = useTranslation();
  const { view, error, retry, projection } = useSessionView(sessionId, undefined, workbenchId);
  const state = view?.state;
  const [editor, setEditor] = useState<PlanEditor>();
  const [failure, setFailure] = useState<unknown>();
  const [pending, setPending] = useState(false),
    [restored, setRestored] = useState(false);
  const [reviewAttempt, setReviewAttempt] = useState<PlanReviewRequest>();
  const busy = useRef(false),
    generation = useRef(0),
    toolbar = useRef<HTMLDivElement>(null);
  const pointerTarget = useRef<
    { target: ReturnType<typeof selectedPlanTarget>; projection: number } | undefined
  >(undefined);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const locked = readOnly || archived || !state || pending;
  const running =
    !!state &&
    (!!state.activeTurnId ||
      state.status === "running" ||
      state.status === "awaiting_approval" ||
      state.items.some((item) => item.kind === "user" && item.pending) ||
      state.approvals.some((approval) => approval.decision === null));
  async function perform(operation: () => Promise<unknown>): Promise<boolean> {
    if (busy.current || locked) return false;
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    setRestored(false);
    const current = generation.current;
    try {
      await operation();
      if (current !== generation.current) return false;
      retry();
      return true;
    } catch (error) {
      if (current !== generation.current) return false;
      setFailure(error);
      if (veraErrorSchema.safeParse(error).data?.code === "CONFLICT") retry();
      throw error;
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  function open(action: PlanEditor["action"], index: number, comment?: PlanComment) {
    if (!state || locked || busy.current) return;
    const pointer = pointerTarget.current;
    const selected =
      pointer?.projection === projection &&
      pointer.target?.stepIndex === index &&
      currentPlanTarget(state, pointer.target)
        ? pointer.target
        : undefined;
    const target =
      action === "create"
        ? pointer?.target
          ? selected
          : wholePlanTarget(state, index)
        : action === "edit"
          ? comment?.target
          : undefined;
    pointerTarget.current = undefined;
    const activeElement = document.activeElement;
    const opener = activeElement instanceof HTMLElement ? activeElement : toolbar.current;
    if (!opener) return;
    const context = {
      stepIndex: index,
      ...(target ? { target } : {}),
      projection,
      expectedFeedbackRevision: state.planFeedbackRevision,
      opener,
    };
    if (action === "create") setEditor({ ...context, action });
    else if (comment) setEditor({ ...context, action, commentId: comment.id });
  }
  function save(change: PlanCommentChange) {
    return perform(() => api.invoke("session.plan.comment.save", { workbenchId, sessionId, ...change }));
  }
  function remove(comment: PlanComment) {
    if (!state) return;
    void perform(() =>
      api.invoke("session.plan.comment.delete", {
        workbenchId,
        sessionId,
        expectedFeedbackRevision: state.planFeedbackRevision,
        commentId: comment.id,
      }),
    ).catch(() => {});
  }
  async function review() {
    if (!state || locked || busy.current || (running && !reviewAttempt)) return;
    const expected = reviewAttempt ?? {
      expectedPlanRevision: state.planRevision,
      expectedFeedbackRevision: state.planFeedbackRevision,
    };
    if (
      !reviewAttempt &&
      (!state.todos.length ||
        !state.planComments.length ||
        state.planComments.some((comment) => comment.stale || !currentPlanTarget(state, comment.target)))
    )
      return;
    setReviewAttempt(expected);
    const current = generation.current;
    try {
      if (
        (await perform(() => api.invoke("session.plan.review", { workbenchId, sessionId, ...expected }))) &&
        current === generation.current
      )
        setReviewAttempt(undefined);
    } catch (error) {
      if (current !== generation.current) return;
      const code = veraErrorSchema.safeParse(error).data?.code;
      if (
        code === "CONFLICT" ||
        code === "INVALID" ||
        code === "BUSY" ||
        code === "DENIED" ||
        code === "NOT_FOUND"
      )
        setReviewAttempt(undefined);
    }
  }
  const actions = {
    edit: (comment: PlanComment) => open("edit", comment.target.stepIndex, comment),
    reanchor: (comment: PlanComment) => open("reanchor", comment.target.stepIndex, comment),
    remove,
  };
  const stale =
    state?.planComments.filter((comment) => comment.stale || !currentPlanTarget(state, comment.target)) ?? [];
  return (
    <>
      <div ref={toolbar} className="plan-actions" tabIndex={-1}>
        <button
          type="button"
          className="primary"
          onClick={() => void review()}
          disabled={
            locked ||
            running ||
            !!reviewAttempt ||
            !state?.todos.length ||
            !state.planComments.length ||
            stale.length > 0
          }
        >
          {t("plan.review")}
        </button>
        {reviewAttempt && (
          <button type="button" disabled={locked} onClick={() => void review()}>
            {t("plan.retryReview")}
          </button>
        )}
      </div>
      {error !== undefined ? (
        <>
          <ErrorMessage error={error} />
          <button type="button" onClick={retry}>
            {t("settings.retry")}
          </button>
        </>
      ) : !state ? (
        <p role="status">{t("home.loading")}</p>
      ) : state.todos.length === 0 ? (
        <p className="muted">{t("plan.empty")}</p>
      ) : (
        <PlanItems
          items={state.todos}
          actions={(index) => {
            const drafts = state.planComments.filter(
              (comment) =>
                !comment.stale &&
                comment.target.stepIndex === index &&
                currentPlanTarget(state, comment.target),
            );
            const submitted = state.planReviews
              .flatMap((review) => review.comments)
              .filter(
                (comment) => comment.target.stepIndex === index && currentPlanTarget(state, comment.target),
              );
            return (
              <div className="plan-live-actions">
                <button
                  type="button"
                  disabled={locked}
                  aria-label={t("plan.addToStep", { step: index + 1 })}
                  onPointerDown={(event) => {
                    const target = wholePlanTarget(state, index);
                    pointerTarget.current = {
                      target: target
                        ? selectedPlanTarget(
                            event.currentTarget.closest("[data-plan-step]")?.querySelector(".plan-text"),
                            target,
                          )
                        : undefined,
                      projection,
                    };
                  }}
                  onClick={() => open("create", index)}
                >
                  {t("plan.add")}
                </button>
                {!!drafts.length && (
                  <Disclosure title={t("plan.drafts", { count: drafts.length })}>
                    <PlanComments comments={drafts} disabled={locked} actions={actions} />
                  </Disclosure>
                )}
                {!!submitted.length && (
                  <Disclosure title={t("plan.submittedCount", { count: submitted.length })}>
                    <PlanComments comments={submitted} disabled={locked} />
                  </Disclosure>
                )}
              </div>
            );
          }}
        />
      )}
      {stale.length > 0 && (
        <section aria-label={t("plan.needsAnchor")}>
          <h3>{t("plan.needsAnchor")}</h3>
          <PlanComments comments={stale} disabled={locked} actions={actions} />
        </section>
      )}
      {state && (
        <PlanFeedbackHistory
          reviews={state.planReviews}
          disabled={locked || running}
          restore={(review) => {
            const current = generation.current;
            void perform(() =>
              api.invoke("session.plan.review.restore", {
                workbenchId,
                sessionId,
                expectedFeedbackRevision: state.planFeedbackRevision,
                reviewId: review.id,
              }),
            )
              .then((saved) => {
                if (saved && current === generation.current) setRestored(true);
              })
              .catch(() => {});
          }}
        />
      )}
      {failure !== undefined && <ErrorMessage error={failure} />}
      {restored && <p role="status">{t("plan.feedbackRestored")}</p>}
      {editor && (
        <PlanCommentEditor
          initial={editor}
          state={state}
          projection={projection}
          disabled={locked}
          fallback={toolbar}
          save={save}
          close={() => setEditor(undefined)}
        />
      )}
    </>
  );
}
