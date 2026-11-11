import type { WorkbenchConfig } from "@vera/shared";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PermissionPicker } from "./permission-picker.js";
import { WorkbenchDocuments } from "./workbench-documents.js";
import { WorkbenchPlugins } from "./workbench-plugins.js";
import { WorkbenchTools } from "./workbench-tools.js";

export const configSections = [
  "general",
  "documents",
  "instructions",
  "agent",
  "chat",
  "tools",
  "skills",
  "embeddings",
  "plugins",
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
}) {
  const { t } = useTranslation();
  const labels = {
    general: t("projects.general"),
    documents: t("projects.documents"),
    agent: t("projects.agent"),
    chat: t("chatDetail.section"),
    instructions: t("projects.instructions"),
    tools: t("projects.tools"),
    skills: t("projects.skills"),
    embeddings: t("projects.indexing"),
    plugins: t("projects.plugins"),
  };
  const detailHelp = {
    verbose: t("chatDetail.verboseInfo"),
    normal: t("chatDetail.normalInfo"),
    minimal: t("chatDetail.minimalInfo"),
  };
  const [section, setSection] = useState<ConfigSection>("general");
  const content = useRef<HTMLDivElement>(null);
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
          {section === "general" && (
            <>
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
              <p className="path-text">{folder}</p>
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
                disabled={disabled || readOnly}
                label={t("projects.permissions")}
                change={(permission_mode) =>
                  setConfig((current) => ({ ...current, agent: { ...current.agent, permission_mode } }))
                }
              />
            </>
          )}
          {section === "chat" && (
            <>
              <label>
                {t("chatDetail.label")}
                <select
                  data-chat-detail
                  aria-describedby="chat-detail-help"
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
              <p id="chat-detail-help" className="muted">
                {t("chatDetail.info")}
              </p>
              <p>{detailHelp[config.chat.detail]}</p>
            </>
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
              <h4>{t("retrieval.title")}</h4>
              <p className="muted">{t("retrieval.info")}</p>
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
            </>
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
