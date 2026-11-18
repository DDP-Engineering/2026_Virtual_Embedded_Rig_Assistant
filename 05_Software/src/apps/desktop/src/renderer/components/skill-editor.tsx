import { useQuery } from "@tanstack/react-query";
import type { SkillSummary } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

/** Instructions are editable only for workbench/user skills in a writable workbench. */
export function SkillEditor({
  skill,
  workbenchId,
  readOnly,
  template,
  close,
}: {
  skill: SkillSummary;
  workbenchId: string;
  readOnly: boolean;
  template: boolean;
  close: (saved: boolean) => void;
}) {
  const { t } = useTranslation();
  const session = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const editableSource = skill.source === "workbench" || skill.source === "user";
  const locked = readOnly || !editableSource;
  const target = { workbenchId, name: skill.name, source: skill.source };
  const loaded = useQuery({
    queryKey: ["skill.editor", workbenchId, skill.source, skill.name, session],
    queryFn: () => api.invoke("skills.open", target),
    retry: false,
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
  function finish(saved = false) {
    dialog.current?.close();
    close(saved);
  }
  async function save() {
    if (
      !loaded.data ||
      readOnly ||
      submitting.current ||
      (skill.source !== "workbench" && skill.source !== "user")
    )
      return;
    submitting.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await api.invoke("skills.save", {
        ...target,
        source: skill.source,
        content,
        sha256: loaded.data.sha256,
      });
      finish(true);
    } catch (failure) {
      setError(failure);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog skill-editor"
      aria-labelledby={`${session}-title`}
      onCancel={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!submitting.current) finish();
      }}
    >
      <form
        className="workbench-form"
        aria-busy={saving || loaded.isFetching}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }}
      >
        <header className="skills-toolbar">
          <h3 id={`${session}-title`}>{skill.name}/SKILL.md</h3>
          <div className="workbench-actions">
            <button type="button" disabled={saving} onClick={() => finish()}>
              {locked ? t("skills.close") : t("workbench.cancel")}
            </button>
            {!locked && (
              <button
                className="primary"
                type="submit"
                data-action="save-skill"
                disabled={!loaded.data || saving}
              >
                {error !== undefined ? t("settings.retry") : t("workbench.save")}
              </button>
            )}
          </div>
        </header>
        {locked && (
          <p role="status">{readOnly ? t("skills.readOnlyWorkbench") : t("skills.readOnlySource")}</p>
        )}
        {template && <p role="status">{t("skills.template")}</p>}
        <div role="status" aria-live="polite" className="skills-feedback">
          {saving ? t("skills.saving") : loaded.isFetching ? t("home.loading") : null}
        </div>
        {loaded.isError && (
          <div>
            <p>{t("skills.openFailed")}</p>
            <ErrorMessage error={loaded.error} />
            <button type="button" disabled={loaded.isFetching} onClick={() => void loaded.refetch()}>
              {t("settings.retry")}
            </button>
          </div>
        )}
        {error !== undefined && (
          <div>
            <p>{t("skills.saveFailed")}</p>
            <ErrorMessage error={error} />
          </div>
        )}
        <label htmlFor={`${session}-content`}>{t("skills.content")}</label>
        <textarea
          ref={input}
          id={`${session}-content`}
          data-skill-content
          rows={14}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={locked}
          disabled={!loaded.data || saving}
        />
      </form>
    </dialog>
  );
}
