// REQ-UX-492e89fb REQ-UX-157f139c
import type { PluginParameters, PluginProgramStatus } from "@vera/shared";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ConfigurationView } from "./plugin-configuration.js";
import { automaticProgram } from "./plugin-dependencies.js";
import type { ProgramReadiness } from "./plugin-library.js";

export type CheckState = "ready" | "missing" | "unavailable" | "external" | "unchecked";
/** One check of the status block, with the names it reports (programs, plugins or parameters). */
export interface StatusCheck {
  state: CheckState;
  names: string[];
}

/**
 * Unavailable when the check failed or a program is unavailable; missing when a required plugin is not installed or
 * a program VERA installs is missing; external when only vendor programs are missing; unchecked before a check.
 */
export function dependencyCheck(
  statuses: readonly PluginProgramStatus[] | undefined,
  failed: boolean,
  missingPlugins: readonly string[],
): StatusCheck {
  if (failed) return { state: "unavailable", names: [] };
  const named = (keep: (status: PluginProgramStatus) => boolean) =>
    (statuses ?? []).filter(keep).map((status) => status.name);
  const unavailable = named((status) => status.state === "unavailable");
  if (unavailable.length) return { state: "unavailable", names: unavailable };
  const missing = [
    ...missingPlugins,
    ...named((status) => status.state === "missing" && automaticProgram(status)),
  ];
  if (missing.length) return { state: "missing", names: missing };
  const external = named((status) => status.state === "missing");
  if (external.length) return { state: "external", names: external };
  return { state: statuses ? "ready" : "unchecked", names: [] };
}

/** Ready without parameters; missing names the parameters that need configuration; unchecked until checked. */
export function configurationCheck(
  settings: PluginParameters | undefined,
  view: ConfigurationView | undefined,
): StatusCheck {
  if (!settings || !Object.keys(settings).length) return { state: "ready", names: [] };
  if (view?.needs.length) return { state: "missing", names: [...view.needs] };
  if (!view?.states) return { state: view?.error !== undefined ? "unavailable" : "unchecked", names: [] };
  // A required workbench file stays unchecked while no workbench is open.
  const unchecked = view.states
    .filter((state) => {
      const setting = settings[state.name];
      return state.state === "unchecked" && !(setting?.kind === "workbench-file" && setting.optional);
    })
    .map((state) => state.name);
  return { state: unchecked.length ? "unchecked" : "ready", names: unchecked };
}

/**
 * One status block per installed plugin: Dependencies, Configuration and Use, each with its state and action. Ready
 * only when all three are ready; otherwise the summary names the checks that are not.
 */
export function PluginStatus({
  dependencies,
  programs,
  configuration,
  declared,
  configure,
  readiness,
}: {
  dependencies?: StatusCheck | undefined;
  /** The program summary: checking, n/m ready, no programs or not checked. */
  programs: string | undefined;
  configuration: StatusCheck;
  /** The manifest declares parameters: Configure opens them. */
  declared: boolean;
  configure: () => void;
  /** The library readiness (filter Needs configuration), kept on the block for the library and its tests. */
  readiness: ProgramReadiness;
}) {
  const { t } = useTranslation();
  const label = {
    dependencies: t("plugins.status.dependencies"),
    configuration: t("plugins.status.configuration"),
  };
  const state: Record<CheckState, string> = {
    ready: t("plugins.status.state.ready"),
    missing: t("plugins.status.state.missing"),
    unavailable: t("plugins.status.state.unavailable"),
    external: t("plugins.status.state.external"),
    unchecked: t("plugins.status.state.unchecked"),
  };
  const pending = [
    ...(dependencies && dependencies.state !== "ready" ? [label.dependencies] : []),
    ...(declared && configuration.state !== "ready" ? [label.configuration] : []),
  ];
  const names = dependencies?.names.join(", ") ?? "";
  const dependencyText =
    dependencies?.state === "missing"
      ? t("plugins.status.missingNames", { names })
      : dependencies?.state === "external"
        ? t("plugins.status.externalNames", { names })
        : dependencies?.state === "unavailable"
          ? names
            ? t("plugins.status.unavailableNames", { names })
            : t("plugins.library.readinessUnavailable")
          : programs;
  const configurationText =
    configuration.state === "missing"
      ? t("plugins.configuration.needs", { names: configuration.names.join(", ") })
      : configuration.state === "unavailable"
        ? t("plugins.status.configurationFailed")
        : configuration.state === "unchecked"
          ? configuration.names.length
            ? t("plugins.configuration.noWorkbench")
            : t("plugins.checking")
          : undefined;
  const row = (key: keyof typeof label, check: StatusCheck, text: string | undefined, action?: ReactNode) => (
    <li data-status-check={key} data-state={check.state}>
      <strong>{label[key]}</strong>
      <span className="risk-badge" data-state={check.state}>
        {state[check.state]}
      </span>
      {text && <span className="muted">{text}</span>}
      {action && <span className="workbench-actions">{action}</span>}
    </li>
  );
  return (
    <section
      className="plugin-status"
      data-plugin-status={pending.length ? "attention" : "ready"}
      data-readiness={readiness}
      aria-label={t("plugins.status.title")}
    >
      <p role="status" data-status-summary>
        {pending.length
          ? t("plugins.status.notReady", { checks: pending.join(", ") })
          : t("plugins.status.ready")}
      </p>
      <ul>
        {dependencies && row("dependencies", dependencies, dependencyText)}
        {declared &&
          row(
            "configuration",
            configuration,
            configurationText,
            <button type="button" data-action="status-configure" onClick={configure}>
              {t("plugins.status.configure")}
            </button>,
          )}
      </ul>
    </section>
  );
}
