// REQ-UX-18f96271 REQ-FUNC-1388cbcf REQ-FUNC-e117c80b REQ-UX-4bb04608
import type { SessionActivity } from "@vera/shared";
import { LoaderCircle, ShieldAlert, Square } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

type ActiveStatus = SessionActivity["sessions"][number]["status"];

/** The sidebar's running (spinning) or awaiting-approval mark; its text is given by the element using it. */
export function ActivityIcon({ status }: { status: ActiveStatus }) {
  return status === "awaiting_approval" ? (
    <ShieldAlert aria-hidden="true" />
  ) : (
    <LoaderCircle aria-hidden="true" className="activity-spinner" />
  );
}

/**
 * A workbench heading's control for its running and awaiting-approval sessions: a count that stays in the
 * heading whether the row is collapsed or the workbench is in the background, and a menu that opens or
 * stops one of them. It is one of the sidebar's menus, so the navigation closes it on an outside click and
 * on Escape, returning focus to its summary.
 */
export function WorkbenchActivity({
  activity,
  disabled,
  open,
  stop,
}: {
  activity: SessionActivity;
  /** Opening waits while another sidebar operation runs; Stop stays available. */
  disabled: boolean;
  open: (sessionId: string) => void;
  stop: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDetailsElement>(null);
  const awaiting = activity.sessions.filter((s) => s.status === "awaiting_approval").length;
  const running = activity.sessions.length - awaiting;
  const label = t("sessionActivity.summary", { name: activity.name, running, awaiting });
  // Once the last session stops the control goes away; focus then moves to the workbench name.
  useLayoutEffect(() => {
    const element = menu.current;
    return () => {
      if (!element?.contains(document.activeElement)) return;
      const name = element
        .closest(".workbench-group-heading")
        ?.querySelector<HTMLElement>(".workbench-group-name");
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) name?.focus();
      });
    };
  }, []);
  const close = () => {
    if (menu.current) menu.current.open = false;
    menu.current?.querySelector("summary")?.focus();
  };
  const statusText = (status: ActiveStatus) =>
    status === "awaiting_approval" ? t("chat.awaiting") : t("chat.running");
  return (
    <details
      ref={menu}
      className="workbench-activity"
      data-activity={awaiting ? "awaiting_approval" : "running"}
    >
      <summary aria-label={label} title={label}>
        <ActivityIcon status={awaiting ? "awaiting_approval" : "running"} />
        <span aria-hidden="true">{activity.sessions.length}</span>
      </summary>
      <div>
        {activity.sessions.map((session) => {
          const title = session.title || t("chat.untitled");
          return (
            <div
              key={session.id}
              className="workbench-activity-session"
              data-activity-session={session.id}
              data-status={session.status}
            >
              <button
                type="button"
                data-action="open-active-session"
                disabled={disabled}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                  open(session.id);
                }}
              >
                <ActivityIcon status={session.status} />
                <span>{title}</span>
                <small>{statusText(session.status)}</small>
              </button>
              <button
                type="button"
                data-action="stop-active-session"
                aria-label={t("sessionActivity.stopNamed", { title })}
                title={t("sessionActivity.stopNamed", { title })}
                onClick={() => {
                  close();
                  stop(session.id);
                }}
              >
                <Square aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
