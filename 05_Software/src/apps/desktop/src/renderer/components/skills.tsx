import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type SkillSummary, skillNameSchema } from "@vera/shared";
import { Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";
import { SkillEditor } from "./skill-editor.js";

function defineTranslationKeys<const T extends readonly string[]>(keys: T): T {
  return keys;
}
const sourceKeys = defineTranslationKeys(["skills.workbench", "skills.user"]);
const errorKeys = defineTranslationKeys([
  "skills.errors.name",
  "skills.errors.description",
  "skills.errors.frontmatter",
  "skills.errors.unavailable",
]);
const errorIndex = { name: 0, description: 1, frontmatter: 2, unavailable: 3 } as const;

export function SkillSettings({ workbenchId, readOnly }: { workbenchId: string; readOnly: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void workbenchId;
    setOpen(false);
  }, [workbenchId]);
  return (
    <>
      <button ref={trigger} type="button" data-action="skills-settings" onClick={() => setOpen(true)}>
        {t("skills.settings")}
      </button>
      {open && (
        <SkillsDialog
          key={workbenchId}
          workbenchId={workbenchId}
          readOnly={readOnly}
          close={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}
function SkillsDialog({
  workbenchId,
  readOnly,
  close,
}: {
  workbenchId: string;
  readOnly: boolean;
  close: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  function finish() {
    if (busy) return;
    dialog.current?.close();
    close();
  }
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog skills-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        finish();
      }}
    >
      <header className="skills-toolbar">
        <h2 id={titleId}>{t("skills.settings")}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t("skills.close")}
          title={t("skills.close")}
          disabled={busy}
          onClick={finish}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <SkillsPanel workbenchId={workbenchId} readOnly={readOnly} busyChanged={setBusy} />
    </dialog>
  );
}

/** Shared immediate-save skill management for the workbench editor and session dialog. */
export function SkillsPanel({
  workbenchId,
  readOnly,
  busyChanged,
}: {
  workbenchId: string;
  readOnly: boolean;
  busyChanged?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const formId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreCreateFocus = useRef(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"workbench" | "user">("workbench");
  const [editing, setEditing] = useState<{ skill: SkillSummary; template: boolean }>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; retry: () => Promise<unknown> }>();
  const [notice, setNotice] = useState("");
  const skills = useQuery({
    queryKey: ["skills", workbenchId],
    queryFn: () => api.invoke("skills.list", { workbenchId }),
    retry: false,
  });
  const { rows, pager } = usePaged(skills.data ?? []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    busyChanged?.(busy);
  }, [busy, busyChanged]);
  useEffect(() => {
    if (creating) nameInput.current?.focus();
    else if (restoreCreateFocus.current) {
      createTrigger.current?.focus();
      restoreCreateFocus.current = false;
    }
  }, [creating]);
  async function perform(action: () => Promise<unknown>) {
    if (submitting.current || readOnly) return;
    submitting.current = true;
    setBusy(true);
    setFailure(undefined);
    setNotice("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["skills", workbenchId] });
    } catch (error) {
      if (mounted.current) setFailure({ error, retry: action });
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function cancelCreation() {
    if (submitting.current) return;
    restoreCreateFocus.current = true;
    setCreating(false);
    setName("");
    setFailure(undefined);
  }
  async function refresh() {
    setNotice("");
    const result = await skills.refetch();
    if (!result.isError && mounted.current) setNotice(t("skills.refreshed"));
  }
  const disabled = busy || skills.isFetching;
  return (
    <div ref={panel} className="skills-panel" data-skills-panel>
      <p id={`${formId}-activation`}>{t("skills.explanation")}</p>
      {readOnly && <p role="status">{t("skills.readOnlyWorkbench")}</p>}
      <div className="skills-toolbar">
        <button
          ref={createTrigger}
          type="button"
          data-action="new-skill"
          disabled={readOnly || disabled || creating}
          title={readOnly ? t("skills.readOnlyWorkbench") : undefined}
          onClick={() => {
            setFailure(undefined);
            setNotice("");
            setCreating(true);
          }}
        >
          <Plus aria-hidden="true" /> {t("skills.new")}
        </button>
        <button
          type="button"
          className="icon-button"
          data-action="refresh-skills"
          disabled={disabled}
          aria-label={t("skills.refresh")}
          title={t("skills.refresh")}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>
      <div role="status" aria-live="polite" className="skills-feedback">
        {busy ? t("skills.saving") : skills.isFetching ? t("skills.loading") : notice}
      </div>
      {failure && (
        <div role="alert">
          <p>{t("skills.actionFailed")}</p>
          <ErrorMessage error={failure.error} />
          <button type="button" disabled={disabled || readOnly} onClick={() => void perform(failure.retry)}>
            {t("settings.retry")}
          </button>
        </div>
      )}
      {creating && (
        <form
          className="workbench-form skill-create"
          aria-busy={busy}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelCreation();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!skillNameSchema.safeParse(name).success) return;
            void perform(async () => {
              await api.invoke("skills.create", { workbenchId, name, source });
              if (!mounted.current) return;
              setCreating(false);
              setName("");
              editorTrigger.current = createTrigger.current;
              setEditing({ skill: { name, source, description: "", enabled: true }, template: true });
            });
          }}
        >
          <p id={`${formId}-name-help`}>{t("skills.nameHelp")}</p>
          <label htmlFor={`${formId}-name`}>{t("skills.name")}</label>
          <input
            ref={nameInput}
            id={`${formId}-name`}
            data-skill-name
            required
            pattern="[a-z0-9-]{1,64}"
            maxLength={64}
            value={name}
            aria-describedby={`${formId}-name-help`}
            aria-invalid={name.length > 0 && !skillNameSchema.safeParse(name).success}
            disabled={busy || readOnly}
            onChange={(event) => {
              setName(event.target.value);
              setFailure(undefined);
            }}
          />
          <label htmlFor={`${formId}-source`}>{t("skills.source")}</label>
          <select
            id={`${formId}-source`}
            data-skill-source
            value={source}
            disabled={busy || readOnly}
            aria-describedby={`${formId}-scope`}
            onChange={(event) => {
              setSource(event.target.value as "workbench" | "user");
              setFailure(undefined);
            }}
          >
            <option value="workbench">{t("skills.locationWorkbench")}</option>
            <option value="user">{t("skills.locationUser")}</option>
          </select>
          <p id={`${formId}-scope`}>
            {source === "workbench" ? t("skills.scopeWorkbench") : t("skills.scopeUser")}
          </p>
          <div className="workbench-actions">
            <button type="button" disabled={busy} onClick={cancelCreation}>
              {t("workbench.cancel")}
            </button>
            <button
              type="submit"
              data-action="create-skill"
              className="primary"
              aria-describedby={`${formId}-name-help`}
              disabled={busy || readOnly || !skillNameSchema.safeParse(name).success}
            >
              {t("skills.create")}
            </button>
          </div>
        </form>
      )}
      <div className="skills-panel-list" aria-busy={skills.isFetching || busy}>
        {skills.isError && (
          <div role="alert">
            <p>{t("skills.listFailed")}</p>
            <ErrorMessage error={skills.error} />
            <button type="button" disabled={disabled} onClick={() => void refresh()}>
              {t("settings.retry")}
            </button>
          </div>
        )}
        {skills.data?.length === 0 && <p className="muted">{t("chat.noSkills")}</p>}
        <ul className="skills-list">
          {rows.map((skill) => {
            const editable = !readOnly && (skill.source === "workbench" || skill.source === "user");
            return (
              <li key={skill.name} data-skill={skill.name}>
                <span className="skill-text">
                  <strong>{skill.name}</strong>
                  <span className="skill-source">
                    {skill.source === "plugin"
                      ? t("skills.plugin", { plugin: skill.plugin ?? "" })
                      : skill.source === "official"
                        ? t("skills.official")
                        : t(sourceKeys[skill.source === "workbench" ? 0 : 1])}
                  </span>
                  {skill.description && <span className="muted skill-description">{skill.description}</span>}
                  {skill.error && <span role="status">{t(errorKeys[errorIndex[skill.error]])}</span>}
                </span>
                <div className="skill-actions">
                  <label className="skill-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-checked={skill.enabled}
                      aria-label={t("skills.enabledNamed", { name: skill.name })}
                      aria-describedby={`${formId}-activation`}
                      checked={skill.enabled}
                      disabled={busy || readOnly}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        void perform(async () => {
                          await api.invoke("skills.toggle", { workbenchId, name: skill.name, enabled });
                          if (mounted.current) setNotice(t("skills.activationSaved"));
                        });
                      }}
                    />
                    {skill.enabled ? t("skills.enabled") : t("skills.disabled")}
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    data-action="open-skill"
                    aria-label={
                      editable
                        ? t("skills.editNamed", { name: skill.name })
                        : t("skills.viewNamed", { name: skill.name })
                    }
                    onClick={(event) => {
                      editorTrigger.current = event.currentTarget;
                      setEditing({ skill, template: false });
                    }}
                  >
                    {editable ? t("skills.edit") : t("skills.view")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <Pager {...pager} />
      </div>
      {editing && (
        <SkillEditor
          key={`${editing.skill.source}:${editing.skill.name}`}
          skill={editing.skill}
          template={editing.template}
          workbenchId={workbenchId}
          readOnly={readOnly}
          close={(saved) => {
            setEditing(undefined);
            if (saved) setNotice(t("skills.saved"));
            const row = [...(panel.current?.querySelectorAll<HTMLElement>("[data-skill]") ?? [])].find(
              (node) => node.dataset.skill === editing.skill.name,
            );
            (
              row?.querySelector<HTMLButtonElement>("[data-action=open-skill]") ?? editorTrigger.current
            )?.focus();
            void client.invalidateQueries({ queryKey: ["skills", workbenchId] });
          }}
        />
      )}
    </div>
  );
}
