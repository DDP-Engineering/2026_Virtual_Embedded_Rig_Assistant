import type { CommandPrefixDisplay, WorkbenchConfig } from "@vera/shared";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelSelect } from "./model-select.js";
import { PermissionPicker } from "./permission-picker.js";
import { WorkbenchCommandPrefixes } from "./workbench-command-prefixes.js";
import { WorkbenchDocuments } from "./workbench-documents.js";
import { WorkbenchFolders } from "./workbench-folders.js";
import { WorkbenchInterface } from "./workbench-interface.js";
import { WorkbenchPlugins } from "./workbench-plugins.js";
import { WorkbenchPrivacy } from "./workbench-privacy.js";
import { WorkbenchTools } from "./workbench-tools.js";

export const configSections = [
  "general",
  "interface",
  "instructions",
  "documents",
  "embeddings",
  "agent",
  "skills",
  "tools",
  "plugins",
  "privacy",
] as const;
export type ConfigSection = (typeof configSections)[number];

/**
 * The workbench configuration sections shared by New Workbench (an unsaved draft) and the
 * workbench editor (the open workbench). Callers own the draft and how it is saved.
 */
export function WorkbenchConfigForm({
  label,
  config,
  setConfig,
  instructions,
  setInstructions,
  folder,
  nameField = true,
  readOnly = false,
  disabled = false,
  instructionsReadOnly = false,
  notices,
  instructionsNotice,
  skills,
  workbenchId,
  shown = true,
  general,
  locked = false,
  request,
  addedFolders = [],
  removedFolders = [],
  changeFolders,
  removedCommandPrefixes = [],
  removeCommandPrefix,
}: {
  label: string;
  config: WorkbenchConfig;
  setConfig: Dispatch<SetStateAction<WorkbenchConfig>>;
  instructions: string;
  setInstructions: (value: string) => void;
  folder: string;
  nameField?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  instructionsReadOnly?: boolean;
  notices?: ReactNode;
  instructionsNotice?: ReactNode;
  skills: ReactNode;
  workbenchId?: string | undefined;
  shown?: boolean;
  /** Fields shown first in General (New workbench: folder and name). */
  general?: ReactNode;
  /** Only General is available, e.g. until New workbench has a folder. */
  locked?: boolean;
  /** Shows this section; a new request object switches to it again (Docs tab "Edit exclusions"). */
  request?: { section: ConfigSection } | undefined;
  addedFolders?: readonly CommandPrefixDisplay[];
  removedFolders?: readonly string[];
  changeFolders?: (added: CommandPrefixDisplay[], removed: string[]) => void;
  removedCommandPrefixes?: readonly string[];
  removeCommandPrefix?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const labels = {
    general: t("projects.general"),
    interface: t("projects.interface"),
    documents: t("projects.documents"),
    agent: t("projects.agent"),
    instructions: t("projects.instructions"),
    tools: t("projects.tools"),
    skills: t("projects.skills"),
    embeddings: t("projects.indexing"),
    plugins: t("projects.plugins"),
    privacy: t("settings.data"),
  };
  const [section, setSection] = useState<ConfigSection>(request?.section ?? "general");
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!request) return;
    setSection(request.section);
    if (content.current) content.current.scrollTop = 0;
  }, [request]);
  const instructionsInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (section === "instructions" && !disabled) instructionsInput.current?.focus();
  }, [section, disabled]);
  return (
    <div className="workbench-editor-layout">
      <nav aria-label={label}>
        {configSections.map((key) => (
          <button
            key={key}
            type="button"
            aria-current={section === key ? "page" : undefined}
            data-project-section={key}
            disabled={locked && key !== "general"}
            onClick={() => {
              setSection(key);
              if (content.current) content.current.scrollTop = 0;
            }}
          >
            {labels[key]}
          </button>
        ))}
      </nav>
      <div ref={content} className="workbench-editor-content">
        {notices}
        <fieldset disabled={(readOnly && section !== "instructions" && section !== "plugins") || disabled}>
          {section === "interface" && <WorkbenchInterface config={config} setConfig={setConfig} />}
          {section === "privacy" && (
            <WorkbenchPrivacy
              key={workbenchId ?? folder}
              config={config}
              setConfig={setConfig}
              disabled={disabled || readOnly}
            />
          )}
          {section === "general" && (
            <>
              {general}
              {nameField && (
                <label>
                  {t("projects.name")}
                  <input
                    data-project-name
                    maxLength={80}
                    value={config.name}
                    onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  />
                </label>
              )}
              <label>
                {t("projects.description")}
                <textarea
                  value={config.description ?? ""}
                  onChange={(e) => setConfig({ ...config, description: e.target.value })}
                />
              </label>
              {!general && <p className="path-text">{folder}</p>}
              {workbenchId && changeFolders && (
                <WorkbenchFolders
                  workbenchId={workbenchId}
                  added={addedFolders}
                  removed={removedFolders}
                  change={changeFolders}
                  disabled={disabled || readOnly}
                />
              )}
            </>
          )}
          {section === "documents" && (
            <WorkbenchDocuments
              key={folder}
              folder={folder}
              docs={config.docs}
              setDocs={(docs) => setConfig((current) => ({ ...current, docs }))}
              disabled={disabled || readOnly}
            />
          )}
          {section === "agent" && (
            <div className="settings-columns">
              <label htmlFor="project-model">
                {t("projects.model")}
                <ModelSelect
                  id="project-model"
                  value={config.agent.model}
                  change={(model) =>
                    setConfig((current) => ({ ...current, agent: { ...current.agent, model } }))
                  }
                />
              </label>
              <PermissionPicker
                mode={config.agent.permission_mode}
                disabled={disabled || readOnly}
                label={t("projects.permissions")}
                change={(permission_mode) =>
                  setConfig((current) => ({ ...current, agent: { ...current.agent, permission_mode } }))
                }
              />
              <label>
                {t("chatDetail.label")}
                <select
                  data-chat-detail
                  value={config.chat.detail}
                  onChange={(e) =>
                    setConfig((current) => ({
                      ...current,
                      chat: { ...current.chat, detail: e.target.value as WorkbenchConfig["chat"]["detail"] },
                    }))
                  }
                >
                  <option value="verbose">{t("chatDetail.verbose")}</option>
                  <option value="normal">{t("chatDetail.normal")}</option>
                  <option value="minimal">{t("chatDetail.minimal")}</option>
                </select>
              </label>
              {workbenchId && removeCommandPrefix && (
                <WorkbenchCommandPrefixes
                  workbenchId={workbenchId}
                  removed={removedCommandPrefixes}
                  disabled={disabled || readOnly}
                  remove={removeCommandPrefix}
                />
              )}
            </div>
          )}
          {section === "instructions" && (
            <>
              {instructionsNotice}
              <label>
                {t("projects.instructions")} — WORKBENCH.md
                <textarea
                  ref={instructionsInput}
                  id="pinned-content"
                  readOnly={readOnly || instructionsReadOnly}
                  className="project-instructions"
                  data-project-instructions
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </label>
            </>
          )}
          {section === "tools" && (
            <WorkbenchTools
              disabled={config.tools.disabled}
              modelRef={config.agent.model}
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
            <div className="index-columns">
              <div className="index-card">
                <h4>{t("projects.embeddingsGroup")}</h4>
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
              </div>
              <div className="index-card">
                <h4>{t("retrieval.title")}</h4>
                <label>
                  {t("retrieval.results")}
                  <input
                    type="number"
                    min={1}
                    max={20}
                    data-retrieval-results
                    value={config.retrieval.results}
                    onChange={(e) =>
                      setConfig((current) => ({
                        ...current,
                        retrieval: { ...current.retrieval, results: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
                <label>
                  {t("retrieval.mode")}
                  <select
                    data-retrieval-mode
                    value={config.retrieval.mode}
                    onChange={(e) =>
                      setConfig((current) => ({
                        ...current,
                        retrieval: {
                          ...current.retrieval,
                          mode: e.target.value as WorkbenchConfig["retrieval"]["mode"],
                        },
                      }))
                    }
                  >
                    <option value="hybrid">{t("retrieval.hybrid")}</option>
                    <option value="keyword">{t("retrieval.keyword")}</option>
                    <option value="semantic">{t("retrieval.semantic")}</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          {section === "plugins" && shown && (
            <WorkbenchPlugins
              workbenchId={workbenchId}
              readOnly={readOnly}
              disabled={disabled}
              enabled={config.plugins.enabled}
              toggle={(id, selected) =>
                setConfig((current) => ({
                  ...current,
                  plugins: {
                    ...current.plugins,
                    enabled: selected
                      ? [...new Set([...current.plugins.enabled, id])]
                      : current.plugins.enabled.filter((entry) => entry !== id),
                  },
                }))
              }
            />
          )}
        </fieldset>
        {section === "skills" && skills}
      </div>
    </div>
  );
}
