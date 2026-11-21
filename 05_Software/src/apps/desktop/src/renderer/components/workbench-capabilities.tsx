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
import { Pager, usePaged } from "./pager.js";
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
          : t("pluginCapabilities.enabled");
  const programs = Object.keys(plugin.manifest?.programs ?? {});
  const { rows, pager } = usePaged(programs);
  return (
    <>
      {names.length > 0 && (
        <fieldset className="workbench-capabilities" title={t("pluginCapabilities.allowanceHelp")}>
          <legend>{t("pluginCapabilities.allowedTools")}</legend>
          <p data-capability-dependency={plugin.id}>
            {t("pluginCapabilities.provider", { id: plugin.id })} · {state}
          </p>
          {names.includes("parts_search") && (
            <p className="muted">{t("pluginCapabilities.partsRequirements")}</p>
          )}
          <WorkbenchTools
            names={names}
            disabled={controls.disabledTools}
            toggle={controls.toggleTool}
            locked={controls.locked}
          />
        </fieldset>
      )}
      {programs.length > 0 && (
        <details data-plugin-programs title={t("pluginCapabilities.programHelp")}>
          <summary>{t("pluginCapabilities.programs")}</summary>
          <p>
            {state} ·{" "}
            {controls.disabledTools.includes("run_program")
              ? t("pluginCapabilities.executionDisabled")
              : t("pluginCapabilities.executionAllowed")}
          </p>
          <ul>
            {rows.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <Pager {...pager} />
        </details>
      )}
    </>
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
  const missing = [...new Set(Object.values(pluginToolProviders))].filter(
    (id) => !plugins.some((plugin) => plugin.id === id),
  );
  return (
    <>
      <fieldset
        className="workbench-capabilities"
        data-shared-capabilities
        title={t("pluginCapabilities.allowanceHelp")}
      >
        <legend>{t("pluginCapabilities.shared")}</legend>
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
      </fieldset>
      {missing.length > 0 && (
        <details data-missing-capabilities>
          <summary>{t("pluginCapabilities.notInstalled")}</summary>
          <ul className="plugin-library-list">
            {missing.map((id) => (
              <li className="plugin-card" key={id}>
                <WorkbenchPluginCapabilities
                  plugin={{ id, issues: [{ code: "unavailable" }], enabled: false }}
                  selected={false}
                  {...controls}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
