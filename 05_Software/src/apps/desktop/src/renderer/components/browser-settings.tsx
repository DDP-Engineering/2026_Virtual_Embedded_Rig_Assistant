import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BrowserRuntimeView, Response } from "@vera/shared";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { browserFailureText } from "../lib/browser-failure.js";
import { ErrorMessage } from "./error-message.js";

type RuntimeAction = "browser.runtime.install" | "browser.runtime.remove";

export function BrowserSettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ["browser.settings.get"];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.invoke("browser.settings.get", {}),
    refetchInterval: 500,
    networkMode: "always",
  });
  const runtime = useMutation({
    networkMode: "always",
    mutationFn: (action: RuntimeAction) => api.invoke(action, {}),
    onSettled: () => query.refetch(),
  });
  const cancel = useMutation({
    networkMode: "always",
    mutationFn: () => api.invoke("browser.runtime.cancel", {}),
    onSettled: () => query.refetch(),
  });
  const optIn = useMutation({
    networkMode: "always",
    mutationFn: async ({ enabled, workbenchId }: { enabled: boolean; workbenchId?: string }) => {
      if (workbenchId) {
        const changed = await api.invoke("workbench.config.update", {
          workbenchId,
          patch: { interactive_browser: enabled },
        });
        await client.cancelQueries({ queryKey: ["workbench.active"] });
        client.setQueryData<Response<"workbench.config.get"> | null>(["workbench.active"], (current) =>
          current?.config.id === workbenchId ? { ...current, ...changed } : current,
        );
      } else {
        const changed = await api.updateSettings({ interactiveBrowser: enabled });
        await client.cancelQueries({ queryKey: ["app.settings"] });
        client.setQueryData(["app.settings"], changed);
      }
    },
    onSettled: () => query.refetch(),
  });
  const status = query.data?.runtime;
  const phase = status?.phase ?? "unknown";
  const provisioning = phase === "verifying" || phase === "downloading" || phase === "installing";
  const canInstall =
    phase === "missing" ||
    phase === "cancelled" ||
    (status?.phase === "failed" && status.failure !== "unsupported-platform");
  const canRemove =
    phase === "ready" ||
    (status?.phase === "failed" && (status.failure === "cleanup" || status.failure === "integrity"));
  const error = query.error ?? runtime.error ?? cancel.error ?? optIn.error;
  const bench = query.data?.workbench;

  return (
    <fieldset className="browser-settings">
      <legend>{t("browser.title")}</legend>
      <p role="status" data-browser-runtime={phase}>
        <RuntimeMessage status={status} />
      </p>
      {error && <ErrorMessage error={error} />}
      <div className="workbench-actions">
        {canInstall && (
          <button
            type="button"
            disabled={runtime.isPending}
            onClick={() => runtime.mutate("browser.runtime.install")}
          >
            {t("browser.install")}
          </button>
        )}
        {provisioning && (
          <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {t("browser.cancelInstall")}
          </button>
        )}
        {canRemove && (
          <button
            type="button"
            disabled={runtime.isPending}
            onClick={() => runtime.mutate("browser.runtime.remove")}
          >
            {t("browser.remove")}
          </button>
        )}
      </div>
      <label className="web-access-toggle">
        <input
          type="checkbox"
          checked={query.data?.appEnabled ?? false}
          disabled={!query.data || optIn.isPending}
          onChange={(event) => optIn.mutate({ enabled: event.target.checked })}
        />
        {t("browser.enableApp")}
      </label>
      <label className="web-access-toggle">
        <input
          type="checkbox"
          checked={bench?.enabled ?? false}
          disabled={!bench || bench.readOnly || optIn.isPending}
          onChange={(event) => {
            if (bench) optIn.mutate({ enabled: event.target.checked, workbenchId: bench.id });
          }}
        />
        {t("browser.enableWorkbench")}
      </label>
    </fieldset>
  );
}

const phaseMessages = {
  unknown: (t) => t("browser.runtime.unknown"),
  missing: (t) => t("browser.runtime.missing"),
  verifying: (t) => t("browser.runtime.verifying"),
  installing: (t) => t("browser.runtime.installing"),
  cancelled: (t) => t("browser.runtime.cancelled"),
  removing: (t) => t("browser.runtime.removing"),
} satisfies Record<string, (t: TFunction) => string>;

function RuntimeMessage({ status }: { status: BrowserRuntimeView | undefined }) {
  const { t } = useTranslation();
  if (status?.phase === "failed") return browserFailureText(t, status.failure);
  if (status?.phase === "ready") return t("browser.runtime.ready", { version: status.version });
  if (status?.phase === "downloading")
    return t("browser.runtime.downloading", { percent: Math.floor((100 * status.received) / status.total) });
  return phaseMessages[status?.phase ?? "unknown"](t);
}
