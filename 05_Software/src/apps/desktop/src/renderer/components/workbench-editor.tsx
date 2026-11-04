import { type WorkbenchSnapshot, workbenchPatchSchema } from "@vera/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { SkillSettings } from "./skills.js";
import { WorkbenchConfigForm } from "./workbench-config-form.js";

export function WorkbenchEditor({
  workbench,
  close,
  saved,
  dirtyChanged,
}: {
  workbench: WorkbenchSnapshot;
  close: () => void;
  saved: (value: WorkbenchSnapshot) => void;
  /** Reports whether the draft differs from the loaded configuration and instructions. */
  dirtyChanged?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const title = useId();
  const [config, setConfig] = useState(workbench.config);
  const [instructions, setInstructions] = useState("");
  const [original, setOriginal] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [partial, setPartial] = useState(false);
  const loadGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
    ref.current?.focus();
    void loadInstructions();
    return () => {
      ++loadGeneration.current;
    };
  }, [loadInstructions]);
  // Edits stay unsaved until a save completes, so a failed save is never left behind unseen.
  const dirty = instructions !== original || JSON.stringify(config) !== JSON.stringify(workbench.config);
  useEffect(() => {
    dirtyChanged?.(dirty);
  }, [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
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
        retrieval: { results: config.retrieval.results, mode: config.retrieval.mode },
        agent: { permission_mode: config.agent.permission_mode, model: config.agent.model },
        tools: { disabled: config.tools.disabled },
        plugins: { enabled: config.plugins.enabled },
        chat: { detail: config.chat.detail },
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
      // The engineer may have confirmed leaving meanwhile; a late result must not touch the next page.
      if (!mounted.current) return;
      saved({ ...workbench, ...updated });
      close();
    } catch (error) {
      if (!mounted.current) return;
      setPartial(configSaved && instructions !== original);
      setError(error);
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="surface workbench-editor"
      aria-labelledby={title}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("dialog")) return;
        e.preventDefault();
        if (!pending) close();
      }}
    >
      <header>
        <h3 id={title}>{workbench.config.name}</h3>
      </header>
      <WorkbenchConfigForm
        label={t("projects.edit")}
        config={config}
        setConfig={setConfig}
        instructions={instructions}
        setInstructions={setInstructions}
        folder={workbench.folder}
        workbenchId={workbench.config.id}
        readOnly={workbench.readOnly}
        disabled={pending || !loaded}
        notices={
          <>
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
          </>
        }
        skills={
          <>
            <SkillSettings workbenchId={workbench.config.id} readOnly={workbench.readOnly} />
            <p className="muted">{t("projects.skillsIndependent")}</p>
          </>
        }
      />
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
    </section>
  );
}
