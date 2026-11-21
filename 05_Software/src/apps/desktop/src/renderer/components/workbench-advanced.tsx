// REQ-UX-fcd1ad10 REQ-UX-9ea9184f
import { advancedKeys, advancedSettings, resolveAdvanced, type WorkbenchConfig } from "@vera/shared";
import type { Dispatch, SetStateAction } from "react";
import { useSettingsSnapshot } from "../hooks/use-preferences.js";
import { AdvancedField, advancedFieldValue } from "./advanced-field.js";

/** Edit workbench > Advanced: workbench values over the application ones, saved with the workbench. */
export function WorkbenchAdvanced({
  config,
  setConfig,
  disabled,
}: {
  config: WorkbenchConfig;
  setConfig: Dispatch<SetStateAction<WorkbenchConfig>>;
  disabled: boolean;
}) {
  const app = useSettingsSnapshot().data?.settings.advanced;
  const keys = advancedKeys.filter((key) =>
    (advancedSettings[key].scopes as readonly string[]).includes("workbench"),
  );
  return (
    <div className="advanced-settings" data-workbench-advanced>
      {keys.map((key) => {
        const inherited = resolveAdvanced(key, { app });
        return (
          <AdvancedField
            key={key}
            setting={key}
            value={advancedFieldValue(key, config.advanced?.[key])}
            inherited={{ value: inherited.value, source: inherited.source }}
            disabled={disabled}
            onChange={(value) =>
              setConfig((current) => {
                const advanced: Record<string, unknown> = { ...current.advanced };
                if (value === null) delete advanced[key];
                else advanced[key] = value;
                return { ...current, advanced };
              })
            }
          />
        );
      })}
    </div>
  );
}
