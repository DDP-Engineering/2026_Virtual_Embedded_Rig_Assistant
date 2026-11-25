// REQ-UX-4bea0001 REQ-UX-9a0489f1

import { type SessionSummary, visibleParent } from "@vera/shared";
import { ChevronRight, CircleAlert, Ellipsis } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSettingsSnapshot } from "../../hooks/use-preferences.js";
import { reorderOffset } from "../../lib/shortcuts.js";
import { ErrorMessage } from "../error-message.js";
import { ActivityIcon } from "../workbench-activity.js";
import { useDelegatedStatusLabels } from "./delegation-links.js";
import { SessionAdvancedDialog } from "./session-advanced.js";

type Tree = { roots: SessionSummary[]; children: Map<string, SessionSummary[]> };
/**
 * The rows of one sidebar section (REQ-UX-a6ba4f23): a session nests under its delegation parent when that
 * parent is listed in the same section, in list order; any other session is a top-level row.
 */
function sessionTree(list: readonly SessionSummary[]): Tree {
  const byId = new Map(list.map((s) => [s.id, s]));
  const children = new Map<string, SessionSummary[]>();
  const roots: SessionSummary[] = [];
  for (const s of list) {
    const parent = visibleParent(s, byId);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), s]);
    else roots.push(s);
  }
  // Inconsistent relationship metadata (a cycle) must not hide a session: unreached rows become top-level.
  const reached = new Set<string>();
  const visit = (s: SessionSummary) => {
    if (reached.has(s.id)) return;
    reached.add(s.id);
    for (const child of children.get(s.id) ?? []) visit(child);
  };
  roots.forEach(visit);
  for (const s of list) {
    if (reached.has(s.id)) continue;
    const parent = visibleParent(s, byId);
    if (parent)
      children.set(
        parent,
        (children.get(parent) ?? []).filter((child) => child.id !== s.id),
      );
    roots.push(s);
    visit(s);
  }
  return { roots, children };
}
const treeKey = (workbenchId: string) => `vera.sessionTree.${workbenchId}`;
/** Collapsed parents of a workbench; parents start expanded (REQ-UX-f025500b). */
function readCollapsed(workbenchId: string | undefined): Set<string> {
  if (!workbenchId) return new Set();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(treeKey(workbenchId)) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}
type RowStatus = SessionSummary["status"] | "awaiting_question";
const rowStatus = (s: SessionSummary): RowStatus => (s.pendingQuestionId ? "awaiting_question" : s.status);
/** The child states a collapsed parent shows, most urgent first (REQ-UX-2feba215). */
const urgency = ["awaiting_question", "awaiting_approval", "error", "running"] as const;

