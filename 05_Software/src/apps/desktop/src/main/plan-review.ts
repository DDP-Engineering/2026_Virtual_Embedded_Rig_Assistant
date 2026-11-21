import { veraError } from "@vera/shared";
import type { ChannelHandlers } from "./ipc-router.js";
import type { SessionsHost } from "./sessions.js";

type PlanChannel =
  | "session.plan.comment.save"
  | "session.plan.comment.delete"
  | "session.plan.review"
  | "session.plan.review.restore";

/**
 * User-only adapters capture their database before joining the host's serial queue. `host` names the
 * session host of the open workbench holding the session (it throws NOT_FOUND or CONFLICT otherwise).
 */
export function planReviewHandlers(
  host: (workbenchId: string, sessionId: string) => SessionsHost,
  containsSecret: (value: unknown) => boolean,
): Pick<ChannelHandlers, PlanChannel> {
  return {
    "session.plan.comment.save": ({ workbenchId, sessionId, ...change }) => {
      const sessions = host(workbenchId, sessionId);
      const scope = sessions.captureScope(workbenchId);
      return sessions.run(
        (service) => {
          if ("text" in change && containsSecret(change.text)) throw veraError("INVALID");
          service.savePlanComment(sessionId, change);
          return {};
        },
        { purpose: "metadata", scope },
      );
    },
    "session.plan.comment.delete": ({ workbenchId, sessionId, ...request }) => {
      const sessions = host(workbenchId, sessionId);
      const scope = sessions.captureScope(workbenchId);
      return sessions.run(
        (service) => {
          service.deletePlanComment(sessionId, request);
          return {};
        },
        { purpose: "metadata", scope },
      );
    },
    "session.plan.review": ({ workbenchId, sessionId, ...request }) => {
      const sessions = host(workbenchId, sessionId);
      const scope = sessions.captureScope(workbenchId);
      return sessions.run((service) => service.reviewPlan(sessionId, request), { purpose: "review", scope });
    },
    "session.plan.review.restore": ({ workbenchId, sessionId, ...request }) => {
      const sessions = host(workbenchId, sessionId);
      const scope = sessions.captureScope(workbenchId);
      return sessions.run(
        (service) => {
          service.restorePlanReview(sessionId, request);
          return {};
        },
        { purpose: "metadata", scope },
      );
    },
  };
}
