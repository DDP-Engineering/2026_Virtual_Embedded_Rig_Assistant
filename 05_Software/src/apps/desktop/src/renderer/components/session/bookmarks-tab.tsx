// REQ-UX-8a37ed29 REQ-UX-53130782 REQ-FUNC-10d85a47 REQ-UX-dc45c39a REQ-FUNC-d65a3585 REQ-SEC-8c0cc59a
import type { SessionState } from "@vera/shared";
import { Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionView } from "../../hooks/session-view.js";
import { CHAT, useDocumentTabs } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";
import { useBookmarkJump, useSessionBookmarks } from "./session-bookmarks.js";
import { previewText } from "./transcript-navigation.js";

type Row = { id: string; ordinal: number; text: string; reply: string | undefined };
const NONE: readonly string[] = [];

/** User messages in conversation order with the first reply bound to each, as the rail shows them. */
function userRows(state: SessionState): Row[] {
  const rows = new Map<string, Row>();
  for (const item of state.items)
    if (item.kind === "user")
      rows.set(item.id, { id: item.id, ordinal: rows.size + 1, text: item.text, reply: undefined });
    else if (item.kind === "assistant" && item.text)
      for (const id of item.replyToMessageIds ?? []) {
        const row = rows.get(id);
        if (row && row.reply === undefined) row.reply = item.text;
      }
  return [...rows.values()];
}

/** The current session's bookmarks; keyed by session so rows, filter and selection never carry over. */
export function BookmarksTab({
  sessionId,
  readOnly,
  archived,
}: {
  sessionId: string;
  readOnly: boolean;
  archived: boolean;
}) {
  return <BookmarksView key={sessionId} sessionId={sessionId} locked={readOnly || archived} />;
}

function BookmarksView({ sessionId, locked }: { sessionId: string; locked: boolean }) {
  const { t } = useTranslation();
  const { view, error, retry } = useSessionView(sessionId);
  const bookmarks = useSessionBookmarks(sessionId, view?.state.bookmarkedMessageIds ?? NONE, locked);
  const { requestJump } = useBookmarkJump(sessionId);
  const tabs = useDocumentTabs();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = useMemo(() => (view ? userRows(view.state) : []), [view]);
  const all = rows.filter((row) => bookmarks.has(row.id));
  const needle = filter.trim().toLocaleLowerCase();
  const shown = needle
    ? all.filter(
        (row) =>
          row.text.toLocaleLowerCase().includes(needle) || !!row.reply?.toLocaleLowerCase().includes(needle),
      )
    : all;
  const chosen = all.filter((row) => selected.has(row.id)).map((row) => row.id);
  const allShownSelected = shown.length > 0 && shown.every((row) => selected.has(row.id));
  useEffect(() => {
    if (!confirming) return;
    dialog.current?.showModal();
    dialog.current?.querySelector("button")?.focus();
  }, [confirming]);
  const open = (id: string) => {
    tabs?.select(CHAT);
    requestJump?.(id);
  };
  const remove = (ids: readonly string[] | "all") => {
    bookmarks.remove(ids);
    setSelected((current) =>
      ids === "all" ? new Set() : new Set([...current].filter((id) => !ids.includes(id))),
    );
  };
  const closeDialog = () => {
    dialog.current?.close();
    setConfirming(false);
  };
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-bookmark-row]") ?? [])];
    const index = buttons.indexOf(event.currentTarget);
    const next =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  };
  if (error !== undefined)
    return (
      <section className="bookmarks-tab" aria-label={t("panel.bookmarks")}>
        <ErrorMessage error={error} />
        <button type="button" onClick={retry}>
          {t("settings.retry")}
        </button>
      </section>
    );
  if (!view)
    return (
      <section className="bookmarks-tab" aria-label={t("panel.bookmarks")}>
        <p role="status">{t("home.loading")}</p>
      </section>
    );
  return (
    <section className="bookmarks-tab" aria-label={t("panel.bookmarks")}>
      <div className="bookmarks-controls">
        <input
          type="search"
          data-bookmarks-filter
          aria-label={t("bookmarks.filter")}
          placeholder={t("bookmarks.filter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <p role="status" data-bookmarks-count>
          {needle
            ? t("bookmarks.countFiltered", { shown: shown.length, total: all.length })
            : t("bookmarks.count", { count: all.length })}
        </p>
      </div>
      {!locked && all.length > 0 && (
        <div className="bookmarks-actions">
          <label>
            <input
              type="checkbox"
              data-action="bookmarks-select-all"
              checked={allShownSelected}
              disabled={shown.length === 0}
              onChange={(event) => {
                const checked = event.target.checked;
                setSelected((current) => {
                  const next = new Set(current);
                  for (const row of shown) {
                    if (checked) next.add(row.id);
                    else next.delete(row.id);
                  }
                  return next;
                });
              }}
            />
            <span>{t("bookmarks.selectAll")}</span>
          </label>
          <button
            type="button"
            data-action="bookmarks-remove-selected"
            disabled={chosen.length === 0}
            onClick={() => remove(chosen)}
          >
            {t("bookmarks.removeSelected")}
          </button>
          <button type="button" data-action="bookmarks-clear-all" onClick={() => setConfirming(true)}>
            {t("bookmarks.clearAll")}
          </button>
        </div>
      )}
      {bookmarks.error !== undefined && <ErrorMessage error={bookmarks.error} />}
      {all.length === 0 ? (
        <p className="muted" data-bookmarks-empty>
          {t("bookmarks.empty")}
        </p>
      ) : shown.length === 0 ? (
        <p className="muted" data-bookmarks-no-matches>
          {t("bookmarks.noMatches")}
        </p>
      ) : (
        <ul className="bookmarks-list" ref={list} aria-label={t("panel.bookmarks")}>
          {shown.map((row) => {
            const text = previewText(row.text) || t("chat.navigator.empty");
            const reply = row.reply ? previewText(row.reply) : "";
            return (
              <li key={row.id} data-bookmark-id={row.id}>
                {!locked && (
                  <input
                    type="checkbox"
                    data-bookmark-select={row.id}
                    aria-label={t("bookmarks.select", { ordinal: row.ordinal })}
                    checked={selected.has(row.id)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      });
                    }}
                  />
                )}
                <button
                  type="button"
                  className="bookmark-row"
                  data-bookmark-row={row.id}
                  aria-label={t("bookmarks.open", { ordinal: row.ordinal, text })}
                  onClick={() => open(row.id)}
                  onKeyDown={move}
                >
                  <span className="bookmark-text">{text}</span>
                  {reply && <span className="bookmark-reply">{reply}</span>}
                </button>
                {!locked && (
                  <button
                    type="button"
                    className="icon-button"
                    data-bookmark-remove={row.id}
                    aria-label={t("bookmarks.remove", { ordinal: row.ordinal })}
                    title={t("bookmarks.remove", { ordinal: row.ordinal })}
                    disabled={bookmarks.busy(row.id)}
                    onClick={() => remove([row.id])}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirming && (
        <dialog
          ref={dialog}
          className="pinned-dialog"
          aria-labelledby="clear-bookmarks-title"
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
        >
          <h3 id="clear-bookmarks-title">{t("bookmarks.clearConfirm", { count: all.length })}</h3>
          <div className="workbench-actions">
            <button type="button" onClick={closeDialog}>
              {t("workbench.cancel")}
            </button>
            <button
              type="button"
              data-action="confirm-clear-bookmarks"
              onClick={() => {
                remove("all");
                closeDialog();
              }}
            >
              {t("bookmarks.clearAll")}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
