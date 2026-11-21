import {
  advancedDraftValid,
  advancedEditPatch,
  type CommandPrefixDisplay,
  type EmbeddingSwitchApproval,
  type WorkbenchSnapshot,
  workbenchDocsSchema,
  workbenchPatchSchema,
} from "@vera/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { useSettingsSnapshot } from "../hooks/use-preferences.js";
import { EmbeddingSwitchDialog } from "./embedding-switch-dialog.js";
import { ErrorMessage } from "./error-message.js";
import { SkillsPanel } from "./skills.js";
import { type ConfigSection, WorkbenchConfigForm } from "./workbench-config-form.js";

export function WorkbenchEditor({
  workbench,
  close,
  saved,
  dirtyChanged,
  shown = true,
  request,
}: {
  workbench: WorkbenchSnapshot;
  close: () => void;
  saved: (value: WorkbenchSnapshot) => void;
  /** Reports whether the draft differs from the loaded configuration and instructions. */
  dirtyChanged?: (dirty: boolean) => void;
  /** Installation may temporarily hide this owner without discarding its draft. */
  shown?: boolean;
  /** The section to show, e.g. Documents & RAG from the Docs tab's "Edit exclusions". */
  request?: { section: ConfigSection } | undefined;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const title = useId();
  const [config, setConfig] = useState(workbench.config);
  const [instructions, setInstructions] = useState("");
  const [original, setOriginal] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [embeddingSwitch, setEmbeddingSwitch] = useState<EmbeddingSwitchApproval>();
  const [error, setError] = useState<unknown>();
  const [partial, setPartial] = useState(false);
  const [addedFolders, setAddedFolders] = useState<CommandPrefixDisplay[]>([]);
  const [removedFolders, setRemovedFolders] = useState<string[]>([]);
  const [removedCommandPrefixes, setRemovedCommandPrefixes] = useState<string[]>([]);
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
    void loadInstructions();
    return () => {
      ++loadGeneration.current;
    };
  }, [loadInstructions]);
  useEffect(() => {
    if (shown) ref.current?.focus();
  }, [shown]);
  // Edits stay unsaved until a save completes, so a failed save is never left behind unseen. Skills
  // are saved by their own switches at once, so they are never part of this draft.
  const comparable = ({ skills: _saved, additional_folders: _folders, ...value }: typeof config) => {
    const { allowed_commands: _grants, ...agent } = value.agent;
    const { privacy: _privacy, ...rest } = value;
    const mask = Object.fromEntries(
      Object.entries(value.privacy?.mask ?? {}).filter(([, choice]) => choice !== "default"),
    );
    return {
      ...rest,
      agent,
      privacy: mask,
      plugins: { ...value.plugins, enabled: [...value.plugins.enabled].sort() },
    };
  };
  const dirty =
    addedFolders.length > 0 ||
    removedFolders.length > 0 ||
    removedCommandPrefixes.length > 0 ||
    instructions !== original ||
    JSON.stringify(comparable(config)) !== JSON.stringify(comparable(workbench.config));
  // An invalid limit in Documents & RAG keeps Save off until it is corrected.
  const showAdvanced = useSettingsSnapshot().data?.settings.showAdvanced === true;
  // An out-of-range Advanced value keeps Save off too (REQ-UX-9ea9184f).
  // Only edited keys are checked, so an untouched value from the file never blocks Save.
  const valid =
    workbenchDocsSchema.safeParse(config.docs).success &&
    advancedDraftValid(advancedEditPatch(workbench.config.advanced, config.advanced, "workbench"));
  useEffect(() => {
    dirtyChanged?.(dirty);
  }, [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
  const lines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  async function save(confirmedSwitch?: EmbeddingSwitchApproval) {
    if (pending || workbench.readOnly || !loaded || !dirty || !valid) return;
    setPending(true);
    setError(undefined);
    setPartial(false);
    let configSaved = false;
    try {
      const current = await api.invoke("workbench.config.get", {});
      if (current.config.id !== workbench.config.id || current.folder !== workbench.folder)
        throw new Error(t("projects.changed"));
      if (config.embeddings.model !== current.config.embeddings.model && !confirmedSwitch) {
        const { documents } = await api.invoke("docs.list", { workbenchId: workbench.config.id });
        if (mounted.current)
          setEmbeddingSwitch({
            from: current.config.embeddings.model,
            count: documents.filter(({ status }) => status === "indexed").length,
          });
        return;
      }
      if (!mounted.current) return;
      const patch = workbenchPatchSchema.parse({
        name: config.name,
        description: config.description ?? "",
        docs: {
          include: lines(config.docs.include.join("\n")),
          exclude: lines(config.docs.exclude.join("\n")),
          gitignore: config.docs.gitignore,
          maxFileMB: config.docs.maxFileMB ?? null,
          maxFiles: config.docs.maxFiles,
        },
        embeddings: config.embeddings,
        retrieval: { results: config.retrieval.results, mode: config.retrieval.mode },
        agent: {
          permission_mode: config.agent.permission_mode,
          model: config.agent.model,
        },
        tools: { disabled: config.tools.disabled },
        plugins: { enabled: config.plugins.enabled },
        chat: { detail: config.chat.detail },
        interface: {
          right_panel_tabs: config.interface.right_panel_tabs,
          git_status: config.interface.git_status,
        },
        ...(config.privacy ? { privacy: config.privacy } : {}),
        advanced: advancedEditPatch(workbench.config.advanced, config.advanced, "workbench"),
      });
      const updated = await api.invoke("workbench.config.update", {
        patch,
        workbenchId: workbench.config.id,
        ...(confirmedSwitch ? { embeddingSwitch: confirmedSwitch } : {}),
        ...(addedFolders.length ? { addAdditionalFolders: addedFolders.map(({ id }) => id) } : {}),
        ...(removedFolders.length ? { removeAdditionalFolders: removedFolders } : {}),
        ...(removedCommandPrefixes.length ? { removeCommandPrefixes: removedCommandPrefixes } : {}),
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
      hidden={!shown}
      inert={!shown}
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
        <div className="workbench-actions" data-project-actions>
          {dirty && <span role="status">{t("projects.unsavedChanges")}</span>}
          <button type="button" data-project-cancel disabled={pending} onClick={close}>
            {t("projects.cancel")}
          </button>
          <button
            type="button"
            data-project-save
            ref={saveButton}
            className="primary"
            disabled={pending || workbench.readOnly || !loaded || !config.name.trim() || !dirty || !valid}
            onClick={() => void save()}
          >
            {pending ? t("projects.saving") : t("projects.save")}
          </button>
        </div>
      </header>
      <WorkbenchConfigForm
        shown={shown}
        request={request}
        label={t("projects.edit")}
        config={config}
        setConfig={setConfig}
        instructions={instructions}
        setInstructions={setInstructions}
        folder={workbench.folder}
        workbenchId={workbench.config.id}
        addedFolders={addedFolders}
        removedFolders={removedFolders}
        changeFolders={(added, removed) => {
          setAddedFolders(added);
          setRemovedFolders(removed);
        }}
        removedCommandPrefixes={removedCommandPrefixes}
        removeCommandPrefix={(id) => setRemovedCommandPrefixes((current) => [...new Set([...current, id])])}
        readOnly={workbench.readOnly}
        disabled={pending || !loaded}
        advanced={showAdvanced}
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
        skills={<SkillsPanel workbenchId={workbench.config.id} readOnly={workbench.readOnly} />}
      />
      {shown && embeddingSwitch && (
        <EmbeddingSwitchDialog
          count={embeddingSwitch.count}
          cancel={() => {
            setEmbeddingSwitch(undefined);
            saveButton.current?.focus();
          }}
          confirm={() => {
            setEmbeddingSwitch(undefined);
            void save(embeddingSwitch);
          }}
        />
      )}
    </section>
  );
}
