// REQ-UX-efe126c0 REQ-UX-05e0ed17
import type { PluginParameters, PluginSettingState } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "./error-message.js";
import { PartsAccessPanel } from "./parts-access.js";
import { PluginCredentialsPanel } from "./plugin-credentials.js";

/** One plugin's declared parameters and their states, as the configuration query reports them. */
export interface ConfigurationView {
  states?: readonly PluginSettingState[] | undefined;
  /** The parameters that mark the plugin Needs configuration. */
  needs: readonly string[];
  fetching: boolean;
  error?: unknown;
  check: () => void;
}

/**
 * The plugin page's Configuration section, built from the manifest's `settings`: secrets stored or missing with their
 * forms (add, replace, remove), workbench files checked in the open workbench and read-only values.
 */
export function PluginConfiguration({
  settings,
  view,
  workbench,
}: {
  settings: PluginParameters;
  view: ConfigurationView;
  workbench: boolean;
}) {
  const { t } = useTranslation();
  const label: Record<PluginSettingState["state"], string> = {
    stored: t("plugins.configuration.stored"),
    missing: t("plugins.configuration.missing"),
    present: t("plugins.configuration.present"),
    invalid: t("plugins.configuration.invalid"),
    unchecked: t("plugins.configuration.unchecked"),
    value: t("plugins.configuration.value"),
  };
  const states = new Map((view.states ?? []).map((state) => [state.name, state]));
  return (
    <section
      className="plugin-configuration"
      data-plugin-configuration
      aria-label={t("plugins.configuration.title")}
    >
      <strong>{t("plugins.configuration.title")}</strong>
      <ul className="plugin-configuration-list">
        {Object.entries(settings).map(([name, setting]) => {
          const state = states.get(name);
          const needs = view.needs.includes(name);
          return (
            <li
              key={name}
              data-setting={name}
              data-kind={setting.kind}
              data-state={state?.state ?? "checking"}
            >
              <p className="plugin-heading">
                <code>{name}</code>{" "}
                <span className="risk-badge" data-needs={needs}>
                  {state ? label[state.state] : t("plugins.checking")}
                </span>
                {setting.kind === "workbench-file" && setting.optional && (
                  <span className="muted"> {t("plugins.configuration.optional")}</span>
                )}
              </p>
              <p className="muted">{setting.description}</p>
              {setting.kind === "workbench-file" && (
                <p>
                  <code>{setting.path}</code>
                  {state?.state === "present" && state.paths && state.paths.join("/") !== setting.path && (
                    <span className="muted"> {state.paths.join(", ")}</span>
                  )}
                </p>
              )}
              {state?.problem && <p className="plugin-problem">{state.problem}</p>}
              {setting.kind === "value" && <p data-setting-value>{setting.value}</p>}
              {setting.kind === "secret" && state?.state === "stored" && setting.scope === "parts" && (
                <p className="muted">
                  {t("plugins.configuration.suppliers", { names: state.refs?.join(", ") })}
                </p>
              )}
              {setting.kind === "secret" &&
                (setting.scope === "parts" ? (
                  <PartsAccessPanel />
                ) : (
                  <PluginCredentialsPanel scope={setting.scope} />
                ))}
            </li>
          );
        })}
      </ul>
      {view.error !== undefined && <ErrorMessage error={view.error} />}
      {Object.values(settings).some((setting) => setting.kind === "workbench-file") && (
        <div className="workbench-actions">
          <button
            type="button"
            data-action="configuration-check"
            disabled={view.fetching}
            onClick={view.check}
          >
            {view.fetching ? t("plugins.checking") : t("plugins.configuration.check")}
          </button>
          {!workbench && <span className="muted">{t("plugins.configuration.noWorkbench")}</span>}
        </div>
      )}
    </section>
  );
}
