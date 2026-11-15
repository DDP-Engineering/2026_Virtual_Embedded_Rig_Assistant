import { useQueryClient } from "@tanstack/react-query";
import {
  documentFolderPattern,
  type WorkbenchConfig,
  type WorkbenchInspection,
  type WorkbenchSnapshot,
  workbenchSchema,
  workbenchTemplate,
} from "@vera/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { WorkbenchConfigForm } from "./workbench-config-form.js";

/** Defaults for the draft; the real identity is assigned when the workbench is created. */
const draftDefaults = () => workbenchSchema.parse({ format: 1, id: `wb_0${"0".repeat(25)}`, name: "draft" });
const lines = (value: readonly string[]) => value.map((s) => s.trim()).filter(Boolean);

export function WorkbenchCreate({
  created,
  busy = false,
  shown = true,
}: {
  created: (snapshot: WorkbenchSnapshot) => void;
  busy?: boolean;
  /** While hidden the draft is kept but its fields are not rendered, so element ids stay unique. */
  shown?: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [inspection, setInspection] = useState<WorkbenchInspection>();
  const [name, setName] = useState("");
  const [config, setConfig] = useState<WorkbenchConfig>(draftDefaults);
  const [instructions, setInstructions] = useState<string>();
  const [skillsDisabled, setSkillsDisabled] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const disabled = pending || busy;
  async function perform(action: () => Promise<void>) {
    if (disabled) return;
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
  async function done(snapshot: WorkbenchSnapshot) {
    created(snapshot);
    await client.invalidateQueries({ queryKey: ["workbench.recent"] });
  }
  const kept = inspection?.instructions ?? null;
  const shownInstructions = kept ?? instructions ?? workbenchTemplate(name.trim() || inspection?.name || "");
  function create() {
    if (!inspection || inspection.existing || !name.trim()) return;
    return perform(async () => {
      const snapshot = await api.invoke("workbench.create", {
        folder: inspection.folder,
        name,
        config: {
          description: config.description ?? "",
          docs: { include: lines(config.docs.include), exclude: lines(config.docs.exclude) },
          embeddings: config.embeddings,
          retrieval: { results: config.retrieval.results, mode: config.retrieval.mode },
          agent: config.agent,
          tools: { disabled: config.tools.disabled },
          skills: { disabled: skillsDisabled },
          plugins: { enabled: config.plugins.enabled },
          chat: { detail: config.chat.detail },
        },
        ...(kept === null ? { instructions: shownInstructions } : {}),
      });
      await done(snapshot);
    });
  }
  const generalFields = (
    <>
      <div className="create-folder">
        <span className="create-label">{t("create.folder")}</span>
        {inspection ? (
          <span className="path-text" data-selected-folder>
            {inspection.folder}
          </span>
        ) : (
          <span className="muted">{t("create.noFolder")}</span>
        )}
        <button
          type="button"
          data-action="choose-create"
          disabled={disabled}
          onClick={() =>
            void perform(async () => {
              const result = await api.invoke("app.chooseFolder", {});
              if (!result.folder) return;
              const found = await api.invoke("workbench.inspect", { folder: result.folder });
              if (!found.existing) {
                // Detected documentation folders become the draft selection; none, or a failed scan
                // (shown again in the Documents section), keeps the defaults.
                const scan = await client
                  .fetchQuery({
                    queryKey: ["workbench.scanDocs", found.folder],
                    queryFn: () => api.invoke("workbench.scanDocs", { folder: found.folder }),
                    staleTime: 0,
                  })
                  .catch(() => undefined);
                setConfig((current) => ({
                  ...current,
                  docs: {
                    ...current.docs,
                    include: scan?.folders.length
                      ? scan.folders.map((entry) => documentFolderPattern(entry.path))
                      : draftDefaults().docs.include,
                  },
                }));
              }
              setInspection(found);
              setName((current) => (current.trim() ? current : found.name.slice(0, 80)));
              setSkillsDisabled([]);
            })
          }
        >
          {t("workbench.chooseFolder")}
        </button>
      </div>
      {inspection?.existing && (
        <div role="status" data-existing-workbench>
          <p>{t("create.existing")}</p>
          <button
            type="button"
            data-action="open-existing"
            disabled={disabled}
            onClick={() =>
              void perform(async () => {
                await done(await api.invoke("workbench.open", { folder: inspection.folder }));
              })
            }
          >
            {t("create.openExisting")}
          </button>
        </div>
      )}
      <label htmlFor="workbench-name">
        {t("workbench.name")}
        <input
          id="workbench-name"
          maxLength={80}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={disabled}
        />
      </label>
    </>
  );
  // Until a new folder is chosen only General (folder and name) is available.
  const ready = !!inspection && !inspection.existing;
  return (
    <section className="surface workbench-create" data-workbench-create>
      <header>
        <h3>{name.trim() || t("projects.new")}</h3>
        <div className="workbench-actions">
          <button
            type="button"
            data-action="create-workbench"
            disabled={disabled || !ready || !name.trim()}
            onClick={() => void create()}
          >
            {t("welcome.create")}
          </button>
        </div>
      </header>
      {/* Create submits only from its button: Enter in a draft field must not create the workbench. */}
      <form className="workbench-form" onSubmit={(event) => event.preventDefault()}>
        {shown && (
          <WorkbenchConfigForm
            label={t("projects.new")}
            config={config}
            setConfig={setConfig}
            instructions={shownInstructions}
            setInstructions={setInstructions}
            folder={inspection?.folder ?? ""}
            nameField={false}
            disabled={disabled}
            locked={!ready}
            instructionsReadOnly={kept !== null}
            instructionsNotice={kept !== null && <p role="status">{t("create.instructionsKept")}</p>}
            notices={
              <>
                {error !== undefined && <ErrorMessage error={error} />}
                {pending && <p role="status">{t("workbench.working")}</p>}
              </>
            }
            general={generalFields}
            skills={
              <fieldset disabled={disabled} className="workbench-create-skills" data-create-skills>
                <legend>{t("projects.skills")}</legend>
                {!inspection?.skills.length && <p className="muted">{t("create.noSkills")}</p>}
                {inspection?.skills.map((skill) => (
                  <label key={skill.name} className="workbench-tool-option" data-create-skill={skill.name}>
                    <input
                      type="checkbox"
                      disabled={!!skill.error}
                      checked={!skill.error && !skillsDisabled.includes(skill.name)}
                      onChange={(e) =>
                        setSkillsDisabled((current) =>
                          e.target.checked
                            ? current.filter((entry) => entry !== skill.name)
                            : [...current.filter((entry) => entry !== skill.name), skill.name],
                        )
                      }
                    />
                    <span>
                      <strong>{skill.name}</strong>
                      {skill.description && <span className="muted"> — {skill.description}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
            }
          />
        )}
        {/* Hidden: the draft's folder and name stay, without the form's ids. */}
        {!shown && generalFields}
      </form>
    </section>
  );
}
