import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SkillSummary } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";

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
/** Workbench and user skills open in the editor; plugin skills belong to the installed plugin. */
type EditableSkill = SkillSummary & { source: "workbench" | "user" };
const editable = (skill: SkillSummary): skill is EditableSkill =>
  skill.source === "workbench" || skill.source === "user";

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
  function finish() {
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
      <h2 id={titleId}>{t("skills.settings")}</h2>
      <SkillsPanel workbenchId={workbenchId} readOnly={readOnly} />
      <button type="button" onClick={finish}>
        {t("workbench.cancel")}
      </button>
    </dialog>
  );
}
/**
 * The workbench's skills: creating one on the left, the list on the right (enable, open SKILL.md),
 * one page at a time. Shown in the workbench editor's Skills section and inside the skills dialog.
 */
export function SkillsPanel({ workbenchId, readOnly }: { workbenchId: string; readOnly: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const formId = useId();
  const [name, setName] = useState("");
  const [source, setSource] = useState<"workbench" | "user">("workbench");
  const [editing, setEditing] = useState<EditableSkill>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const skills = useQuery({
    queryKey: ["skills", workbenchId],
    queryFn: () => api.invoke("skills.list", { workbenchId }),
  });
  const { rows, pager } = usePaged(skills.data ?? []);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["skills", workbenchId] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="skills-panel" data-skills-panel>
      <div className="skills-panel-side">
        {readOnly && <p role="status">{t("workbench.readOnly")}</p>}
        {(error !== undefined || skills.isError) && <ErrorMessage error={error ?? skills.error} />}
        <form
          className="workbench-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await api.invoke("skills.create", { workbenchId, name, source });
              setName("");
            });
          }}
        >
          <label htmlFor={`${formId}-name`}>{t("skills.name")}</label>
          <input
            id={`${formId}-name`}
            data-skill-name
            required
            pattern="[a-z0-9-]{1,64}"
            maxLength={64}
            value={name}
            disabled={busy || readOnly}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor={`${formId}-source`}>{t("skills.source")}</label>
          <select
            id={`${formId}-source`}
            value={source}
            disabled={busy || readOnly}
            onChange={(event) => setSource(event.target.value as "workbench" | "user")}
          >
            <option value="workbench">{t("skills.workbench")}</option>
            <option value="user">{t("skills.user")}</option>
          </select>
          <button
            type="submit"
            data-action="create-skill"
            className="primary"
            disabled={busy || readOnly || !/^[a-z0-9-]{1,64}$/.test(name)}
          >
            {t("skills.create")}
          </button>
        </form>
        <button type="button" disabled={busy} onClick={() => void skills.refetch()}>
          {t("settings.retry")}
        </button>
      </div>
      <div className="skills-panel-list">
        {skills.isPending && <p role="status">{t("home.loading")}</p>}
        {skills.data?.length === 0 && <p className="muted">{t("chat.noSkills")}</p>}
        <ul className="skills-list">
          {rows.map((skill) => (
            <li key={skill.name} className="workbench-tool-option" data-skill={skill.name}>
              <input
                type="checkbox"
                aria-label={t("skills.enabledNamed", { name: skill.name })}
                checked={skill.enabled}
                disabled={busy || readOnly}
                onChange={(event) =>
                  void perform(() =>
                    api.invoke("skills.toggle", {
                      workbenchId,
                      name: skill.name,
                      enabled: event.target.checked,
                    }),
                  )
                }
              />
              <span className="skill-text">
                <strong>{skill.name}</strong>{" "}
                <span className="muted">
                  {skill.source === "plugin"
                    ? t("skills.plugin", { plugin: skill.plugin ?? "" })
                    : skill.source === "official"
                      ? t("skills.official")
                      : t(sourceKeys[skill.source === "workbench" ? 0 : 1])}
                </span>
                {skill.description && <span className="muted skill-description">{skill.description}</span>}
                {skill.error && <span role="status">{t(errorKeys[errorIndex[skill.error]])}</span>}
              </span>
              {editable(skill) && (
                <button
                  type="button"
                  disabled={busy}
                  data-action="open-skill"
                  aria-label={t("skills.openNamed", { name: skill.name })}
                  onClick={(event) => {
                    editorTrigger.current = event.currentTarget;
                    setEditing(skill);
                  }}
                >
                  {t("skills.open")}
                </button>
              )}
            </li>
          ))}
        </ul>
        <Pager {...pager} />
      </div>
      {editing && (
        <SkillEditor
          key={`${editing.source}:${editing.name}`}
          skill={editing}
          workbenchId={workbenchId}
          readOnly={readOnly}
          close={() => {
            setEditing(undefined);
            editorTrigger.current?.focus();
            void client.invalidateQueries({ queryKey: ["skills", workbenchId] });
          }}
        />
      )}
    </div>
  );
}
function SkillEditor({
  skill,
  workbenchId,
  readOnly,
  close,
}: {
  skill: EditableSkill;
  workbenchId: string;
  readOnly: boolean;
  close: () => void;
}) {
  const { t } = useTranslation();
  const session = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const target = { workbenchId, name: skill.name, source: skill.source };
  const loaded = useQuery({
    queryKey: ["skill.editor", workbenchId, skill.source, skill.name, session],
    queryFn: () => api.invoke("skills.open", target),
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
    if (loaded.data) {
      setContent(loaded.data.content);
      input.current?.focus();
    }
  }, [loaded.data]);
  const titleId = `${session}-title`;
  function finish() {
    dialog.current?.close();
    close();
  }
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!saving) finish();
      }}
    >
      <form
        className="workbench-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!loaded.data || readOnly) return;
          setSaving(true);
          setError(undefined);
          void api
            .invoke("skills.save", { ...target, content, sha256: loaded.data.sha256 })
            .then(finish)
            .catch(setError)
            .finally(() => setSaving(false));
        }}
      >
        <h3 id={titleId}>{skill.name}/SKILL.md</h3>
        {loaded.isPending && <p role="status">{t("home.loading")}</p>}
        {(error !== undefined || loaded.isError) && <ErrorMessage error={error ?? loaded.error} />}
        {loaded.isError && (
          <button type="button" onClick={() => void loaded.refetch()}>
            {t("settings.retry")}
          </button>
        )}
        <label htmlFor={`${session}-content`}>{t("skills.content")}</label>
        <textarea
          ref={input}
          id={`${session}-content`}
          data-skill-content
          rows={14}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={readOnly}
          disabled={!loaded.data || saving}
        />
        <div className="workbench-actions">
          <button type="button" disabled={saving} onClick={finish}>
            {t("workbench.cancel")}
          </button>
          <button type="submit" data-action="save-skill" disabled={readOnly || !loaded.data || saving}>
            {t("workbench.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
