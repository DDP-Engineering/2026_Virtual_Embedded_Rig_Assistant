import {
  type BuiltinToolName,
  electricalModelEcosystems,
  electricalModelToolNames,
  electricalPluginTools,
  officialPluginToolNames,
  type PluginSummary,
  pluginToolNames,
  pluginToolProviders,
} from "@vera/shared";
import { useTranslation } from "react-i18next";
import { WorkbenchTools } from "./workbench-tools.js";

export interface CapabilityControls {
  disabledTools: readonly string[];
  toggleTool: (name: BuiltinToolName, allowed: boolean) => void;
  locked: boolean;
}

/** Tool allowances are independent of plugin selection, including while a dependency is unavailable. */
export function WorkbenchPluginCapabilities({
  plugin,
  selected,
  ...controls
}: CapabilityControls & { plugin: PluginSummary; selected: boolean }) {
  const { t } = useTranslation();
  const names = pluginToolNames.filter((name) => pluginToolProviders[name] === plugin.id);
  const official = names.some((name) => officialPluginToolNames.includes(name));
  const state = plugin.issues.length
    ? t("pluginCapabilities.unloadable")
    : official && plugin.tier !== "official"
      ? t("pluginCapabilities.officialOnly")
      : names.some((name) => name in electricalPluginTools) &&
          !electricalModelEcosystems.includes(plugin.ecosystem ?? "")
        ? t("pluginCapabilities.noProvider")
        : !selected
          ? t("pluginCapabilities.disabled")
          : undefined;
  if (names.length === 0) return null;
  return (
    <fieldset className="workbench-capabilities" title={t("pluginCapabilities.allowanceHelp")}>
      <legend>{t("pluginCapabilities.allowedTools")}</legend>
      {state && (
        <p className="muted" data-capability-dependency={plugin.id}>
          {state}
        </p>
      )}
      {names.includes("parts_search") && <p className="muted">{t("pluginCapabilities.partsRequirements")}</p>}
      <WorkbenchTools
        names={names}
        disabled={controls.disabledTools}
        toggle={controls.toggleTool}
        locked={controls.locked}
      />
    </fieldset>
  );
}

/** Shared ecosystem tools have one location, independent of the number of eligible plugins. */
export function WorkbenchSharedCapabilities({
  plugins,
  enabled,
  ...controls
}: CapabilityControls & { plugins: readonly PluginSummary[]; enabled: readonly string[] }) {
  const { t } = useTranslation();
  const providers = plugins.filter((plugin) => electricalModelEcosystems.includes(plugin.ecosystem ?? ""));
  const active = providers.filter((plugin) => enabled.includes(plugin.id) && !plugin.issues.length);
  if (!providers.length) return null;
  return (
    <details
      className="workbench-capabilities"
      data-shared-capabilities
      title={t("pluginCapabilities.allowanceHelp")}
    >
      <summary>{t("pluginCapabilities.shared")}</summary>
      <p>{t("pluginCapabilities.ecosystemDependency")}</p>
      <p data-shared-dependency>
        {active.length
          ? t("pluginCapabilities.activeProviders", {
              providers: active.map((plugin) => plugin.name ?? plugin.id).join(", "),
            })
          : t("pluginCapabilities.noProvider")}
      </p>
      <WorkbenchTools
        names={electricalModelToolNames}
        disabled={controls.disabledTools}
        toggle={controls.toggleTool}
        locked={controls.locked}
      />
    </details>
  );
}
