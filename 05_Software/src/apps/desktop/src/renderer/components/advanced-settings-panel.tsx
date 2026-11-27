// REQ-UX-fcd1ad10 REQ-UX-9ea9184f REQ-UX-032aab57 REQ-UX-6c38608e REQ-UX-634d3ec2
import {
  type AdvancedKey,
  advancedDraftValid,
  advancedEditPatch,
  advancedSettings,
  type Settings,
  type SettingsPatch,
} from "@vera/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AdvancedField, advancedFieldValue } from "./advanced-field.js";
import { SettingsPageHeader, useSettingsDraft } from "./settings-page-header.js";

const keysByGroup = {
  agent: [
    "toolCallsPerTurn",
    "backgroundCompaction",
    "summaryToolResultChars",
    "summaryPasses",
    "calibrationMargin",
    "providerTokenCounts",
    "delegations",
    "concurrentTurns",
    "compactionTrigger",
    "recentTailTokens",
    "toolResultChars",
  ],
  tools: [
    "readLines",
    "readChars",
    "grepResults",
    "grepFileMB",
    "globResults",
    "workerDeadline",
    "backgroundPrograms",
    "runLogsKept",
    "runLogMB",
    "programTimeout",
    "commandTimeout",
    "terminals",
    "terminalBufferK",
    "terminalScrollback",
    "terminalAgentChars",
  ],
  images: ["imagesPerMessage", "imageFileMB"],
  documents: [
    "docVolumeFiles",
    "docVolumeMB",
    "docsResults",
    "extractionTimeout",
    "indexingPause",
    "embeddingIdle",
  ],
  providers: [
    "noOutputTimeout",
    "headerWait",
    "providerDiscoveryTimeout",
    "browserNavigationTimeout",
    "webSearchResults",
    "webReadChars",
    "webTimeout",
    "downloadMB",
    "downloadTimeout",
  ],
  dictation: ["dictationTranscriptionTimeout"],
  interface: [
    "updateInterval",
    "catalogInterval",
    "logDays",
    "transcriptRows",
    "transcriptChunkRows",
    "pageSize",
  ],
} as const satisfies Record<string, readonly AdvancedKey[]>;

/** Settings > Advanced: the Show advanced settings switch and the application values, saved with Save. */
export function AdvancedSettingsPanel({
  settings,
  disabled,
  update,
  dirtyChanged,
}: {
  settings: Settings;
  disabled: boolean;
  update: (patch: SettingsPatch) => void;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const [modifiedOnly, setModifiedOnly] = useState(false);
  const saved = { showAdvanced: settings.showAdvanced === true, advanced: settings.advanced ?? {} };
  const { draft, dirty, set, reset } = useSettingsDraft(saved, dirtyChanged);
  const patch = advancedEditPatch(saved.advanced, draft.advanced, "app");
  const groups = [
    { id: "agent", name: t("advanced.groups.agent") },
    { id: "tools", name: t("advanced.groups.tools") },
    { id: "images", name: t("advanced.groups.images") },
    { id: "documents", name: t("advanced.groups.documents") },
    { id: "providers", name: t("advanced.groups.providers") },
    { id: "dictation", name: t("advanced.groups.dictation") },
    { id: "interface", name: t("advanced.groups.interface") },
  ] as const;
  const visible = groups
    .map((group) => ({
      ...group,
      keys: keysByGroup[group.id].filter(
        (key) => !modifiedOnly || Object.hasOwn(patch, key) || Object.hasOwn(saved.advanced, key),
      ),
    }))
    .filter(({ keys }) => keys.length > 0);
  return (
    <section className="surface app-advanced-settings" data-settings-section="advanced">
      <SettingsPageHeader
        title={t("settings.advanced")}
        i18n="settings.advanced"
        dirty={dirty}
        valid={advancedDraftValid(patch)}
        saving={disabled}
        onCancel={reset}
        onSave={() =>
          update({
            ...(draft.showAdvanced !== saved.showAdvanced ? { showAdvanced: draft.showAdvanced } : {}),
            ...(Object.keys(patch).length ? { advanced: patch } : {}),
          })
        }
      />
      <div className="advanced-switches">
        <label className="advanced-switch">
          <input
            type="checkbox"
            data-show-advanced
            checked={draft.showAdvanced}
            disabled={disabled}
            onChange={(event) => set({ showAdvanced: event.target.checked })}
          />
          <span>{t("advanced.show")}</span>
        </label>
        {draft.showAdvanced && (
          <label className="advanced-switch">
            <input
              type="checkbox"
              data-advanced-modified
              checked={modifiedOnly}
              onChange={(event) => setModifiedOnly(event.target.checked)}
            />
            <span>{t("advanced.modifiedOnly")}</span>
          </label>
        )}
      </div>
      {draft.showAdvanced && (
        <div className="advanced-groups" data-advanced-scroll>
          {visible.length === 0 && <p role="status">{t("advanced.noModified")}</p>}
          {visible.map(({ id, name, keys }) => (
            <details
              key={`${id}:${modifiedOnly}`}
              data-advanced-group={id}
              open={modifiedOnly || id === "agent"}
            >
              <summary>{name}</summary>
              <div className="advanced-group-fields">
                {keys.map((key) => (
                  <AdvancedField
                    key={key}
                    setting={key}
                    value={advancedFieldValue(key, draft.advanced[key])}
                    inherited={{ value: advancedSettings[key].default, source: "default" }}
                    disabled={disabled}
                    onChange={(next) => {
                      const advanced: Record<string, unknown> = { ...draft.advanced };
                      if (next === null) delete advanced[key];
                      else advanced[key] = next;
                      set({ advanced });
                    }}
                  />
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
