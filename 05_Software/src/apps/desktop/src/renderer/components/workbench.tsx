import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkbenchSnapshot } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { SkillSettings } from "./skills.js";

export function Workbench({
  settingsReadOnly,
  active,
  changed,
  sessionPending = false,
}: {
  settingsReadOnly: boolean;
  active: WorkbenchSnapshot | undefined;
  changed: (active?: WorkbenchSnapshot, configOnly?: boolean) => void;
  sessionPending?: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const editButton = useRef<HTMLButtonElement>(null);
  const activeId = active?.config.id;
  const recent = useQuery({
    queryKey: ["workbench.recent"],
    queryFn: () => api.invoke("workbench.recent", {}),
  });
  useEffect(
    () =>
      api.subscribe("app", () => {
        void client.invalidateQueries({ queryKey: ["workbench.recent"] });
      }),
    [client],
  );
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const off = api.subscribe("workbench", activeId, (event) => {
      if (cancelled) return;
      if (event.type === "closed") {
        changed();
      } else if (event.type === "config.changed") {
        changed({ ...active, config: event.config, warnings: event.warnings }, true);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [activeId, active, changed]);
  useEffect(() => {
    void activeId; // A workbench switch closes the preceding editor draft.
    setEditing(false);
  }, [activeId]);
  async function perform(action: () => Promise<void>) {
    if (pending || sessionPending) return;
    setPending(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  async function open(path: string) {
    const snapshot = await api.invoke("workbench.open", { folder: path });
    changed(snapshot);
    await recent.refetch();
  }
  const warningLabels = {
    UNKNOWN_KEY: t("workbench.unknownKey"),
    UNKNOWN_NAME: t("workbench.unknownName"),
    NETWORK_SHARE_UNSUPPORTED: t("workbench.networkShare"),
    LOCK_GUARD_BUSY: t("workbench.lockGuard"),
  };
  return (
    <>
      {error !== undefined && <ErrorMessage error={error} />}
      {pending && <p role="status">{t("workbench.working")}</p>}
      {active ? (
        <section className="surface" data-workbench="active">
          <h3>{active.config.name}</h3>
          <p className="path-text">{active.folder}</p>
          {active.config.description && <p>{active.config.description}</p>}
          {active.readOnly && <p role="status">{t("workbench.readOnly")}</p>}
          {active.warnings.length > 0 && (
            <ul className="workbench-warnings">
              {active.warnings.map((warning, index) => (
                <li key={`${warning.code}:${warning.path ?? index}`}>
                  {warningLabels[warning.code]} {warning.path}
                </li>
              ))}
            </ul>
          )}
          <div className="workbench-actions">
            <SkillSettings workbenchId={active.config.id} readOnly={active.readOnly} />
            <button ref={editButton} type="button" data-action="edit-pinned" onClick={() => setEditing(true)}>
              {t("workbench.editPinned")}
            </button>
            <button
              type="button"
              data-action="close-workbench"
              disabled={pending}
              onClick={() =>
                void perform(async () => {
                  await api.invoke("workbench.close", {});
                  changed();
                })
              }
            >
              {t("workbench.close")}
            </button>
          </div>
          {editing && (
            <PinnedEditor
              workbench={active}
              close={() => {
                setEditing(false);
                editButton.current?.focus();
              }}
            />
          )}
        </section>
      ) : (
        <div className="welcome-grid">
          <section className="surface">
            <h3>{t("welcome.create")}</h3>
            <form
              className="workbench-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (folder)
                  void perform(async () => {
                    const snapshot = await api.invoke("workbench.create", { folder, name });
                    changed(snapshot);
                    await recent.refetch();
                  });
              }}
            >
              <label htmlFor="workbench-name">{t("workbench.name")}</label>
              <input
                id="workbench-name"
                maxLength={80}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                data-action="choose-create"
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    const result = await api.invoke("app.chooseFolder", {});
                    if (result.folder) setFolder(result.folder);
                  })
                }
              >
                {t("workbench.chooseFolder")}
              </button>
              {folder && (
                <p className="path-text" data-selected-folder>
                  {folder}
                </p>
              )}
              <button
                type="submit"
                data-action="create-workbench"
                disabled={pending || !folder || !name.trim()}
              >
                {t("welcome.create")}
              </button>
            </form>
          </section>
          <section className="surface">
            <h3>{t("welcome.open")}</h3>
            <p className="muted">{t("workbench.openDescription")}</p>
            <button
              type="button"
              data-action="open-workbench"
              disabled={pending}
              onClick={() =>
                void perform(async () => {
                  const result = await api.invoke("app.chooseFolder", {});
                  if (result.folder) await open(result.folder);
                })
              }
            >
              {t("workbench.openFolder")}
            </button>
          </section>
        </div>
      )}
      <section className="surface">
        <h3>{t("welcome.recent")}</h3>
        {recent.isPending && <p role="status">{t("workbench.working")}</p>}
        {recent.isError && (
          <>
            <ErrorMessage error={recent.error} />
            <button type="button" onClick={() => void recent.refetch()}>
              {t("settings.retry")}
            </button>
          </>
        )}
        {recent.data?.length === 0 && <p className="muted">{t("workbench.noRecent")}</p>}
        <ul className="recent-workbenches">
          {recent.data?.map((entry) => (
            <li key={entry.folder} data-recent={entry.missing ? "missing" : "present"}>
              <div>
                <strong>{entry.name}</strong>
                <p className="path-text">{entry.folder}</p>
                {entry.missing && <p>{t("workbench.missing")}</p>}
              </div>
              <div className="workbench-actions">
                <button
                  type="button"
                  data-action="open-recent"
                  aria-label={t("workbench.openNamed", { name: entry.name })}
                  disabled={pending || entry.missing}
                  onClick={() => void perform(() => open(entry.folder))}
                >
                  {t("workbench.openRecent")}
                </button>
                <button
                  type="button"
                  data-action="remove-recent"
                  aria-label={t("workbench.removeNamed", { name: entry.name })}
                  disabled={pending || settingsReadOnly}
                  onClick={() =>
                    void perform(async () => {
                      await api.invoke("workbench.recent", { remove: entry.folder });
                      await recent.refetch();
                    })
                  }
                >
                  {t("workbench.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function PinnedEditor({ workbench, close }: { workbench: WorkbenchSnapshot; close: () => void }) {
  const { t } = useTranslation();
  const session = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const pinned = useQuery({
    queryKey: ["workbench.pinned", workbench.folder, workbench.config.id, session],
    queryFn: () => api.invoke("workbench.pinned.get", {}),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    if (pinned.data) {
      setContent(pinned.data.content);
      input.current?.focus();
    }
  }, [pinned.data]);
  function finish() {
    dialog.current?.close();
    close();
  }
  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await api.invoke("workbench.pinned.update", { content });
      finish();
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog"
      aria-labelledby="pinned-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) finish();
      }}
    >
      <form
        className="workbench-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3 id="pinned-title">{t("workbench.pinnedTitle")}</h3>
        {pinned.isPending && <p role="status">{t("workbench.working")}</p>}
        {pinned.isError && (
          <>
            <ErrorMessage error={pinned.error} />
            <button type="button" onClick={() => void pinned.refetch()}>
              {t("settings.retry")}
            </button>
          </>
        )}
        {error !== undefined && <ErrorMessage error={error} />}
        {workbench.readOnly && <p>{t("workbench.readOnly")}</p>}
        <label htmlFor="pinned-content">{t("workbench.pinnedTitle")}</label>
        <textarea
          ref={input}
          id="pinned-content"
          rows={14}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={workbench.readOnly}
          disabled={!pinned.data || saving}
        />
        {new TextEncoder().encode(content).byteLength > 16384 && (
          <p role="status">{t("workbench.pinnedOversized")}</p>
        )}
        <div className="workbench-actions">
          <button type="button" disabled={saving} onClick={finish}>
            {t("workbench.cancel")}
          </button>
          <button
            type="submit"
            data-action="save-pinned"
            disabled={saving || workbench.readOnly || !pinned.data}
          >
            {t("workbench.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
