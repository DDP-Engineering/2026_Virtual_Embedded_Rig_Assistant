// REQ-UX-4bea0001
import type { SessionSummary } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../error-message.js";

export function SessionList({
  sessions,
  active,
  select,
  create,
  rename,
  remove,
  disabled,
  search = "",
  searchChanged,
  searching = false,
  searchError,
}: {
  sessions: SessionSummary[];
  active?: string | undefined;
  select: (id: string) => void;
  create: () => void;
  rename: (id: string, title: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  disabled: boolean;
  search?: string;
  searchChanged?: (query: string) => void;
  searching?: boolean;
  searchError?: unknown;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<SessionSummary>();
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<SessionSummary>();
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const editOrigin = useRef<HTMLButtonElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
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
  return (
    <section className="session-list" aria-label={t("chat.sessions")}>
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
      {sessions.map((s) => (
        <div key={s.id} className="session-entry">
          <button
            type="button"
            data-session={s.id}
            aria-current={s.id === active ? "page" : undefined}
            onClick={() => select(s.id)}
          >
            <strong>{s.title || t("chat.untitled")}</strong>
            <small data-session-status={s.status}>{status[s.status]}</small>
          </button>
          <div className="session-actions">
            <button
              type="button"
              aria-label={t("chat.renameNamed", { title: s.title || t("chat.untitled") })}
              disabled={disabled || s.status === "running" || s.status === "awaiting_approval"}
              onClick={(event) => {
                editOrigin.current = event.currentTarget;
                setEditing(s);
                setTitle(s.title);
              }}
            >
              {t("chat.rename")}
            </button>
            <button
              type="button"
              aria-label={t("chat.deleteNamed", { title: s.title || t("chat.untitled") })}
              disabled={disabled || s.status === "running" || s.status === "awaiting_approval"}
              onClick={(e) => {
                origin.current = e.currentTarget;
                setDeleting(s);
              }}
            >
              {t("chat.delete")}
            </button>
          </div>
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
      ))}
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
