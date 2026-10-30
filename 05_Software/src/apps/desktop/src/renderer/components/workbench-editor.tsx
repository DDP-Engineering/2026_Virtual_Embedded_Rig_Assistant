import { type WorkbenchSnapshot, workbenchPatchSchema } from "@vera/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { PermissionPicker } from "./permission-picker.js";
import { SkillSettings } from "./skills.js";
import { WorkbenchTools } from "./workbench-tools.js";

const sections = ["general", "documents", "agent", "instructions", "tools", "embeddings", "plugins"] as const;
export function Plugins() {
  const { t } = useTranslation();
  return (
    <section className="surface" data-plugins>
      <h2>{t("projects.pluginTitle")}</h2>
      <p>{t("projects.pluginIntro")}</p>
      <p role="status">{t("projects.pluginFuture")}</p>
      <p className="muted">{t("projects.pluginPlanned")}</p>
    </section>
  );
}
export function WorkbenchEditor({
  workbench,
  close,
  saved,
}: {
  workbench: WorkbenchSnapshot;
  close: () => void;
  saved: (value: WorkbenchSnapshot) => void;
}) {
  const { t } = useTranslation();
  const labels = {
    general: t("projects.general"),
    documents: t("projects.documents"),
    agent: t("projects.agent"),
    instructions: t("projects.instructions"),
    tools: t("projects.tools"),
    embeddings: t("projects.embeddings"),
    plugins: t("projects.plugins"),
  };
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [section, setSection] = useState<(typeof sections)[number]>("general");
  const [config, setConfig] = useState(workbench.config);
  const [instructions, setInstructions] = useState("");
  const [original, setOriginal] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [partial, setPartial] = useState(false);
  const instructionsInput = useRef<HTMLTextAreaElement>(null);
  const loadGeneration = useRef(0);
  const loadInstructions = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoaded(false);
    setError(undefined);
    try {
      const value = await api.invoke("workbench.pinned.get", {});
      if (generation === loadGeneration.current) {
        setInstructions(value.content);
        setOriginal(value.content);
        setLoaded(true);
      }
    } catch (error) {
      if (generation === loadGeneration.current) setError(error);
    }
  }, []);
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.showModal();
    void loadInstructions();
    return () => {
      ++loadGeneration.current;
      node?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, [loadInstructions]);
  useEffect(() => {
    if (section === "instructions" && loaded) instructionsInput.current?.focus();
  }, [section, loaded]);
  const lines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  async function save() {
    if (pending || workbench.readOnly || !loaded) return;
    setPending(true);
    setError(undefined);
    setPartial(false);
    let configSaved = false;
    try {
      const current = await api.invoke("workbench.config.get", {});
      if (current.config.id !== workbench.config.id || current.folder !== workbench.folder)
        throw new Error(t("projects.changed"));
      const patch = workbenchPatchSchema.parse({
        name: config.name,
        description: config.description ?? "",
        docs: {
          include: lines(config.docs.include.join("\n")),
          exclude: lines(config.docs.exclude.join("\n")),
        },
        embeddings: config.embeddings,
        agent: { permission_mode: config.agent.permission_mode, model: config.agent.model },
        tools: { disabled: config.tools.disabled },
      });
      const updated = await api.invoke("workbench.config.update", {
        patch,
        workbenchId: workbench.config.id,
      });
      configSaved = true;
      if (instructions !== original)
        await api.invoke("workbench.pinned.update", {
          content: instructions,
          workbenchId: workbench.config.id,
        });
      saved({ ...workbench, ...updated });
      close();
    } catch (error) {
      setPartial(configSaved && instructions !== original);
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="pinned-dialog workbench-editor"
      aria-labelledby={title}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (!pending) close();
      }}
    >
      <header>
        <h2 id={title}>
          {t("projects.edit")}: {workbench.config.name}
        </h2>
        <button type="button" disabled={pending} aria-label={t("panel.close")} onClick={close}>
          ×
        </button>
      </header>
      <div className="workbench-editor-layout">
        <nav aria-label={t("projects.edit")}>
          {sections.map((key) => (
            <button
              key={key}
              type="button"
              aria-current={section === key ? "page" : undefined}
              data-project-section={key}
              onClick={() => setSection(key)}
            >
              {labels[key]}
            </button>
          ))}
        </nav>
        <div className="workbench-editor-content">
          {error !== undefined && <ErrorMessage error={error} />}
          {!loaded && error === undefined && <p role="status">{t("projects.loadingInstructions")}</p>}
          {!loaded && error !== undefined && (
            <button type="button" onClick={() => void loadInstructions()}>
              {t("settings.retry")}
            </button>
          )}
          {new TextEncoder().encode(instructions).byteLength > 16384 && (
            <p role="status">{t("workbench.pinnedOversized")}</p>
          )}
          {partial && <p role="alert">{t("projects.partialSave")}</p>}
          {workbench.readOnly && <p role="status">{t("workbench.readOnly")}</p>}
          <fieldset disabled={(workbench.readOnly && section !== "instructions") || pending || !loaded}>
            {section === "general" && (
              <>
                <label>
                  {t("projects.name")}
                  <input
                    data-project-name
                    maxLength={80}
                    value={config.name}
                    onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  />
                </label>
                <label>
                  {t("projects.description")}
                  <textarea
                    value={config.description ?? ""}
                    onChange={(e) => setConfig({ ...config, description: e.target.value })}
                  />
                </label>
                <p className="path-text">{workbench.folder}</p>
              </>
            )}
            {section === "documents" && (
              <>
                <p>{t("projects.sourceInfo")}</p>
                <label>
                  {t("projects.include")}
                  <textarea
                    data-project-include
                    value={config.docs.include.join("\n")}
                    onChange={(e) =>
                      setConfig({ ...config, docs: { ...config.docs, include: e.target.value.split("\n") } })
                    }
                  />
                </label>
                <label>
                  {t("projects.exclude")}
                  <textarea
                    value={config.docs.exclude.join("\n")}
                    onChange={(e) =>
                      setConfig({ ...config, docs: { ...config.docs, exclude: e.target.value.split("\n") } })
                    }
                  />
                </label>
              </>
            )}
            {section === "agent" && (
              <>
                <label>
                  {t("projects.model")}
                  <input
                    data-project-model
                    value={config.agent.model ?? ""}
                    onChange={(e) =>
                      setConfig({ ...config, agent: { ...config.agent, model: e.target.value || null } })
                    }
                  />
                </label>
                <PermissionPicker
                  mode={config.agent.permission_mode}
                  disabled={pending || workbench.readOnly || !loaded}
                  label={t("projects.permissions")}
                  change={(permission_mode) =>
                    setConfig((current) => ({ ...current, agent: { ...current.agent, permission_mode } }))
                  }
                />
              </>
            )}
            {section === "instructions" && (
              <label>
                {t("projects.instructions")} — WORKBENCH.md
                <textarea
                  ref={instructionsInput}
                  id="pinned-content"
                  readOnly={workbench.readOnly}
                  className="project-instructions"
                  data-project-instructions
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </label>
            )}
            {section === "tools" && (
              <WorkbenchTools
                disabled={config.tools.disabled}
                toggle={(name, enabled) =>
                  setConfig((current) => ({
                    ...current,
                    tools: {
                      ...current.tools,
                      disabled: enabled
                        ? current.tools.disabled.filter((entry) => entry !== name)
                        : [...current.tools.disabled.filter((entry) => entry !== name), name],
                    },
                  }))
                }
              />
            )}
            {section === "embeddings" && (
              <>
                <p>{t("projects.embeddingInfo")}</p>
                <label>
                  {t("projects.embeddingModel")}
                  <select value={config.embeddings.model} disabled>
                    <option value="Xenova/bge-small-en-v1.5">BGE Small EN v1.5 (local)</option>
                  </select>
                </label>
                <label>
                  {t("projects.chunkSize")}
                  <input
                    type="number"
                    min={200}
                    max={1400}
                    data-project-chunk
                    value={config.embeddings.chunkSize}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        embeddings: { ...config.embeddings, chunkSize: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label>
                  {t("projects.overlap")}
                  <input
                    type="number"
                    min={0}
                    max={Math.min(600, config.embeddings.chunkSize - 1)}
                    data-project-overlap
                    value={config.embeddings.overlap}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        embeddings: { ...config.embeddings, overlap: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <p>{t("projects.reindexNotice")}</p>
              </>
            )}
          </fieldset>
          {section === "tools" && (
            <>
              <p className="muted">{t("projects.skillsIndependent")}</p>
              <SkillSettings workbenchId={workbench.config.id} readOnly={workbench.readOnly} />
            </>
          )}
          {section === "plugins" && <Plugins />}
        </div>
      </div>
      <footer>
        <button type="button" disabled={pending} onClick={close}>
          {t("projects.cancel")}
        </button>
        <button
          type="button"
          data-project-save
          disabled={pending || workbench.readOnly || !loaded || !config.name.trim()}
          onClick={() => void save()}
        >
          {pending ? t("projects.saving") : t("projects.save")}
        </button>
      </footer>
    </dialog>
  );
}
