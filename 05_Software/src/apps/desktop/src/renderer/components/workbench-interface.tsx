import { defaultRightPanelTabs, rightPanelTabIds, type WorkbenchConfig } from "@vera/shared";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { rightPanelTabs } from "./right-panel-tabs.js";

/** Presentation preferences in the parent's Save/Cancel workbench draft. */
export function WorkbenchInterface({
  config,
  setConfig,
}: {
  config: WorkbenchConfig;
  setConfig: Dispatch<SetStateAction<WorkbenchConfig>>;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="workbench-tools">
      <legend>{t("projects.rightPanelTabs")}</legend>
      <button
        type="button"
        data-restore-panel-tabs
        onClick={() =>
          setConfig((current) => ({
            ...current,
            interface: { ...current.interface, right_panel_tabs: [...defaultRightPanelTabs] },
          }))
        }
      >
        {t("projects.restorePanelTabs")}
      </button>
      {rightPanelTabs(t).map(({ id, label }) => (
        <label key={id} className="workbench-tool-option">
          <input
            type="checkbox"
            data-panel-tab-toggle={id}
            checked={config.interface.right_panel_tabs.includes(id)}
            onChange={(event) => {
              const checked = event.target.checked;
              setConfig((current) => ({
                ...current,
                interface: {
                  ...current.interface,
                  right_panel_tabs: rightPanelTabIds.filter((tab) =>
                    tab === id ? checked : current.interface.right_panel_tabs.includes(tab),
                  ),
                },
              }));
            }}
          />
          <span>{label}</span>
        </label>
      ))}
      <label className="workbench-tool-option">
        <input
          type="checkbox"
          data-git-status-toggle
          checked={config.interface.git_status}
          onChange={(event) => {
            const checked = event.target.checked;
            setConfig((current) => ({
              ...current,
              interface: { ...current.interface, git_status: checked },
            }));
          }}
        />
        <span>{t("gitStatus.preference")}</span>
      </label>
    </fieldset>
  );
}