export function SessionList({
  workbenchId,
  sessions,
  active,
  select,
  openLinked,
  create,
  rename,
  remove,
  archive,
  move,
  moveDisabled = false,
  disabled,
  search = "",
  searchChanged,
  searching = false,
  searchError,
}: {
  /** Keeps the collapsed parents of this workbench across restarts. */
  workbenchId?: string | undefined;
  sessions: SessionSummary[];
  active?: string | undefined;
  select: (id: string) => void;
  /** Opens a delegated child's Chat transcript, as the parent link in a child chat does. */
  openLinked?: ((id: string) => void) | undefined;
  create: () => void;
  rename: (id: string, title: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  archive: (id: string, archived: boolean) => Promise<boolean>;
  /** Moves a non-archived session one place; false when nothing moved. */
  move?: (id: string, offset: -1 | 1) => Promise<boolean>;
  /** The order cannot be saved, for example while the user settings are read-only. */
  moveDisabled?: boolean;
  disabled: boolean;
  search?: string;
  searchChanged?: (query: string) => void;
  searching?: boolean;
  searchError?: unknown;
}) {
  const { t, i18n } = useTranslation();
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.resolvedLanguage, i18n.language],
  );
  const [editing, setEditing] = useState<SessionSummary>();
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<SessionSummary>();
  const [advancedFor, setAdvancedFor] = useState<string>();
  const showAdvanced = useSettingsSnapshot().data?.settings.showAdvanced === true;
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const editOrigin = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<boolean>();
  const [exportError, setExportError] = useState<unknown>();
  useEffect(() => {
    if (sessions.some((s) => s.id === active && s.archived)) setShowArchived(true);
  }, [sessions, active]);
  function closeMenu(element: HTMLElement) {
    const menu = element.closest("details");
    const summary = menu?.querySelector("summary");
    if (menu) menu.open = false;
    summary?.focus();
    return summary ?? element;
  }
  async function exportTranscript(id: string, format: "md" | "json") {
    if (exporting) return;
    setExporting(true);
    setExportResult(undefined);
    setExportError(undefined);
    try {
      const result = await api.invoke("session.export", { sessionId: id, format });
      setExportResult(result.exported);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  }
  function finishEdit() {
    setEditing(undefined);
    if (editOrigin.current?.isConnected) editOrigin.current.focus();
    else newButton.current?.focus();
  }
  const editInput = useRef<HTMLInputElement>(null);
  const status = {
    idle: t("chat.idle"),
    running: t("chat.running"),
    awaiting_approval: t("chat.awaiting"),
    awaiting_question: t("question.waiting"),
    error: t("chat.error"),
  };
  useEffect(() => {
    if (deleting) {
      dialog.current?.showModal();
      dialog.current?.querySelector("button")?.focus();
    }
  }, [deleting]);
  useEffect(() => {
    if (editing) editInput.current?.focus();
  }, [editing]);
  function cancel() {
    dialog.current?.close();
    setDeleting(undefined);
    if (origin.current?.isConnected) origin.current.focus();
    else newButton.current?.focus();
  }
  const listed = sessions.filter((s) => !s.archived);
  const archivedSessions = sessions.filter((s) => s.archived);
  const listedTree = sessionTree(listed);
  const archivedTree = sessionTree(archivedSessions);
  const delegatedStatus = useDelegatedStatusLabels();
  const [collapsed, setCollapsed] = useState(() => readCollapsed(workbenchId));
  const saveCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    if (!workbenchId) return;
    // A full list drops the ids of deleted sessions; search results are partial and keep them.
    const kept = search.trim() ? [...next] : [...next].filter((id) => sessions.some((s) => s.id === id));
    try {
      localStorage.setItem(treeKey(workbenchId), JSON.stringify(kept));
    } catch {}
  };
  // Opening a child from activity, a notification, a link or search expands its parents once
  // (REQ-UX-3ff00682); the user can collapse them again while it stays open.
  const revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = sessions.find((s) => s.id === active);
    if (!current || revealed.current === current.id) return;
    revealed.current = current.id;
    const byId = new Map(sessions.filter((s) => s.archived === current.archived).map((s) => [s.id, s]));
    const next = new Set(collapsed);
    const seen = new Set<string>();
    for (let parent = visibleParent(current, byId); parent && !seen.has(parent); ) {
      seen.add(parent);
      next.delete(parent);
      const row = byId.get(parent);
      parent = row && visibleParent(row, byId);
    }
    if (next.size !== collapsed.size) saveCollapsed(next);
  });
  const section = useRef<HTMLElement>(null);
  // React may move the focused row's node while reordering, so focus is put back by id once the
  // list is current and enabled again.
  const refocus = useRef<{ id: string; menu: boolean } | null>(null);
  useEffect(() => {
    void sessions; // runs again once the reordered list arrives
    const target = refocus.current;
    if (!target || disabled) return;
    refocus.current = null;
    const row = section.current?.querySelector<HTMLElement>(`[data-session="${target.id}"]`);
    (target.menu ? row?.closest(".session-entry")?.querySelector<HTMLElement>("summary") : row)?.focus();
  }, [sessions, disabled]);
  // A session moves among its siblings: the rows under the same parent, or the top-level rows.
  const listedById = new Map(listed.map((row) => [row.id, row]));
  const siblingsOf = (s: SessionSummary) => {
    const parent = visibleParent(s, listedById);
    return parent ? (listedTree.children.get(parent) ?? []) : listedTree.roots;
  };
  const shift = (s: SessionSummary, offset: -1 | 1, menu: boolean) => {
    const siblings = siblingsOf(s);
    const index = siblings.indexOf(s);
    if (
      !move ||
      disabled ||
      moveDisabled ||
      index < 0 ||
      index + offset < 0 ||
      index + offset >= siblings.length
    )
      return;
    // Kept after a failed move too: the row then gets its focus back once it is enabled again.
    refocus.current = { id: s.id, menu };
    void move(s.id, offset);
  };
  const renderBranch = (s: SessionSummary, tree: Tree, nested = false): ReactNode => {
    const kids = tree.children.get(s.id) ?? [];
    const open = !collapsed.has(s.id);
    const group = `session-children-${s.id}`;
    return (
      <Fragment key={s.id}>
        {renderSession(s, kids, open, group, nested)}
        {kids.length > 0 && open && (
          // biome-ignore lint/a11y/useSemanticElements: A fieldset groups form controls; these are navigation rows named by their parent.
          <div
            role="group"
            id={group}
            className="session-children"
            data-session-children={s.id}
            aria-label={t("chat.childSessions", { title: s.title || t("chat.untitled") })}
          >
            {kids.map((kid) => renderBranch(kid, tree, true))}
          </div>
        )}
      </Fragment>
    );
  };
  const renderSession = (
    s: SessionSummary,
    kids: SessionSummary[],
    open: boolean,
    group: string,
    nested: boolean,
  ) => {
    const date = dateFormatter.format(new Date(s.updatedAt));
    const sessionStatus = rowStatus(s);
    // Search results and archived sessions keep their order.
    const movable = !!move && !s.archived && !search.trim();
    const siblings = movable ? siblingsOf(s) : [];
    const index = siblings.indexOf(s);
    const attention = !open
      ? urgency.find((state) => kids.some((kid) => rowStatus(kid) === state))
      : undefined;
    const attentionText =
      attention &&
      t("chat.childAttention", { status: attention === "error" ? status.error : status[attention] });
    const rowKeys = (menu: boolean) => (event: KeyboardEvent<HTMLElement>) => {
      const offset = movable ? reorderOffset(event) : undefined;
      if (!offset) return;
      event.preventDefault();
      shift(s, offset, menu);
    };
    return (
      <div
        className={`session-entry${kids.length ? " session-parent" : ""}${nested ? " session-child" : ""}`}
      >
        {kids.length > 0 && (
          <button
            type="button"
            className="session-toggle"
            data-session-toggle={s.id}
            aria-expanded={open}
            aria-controls={group}
            aria-label={t("chat.childSessions", { title: s.title || t("chat.untitled") })}
            onClick={() => {
              const next = new Set(collapsed);
              if (open) next.add(s.id);
              else next.delete(s.id);
              saveCollapsed(next);
            }}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          data-session={s.id}
          aria-current={s.id === active ? "page" : undefined}
          onClick={() => (nested && openLinked ? openLinked(s.id) : select(s.id))}
          onKeyDown={rowKeys(false)}
        >
          <strong>{s.title || t("chat.untitled")}</strong>
          <small>
            {attention && (
              <span
                className="session-activity session-child-attention"
                data-session-child-attention={attention}
                title={attentionText}
                aria-hidden="true"
              >
                {attention === "error" ? (
                  <CircleAlert aria-hidden="true" />
                ) : (
                  <ActivityIcon status={attention} />
                )}
              </span>
            )}
            {s.delegation && (
              <span className="session-delegated-status" data-delegated-status={s.delegation.status}>
                {delegatedStatus[s.delegation.status]}
              </span>
            )}
            {(sessionStatus === "running" ||
              sessionStatus === "awaiting_approval" ||
              sessionStatus === "awaiting_question") && (
              <span
                className="session-activity"
                data-session-activity={sessionStatus}
                title={status[sessionStatus]}
                aria-hidden="true"
              >
                <ActivityIcon status={sessionStatus} />
              </span>
            )}
            <time data-session-updated dateTime={s.updatedAt} title={t("chat.lastActivity", { date })}>
              {date}
            </time>
          </small>
          <span className="sr-only" data-session-status={sessionStatus}>
            {status[sessionStatus]}
          </span>
          {attentionText && <span className="sr-only">{attentionText}</span>}
        </button>
        <details
          className="session-options"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
            // The menu trigger and its items move the row as well.
            rowKeys(true)(event);
          }}
        >
          <summary aria-label={t("chat.actionsNamed", { title: s.title || t("chat.untitled") })}>
            <Ellipsis aria-hidden="true" />
          </summary>
          <div className="session-actions">
            {movable && (
              <>
                <button
                  type="button"
                  data-action="move-session-up"
                  disabled={disabled || moveDisabled || index <= 0}
                  onClick={(event) => {
                    closeMenu(event.currentTarget);
                    shift(s, -1, true);
                  }}
                >
                  {t("chat.moveUp")}
                </button>
                <button
                  type="button"
                  data-action="move-session-down"
                  disabled={disabled || moveDisabled || index >= siblings.length - 1}
                  onClick={(event) => {
                    closeMenu(event.currentTarget);
                    shift(s, 1, true);
                  }}
                >
                  {t("chat.moveDown")}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={exporting}
              onClick={(event) => {
                closeMenu(event.currentTarget);
                void exportTranscript(s.id, "md");
              }}
            >
              {t("chat.exportMarkdown")}
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={(event) => {
                closeMenu(event.currentTarget);
                void exportTranscript(s.id, "json");
              }}
            >
              {t("chat.exportJson")}
            </button>
            <button
              type="button"
              data-action={s.archived ? "restore-session" : "archive-session"}
              disabled={disabled || s.status === "running" || s.status === "awaiting_approval"}
              onClick={(event) => {
                closeMenu(event.currentTarget);
                void archive(s.id, !s.archived).then((ok) => {
                  if (ok) {
                    setShowArchived(true);
                    newButton.current?.focus();
                  }
                });
              }}
            >
              {s.archived ? t("chat.restore") : t("chat.archive")}
            </button>
            <button
              type="button"
              aria-label={t("chat.renameNamed", { title: s.title || t("chat.untitled") })}
              disabled={disabled || s.status === "running" || s.status === "awaiting_approval"}
              onClick={(event) => {
                editOrigin.current = closeMenu(event.currentTarget);
                setEditing(s);
                setTitle(s.title);
              }}
            >
              {t("chat.rename")}
            </button>
            {showAdvanced && (
              <button
                type="button"
                data-action="session-advanced"
                onClick={(event) => {
                  origin.current = closeMenu(event.currentTarget);
                  setAdvancedFor(s.id);
                }}
              >
                {t("advanced.session")}
              </button>
            )}
            <button
              type="button"
              aria-label={t("chat.deleteNamed", { title: s.title || t("chat.untitled") })}
              disabled={disabled || s.status === "running" || s.status === "awaiting_approval"}
              onClick={(e) => {
                origin.current = closeMenu(e.currentTarget);
                setDeleting(s);
              }}
            >
              {t("chat.delete")}
            </button>
          </div>
        </details>
        {advancedFor === s.id && showAdvanced && (
          <SessionAdvancedDialog
            sessionId={s.id}
            onClose={() => {
              setAdvancedFor(undefined);
              origin.current?.focus();
            }}
          />
        )}
        {editing?.id === s.id && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void rename(s.id, title).then((ok) => {
                if (ok) finishEdit();
              });
            }}
          >
            <label>
              {t("chat.title")}
              <input
                ref={editInput}
                value={title}
                maxLength={60}
                required
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button type="submit" disabled={disabled || !title.trim()}>
              {t("workbench.save")}
            </button>
            <button type="button" onClick={finishEdit}>
              {t("workbench.cancel")}
            </button>
          </form>
        )}
      </div>
    );
  };
  return (
    <section ref={section} className="session-list" aria-label={t("chat.sessions")}>
      <button ref={newButton} type="button" data-action="new-session" disabled={disabled} onClick={create}>
        {t("chat.new")}
      </button>
      {searchChanged && (
        <label>
          {t("chat.searchSessions")}
          <input
            type="search"
            value={search}
            maxLength={1000}
            onChange={(e) => searchChanged(e.target.value)}
          />
        </label>
      )}
      {searching && <p role="status">{t("home.loading")}</p>}
      {searchError != null && <ErrorMessage error={searchError} />}
      {!!search.trim() && !searching && searchError == null && sessions.length === 0 && (
        <p role="status">{t("chat.noSessions")}</p>
      )}
      {listedTree.roots.map((s) => renderBranch(s, listedTree))}
      {archivedSessions.length > 0 && (
        <details
          className="archived-sessions"
          open={showArchived}
          onToggle={(event) => setShowArchived(event.currentTarget.open)}
        >
          <summary>
            {t("chat.archived")} ({archivedSessions.length})
          </summary>
          {archivedTree.roots.map((s) => renderBranch(s, archivedTree))}
        </details>
      )}
      {exportResult !== undefined && (
        <p role="status">{exportResult ? t("chat.exported") : t("chat.exportCanceled")}</p>
      )}
      {exportError !== undefined && <ErrorMessage error={exportError} />}
      {deleting && (
        <dialog
          ref={dialog}
          className="pinned-dialog"
          aria-labelledby="delete-session-title"
          onCancel={(e) => {
            e.preventDefault();
            cancel();
          }}
        >
          <h3 id="delete-session-title">
            {t("chat.deleteConfirm", { title: deleting.title || t("chat.untitled") })}
          </h3>
          <div className="workbench-actions">
            <button type="button" onClick={cancel}>
              {t("workbench.cancel")}
            </button>
            <button
              type="button"
              data-action="confirm-delete"
              disabled={disabled}
              onClick={() =>
                void remove(deleting.id).then((ok) => {
                  if (ok) cancel();
                })
              }
            >
              {t("chat.delete")}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
