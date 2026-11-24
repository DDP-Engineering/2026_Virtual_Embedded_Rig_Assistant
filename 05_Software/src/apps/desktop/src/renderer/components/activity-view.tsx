import { useQuery } from "@tanstack/react-query";
import type { ActivitySessionTarget, RecentWorkbenchState, SessionActivity } from "@vera/shared";
import { Activity } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { unreadActivityKey } from "../hooks/use-session-activity.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";

type Target = ActivitySessionTarget & { completionId?: string };

export function ActivityView({
  open,
  setOpen,
  activity,
  activityError,
  workbenches,
  pending,
  shownSession,
  openSession,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  activity: SessionActivity[] | undefined;
  activityError: unknown;
  workbenches: RecentWorkbenchState[] | undefined;
  pending: boolean;
  shownSession?: ActivitySessionTarget | undefined;
  openSession: (target: Target, questionId?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const clearing = useRef(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>();
  const unread = useQuery({
    queryKey: unreadActivityKey,
    queryFn: () => api.invoke("session.activity.unread", {}),
    enabled: open,
  });
  const known = (target: ActivitySessionTarget) =>
    workbenches?.find(({ id, folder }) => id === target.workbenchId && folder === target.folder);
  const completions = (unread.data ?? []).filter((row) => !known(row)?.missing);
  const { rows: page, pager } = usePaged(completions);
  const operating = (activity ?? [])
    .filter((row) => !workbenches?.some(({ folder, missing }) => folder === row.folder && missing))
    .flatMap(({ workbenchId, folder, name, sessions }) =>
      sessions.map(({ id, title, status, pendingQuestionId, pendingPlanDecision }) => ({
        target: { workbenchId, folder, sessionId: id },
        title,
        name,
        questionId: pendingQuestionId,
        kind: pendingQuestionId
          ? pendingPlanDecision
            ? "plan"
            : "question"
          : status === "awaiting_approval"
            ? "approval"
            : "running",
      })),
    );
  const otherPlans = operating.filter(
    ({ kind, target }) =>
      kind === "plan" &&
      (target.folder !== shownSession?.folder ||
        target.workbenchId !== shownSession.workbenchId ||
        target.sessionId !== shownSession.sessionId),
  ).length;
  const busy = pending || reading;
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [open]);
  useLayoutEffect(() => {
    if (open && document.activeElement === document.body) close.current?.focus();
  });
  function dismiss() {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }
  async function readAll() {
    if (busy || clearing.current) return;
    clearing.current = true;
    setReading(true);
    setError(undefined);
    try {
      await api.invoke("session.activity.readAll", {});
      await unread.refetch();
      close.current?.focus();
    } catch (failure) {
      setError(failure);
    } finally {
      clearing.current = false;
      setReading(false);
    }
  }
  const sections = [
    { kind: "running", title: t("activity.running"), rows: operating.filter((r) => r.kind === "running") },
    { kind: "approval", title: t("activity.approval"), rows: operating.filter((r) => r.kind === "approval") },
    { kind: "question", title: t("activity.question"), rows: operating.filter((r) => r.kind === "question") },
    { kind: "plan", title: t("activity.planDecisions"), rows: operating.filter((r) => r.kind === "plan") },
    {
      kind: "completion",
      title: t("activity.completions"),
      rows: page.map(({ workbenchName, title, ...target }) => ({
        name: known(target)?.name ?? workbenchName,
        questionId: undefined,
        title,
        target,
      })),
    },
  ];
  return (
    <>
      <button
        type="button"
        data-action="show-activity"
        ref={trigger}
        aria-label={t("activity.title")}
        aria-describedby={otherPlans ? `${dialogId}-plan-count` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        title={t("activity.title")}
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        <Activity aria-hidden="true" />
        {otherPlans > 0 && (
          <span className="activity-plan-count" id={`${dialogId}-plan-count`}>
            <span className="sr-only">{t("activity.planDecisions")} </span>
            {otherPlans}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <dialog
            className="pinned-dialog activity-dialog"
            id={dialogId}
            ref={dialog}
            aria-labelledby={titleId}
            onCancel={(event) => {
              event.preventDefault();
              dismiss();
            }}
          >
            <div className="activity-header">
              <h2 id={titleId}>{t("activity.title")}</h2>
              <button ref={close} type="button" aria-disabled={busy} onClick={dismiss}>
                {t("panel.close")}
              </button>
            </div>
            {(error ?? activityError ?? unread.error) != null && (
              <ErrorMessage error={error ?? activityError ?? unread.error} />
            )}
            {activity && unread.data && !operating.length && !completions.length && (
              <p role="status">{t("activity.empty")}</p>
            )}
            {sections.map(
              ({ kind, title, rows }) =>
                rows.length > 0 && (
                  <section key={kind} aria-labelledby={`${dialogId}-${kind}`}>
                    <div className="activity-header">
                      <h3 id={`${dialogId}-${kind}`}>{title}</h3>
                      {kind === "completion" && (
                        <button type="button" aria-disabled={busy} onClick={() => void readAll()}>
                          {t("activity.readAll")}
                        </button>
                      )}
                    </div>
                    <ul className="activity-rows">
                      {rows.map(({ target, name, title, questionId }) => (
                        <li key={JSON.stringify(target)}>
                          <button
                            type="button"
                            aria-disabled={busy}
                            data-activity-session={target.sessionId}
                            data-activity-kind={kind}
                            onClick={() => {
                              if (!busy && !clearing.current)
                                void openSession(target, questionId).then((opened) => {
                                  if (!opened) void unread.refetch();
                                });
                            }}
                          >
                            <span>{title || t("chat.untitled")}</span>
                            <small>{name}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {kind === "completion" && <Pager {...pager} />}
                  </section>
                ),
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
