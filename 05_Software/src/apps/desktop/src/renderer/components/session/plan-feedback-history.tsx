import type { PlanComment, PlanReview } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { Pager, usePaged } from "../pager.js";
import { Disclosure } from "./disclosure.js";
import { PlanItems } from "./plan-items.js";

export function PlanComments({
  comments,
  disabled,
  actions,
}: {
  comments: readonly PlanComment[];
  disabled: boolean;
  actions?: {
    edit: (comment: PlanComment) => void;
    reanchor: (comment: PlanComment) => void;
    remove: (comment: PlanComment) => void;
  };
}) {
  const { t } = useTranslation();
  const { rows, pager } = usePaged(comments);
  return (
    <>
      <ul className="plan-comments">
        {rows.map((comment) => (
          <li key={comment.id} data-plan-comment={comment.id}>
            <span className="plan-status">
              {actions ? t("plan.draft") : t("plan.submitted")} ·{" "}
              {t("plan.stepNumber", { step: comment.target.stepIndex + 1 })}
            </span>
            <blockquote aria-label={t("plan.quote")}>
              {comment.target.range?.quote ?? comment.target.stepText}
            </blockquote>
            <p className="plan-feedback-text">{comment.text}</p>
            {actions && (
              <div className="plan-actions">
                <button type="button" disabled={disabled} onClick={() => actions.edit(comment)}>
                  {t("plan.edit")}
                </button>
                <button type="button" disabled={disabled} onClick={() => actions.reanchor(comment)}>
                  {t("plan.reanchor")}
                </button>
                <button type="button" disabled={disabled} onClick={() => actions.remove(comment)}>
                  {t("plan.delete")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Pager {...pager} />
    </>
  );
}

export function PlanFeedbackHistory({
  reviews,
  disabled,
  restore,
}: {
  reviews: readonly PlanReview[];
  disabled: boolean;
  restore: (review: PlanReview) => void;
}) {
  const { t, i18n } = useTranslation();
  const { rows, pager } = usePaged([...reviews].reverse());
  if (!reviews.length) return null;
  return (
    <Disclosure title={t("plan.previousReviews")}>
      {rows.map((review) => (
        <section key={review.id} className="plan-review-history">
          <h4>
            {t("plan.reviewDate", {
              date: new Date(review.submittedAt).toLocaleString(i18n.resolvedLanguage),
            })}
          </h4>
          <p role="status">
            {review.stopReason === "end"
              ? t("plan.reviewComplete")
              : review.stopReason === "error"
                ? t("plan.reviewFailed")
                : review.stopReason === "aborted"
                  ? t("plan.reviewStopped")
                  : review.stopReason === "limit"
                    ? t("plan.reviewLimit")
                    : t("plan.reviewRunning")}
          </p>
          <PlanItems items={review.plan} />
          <PlanComments comments={review.comments} disabled={disabled} />
          {review.stopReason !== null && review.stopReason !== "end" && (
            <button type="button" disabled={disabled} onClick={() => restore(review)}>
              {t("plan.restore")}
            </button>
          )}
        </section>
      ))}
      <Pager {...pager} />
    </Disclosure>
  );
}
