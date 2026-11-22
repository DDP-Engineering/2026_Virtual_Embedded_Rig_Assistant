import { useMutation } from "@tanstack/react-query";
import type { BrowserRuntimeView, Response } from "@vera/shared";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { browserFailureText } from "../lib/browser-failure.js";
import { ErrorMessage } from "./error-message.js";

type RuntimeAction = "browser.runtime.install" | "browser.runtime.installFile" | "browser.runtime.remove";

/**
 * Interactive Browser on the Web access page. Runtime install, cancel and remove are immediate actions; the
 * application and workbench switches belong to the page draft and are saved with the page header Save.
 */
export function BrowserSettings({
  settings,
  error: loadError,
  refetch,
  appEnabled,
  workbenchEnabled,
  setApp,
  setWorkbench,
  disabled,
}: {
  settings: Response<"browser.settings.get"> | undefined;
  error: unknown;
  refetch: () => unknown;
  appEnabled: boolean;
  workbenchEnabled: boolean;
  setApp: (enabled: boolean) => void;
  setWorkbench: (enabled: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const runtime = useMutation({
    networkMode: "always",
    mutationFn: (action: RuntimeAction) => api.invoke(action, {}),
    onSettled: () => refetch(),
  });
  const cancel = useMutation({
    networkMode: "always",
    mutationFn: () => api.invoke("browser.runtime.cancel", {}),
    onSettled: () => refetch(),
  });
  const status = settings?.runtime;
  const phase = status?.phase ?? "unknown";
  const provisioning = phase === "verifying" || phase === "downloading" || phase === "installing";
  const canInstall =
    phase === "missing" ||
    phase === "cancelled" ||
    (status?.phase === "failed" && status.failure !== "unsupported-platform");
  const canRemove =
    phase === "ready" ||
    (status?.phase === "failed" && (status.failure === "cleanup" || status.failure === "integrity"));
  const error = loadError ?? runtime.error ?? cancel.error;
  const bench = settings?.workbench;

  return (
    <fieldset className="browser-settings">
      <legend>{t("browser.title")}</legend>
      <p role="status" data-browser-runtime={phase}>
        <RuntimeMessage status={status} />
      </p>
      {Boolean(error) && <ErrorMessage error={error} />}
      <div className="workbench-actions">
        {canInstall && (
          <>
            <button
              type="button"
              disabled={runtime.isPending}
              onClick={() => runtime.mutate("browser.runtime.install")}
            >
              {t("browser.install")}
            </button>
            <button
              type="button"
              data-action="browser-install-file"
              disabled={runtime.isPending}
              onClick={() => runtime.mutate("browser.runtime.installFile")}
            >
              {t("browser.installFile")}
            </button>
          </>
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
          data-browser-app
          checked={appEnabled}
          disabled={!settings || disabled}
          onChange={(event) => setApp(event.target.checked)}
        />
        {t("browser.enableApp")}
      </label>
      <label className="web-access-toggle">
        <input
          type="checkbox"
          data-browser-workbench
          checked={workbenchEnabled}
          disabled={!bench || bench.readOnly || disabled}
          onChange={(event) => setWorkbench(event.target.checked)}
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
