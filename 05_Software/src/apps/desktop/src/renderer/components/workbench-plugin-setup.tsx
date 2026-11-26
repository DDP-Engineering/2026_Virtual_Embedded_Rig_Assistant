import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginSummary } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { observeProgramAction } from "../hooks/use-run-presentation.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";
import { type ProgramReadiness, pluginProgramsKey } from "./plugin-library.js";
import { Programs } from "./plugins.js";

/** Setup stays available independently of the plugin selection draft. */
export function WorkbenchPluginSetup({
  plugin,
  workbenchId,
  locked,
  executionAllowed,
  readiness,
  status,
}: {
  plugin: PluginSummary;
  workbenchId: string | undefined;
  locked: boolean;
  executionAllowed: boolean;
  readiness: ProgramReadiness;
  status: string;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const { rows, pager } = usePaged(Object.keys(plugin.manifest?.programs ?? {}));
  const queryKey = pluginProgramsKey(workbenchId, plugin);
  const request = { id: plugin.id, ...(workbenchId ? { workbenchId } : {}) };
  const programs = useQuery({
    queryKey,
    queryFn: () => api.invoke("plugins.programs", request),
    enabled: false,
    staleTime: Infinity,
  });
  const installable =
    !programs.isError &&
    programs.data?.some(
      (status) =>
        status.kind !== "find" &&
        (!status.external || status.downloadAvailable) &&
        status.problem !== "platform" &&
        status.problem !== "uv" &&
        (status.state === "missing" ||
          (status.state === "unavailable" && ["version", "range"].includes(status.problem ?? "")) ||
          status.downloadAvailable),
    );
  async function act(kind: "check" | "provision" | "archive", program?: string) {
    if (locked || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await observeProgramAction(client, queryKey, request, () =>
        kind === "archive"
          ? api.invoke("plugins.installArchive", {
              ...request,
              program: program ?? "",
              sha256: plugin.sha256 ?? "",
            })
          : kind === "check"
            ? api.invoke("plugins.check", request)
            : api.invoke("plugins.provision", request),
      );
    } catch (failure) {
      if (live.current) setError(failure);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section data-workbench-configuration title={t("pluginCapabilities.programHelp")}>
      <h4>{t("pluginCapabilities.programs")}</h4>
      {(readiness === "unchecked" || readiness === "ready") && (
        <p className="muted" data-readiness={readiness}>
          {status}
        </p>
      )}
      {plugin.manifest && (
        <p className="muted">
          {executionAllowed
            ? t("pluginCapabilities.executionAllowed")
            : t("pluginCapabilities.executionDisabled")}
        </p>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="plugin-card-actions">
        <button
          type="button"
          data-action="plugin-check"
          disabled={locked || busy}
          onClick={() => void act("check")}
        >
          {busy ? t("plugins.checking") : t("plugins.checkDependencies")}
        </button>
        <button
          type="button"
          data-action="plugin-provision"
          disabled={locked || busy || !installable}
          onClick={() => void act("provision")}
        >
          {t("plugins.installDependencies")}
        </button>
      </div>
      {programs.data ? (
        <Programs
          statuses={programs.data}
          busy={busy}
          {...(!locked ? { archive: (name: string) => void act("archive", name) } : {})}
        />
      ) : (
        rows.length > 0 && (
          <div data-plugin-programs>
            <ul className="workbench-plugin-programs">
              {rows.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
            <Pager {...pager} />
          </div>
        )
      )}
    </section>
  );
}
