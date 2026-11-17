import type { MaskingArea, WorkbenchConfig } from "@vera/shared";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsSnapshot } from "../hooks/use-preferences.js";
import { ErrorMessage } from "./error-message.js";
import { appMaskingValues, PrivacyControls } from "./privacy-controls.js";

export function WorkbenchPrivacy({
  config,
  setConfig,
  disabled,
}: {
  config: WorkbenchConfig;
  setConfig: Dispatch<SetStateAction<WorkbenchConfig>>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const snapshot = useSettingsSnapshot();
  const mask = config.privacy?.mask;
  const values = {
    display: mask?.display ?? "default",
    runs: mask?.runs ?? "default",
    agent: mask?.agent ?? "default",
    exports: mask?.exports ?? "default",
  };
  return (
    <>
      {snapshot.error && (
        <>
          <ErrorMessage error={snapshot.error} />
          <button type="button" onClick={() => void snapshot.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {snapshot.isPending && <p role="status">{t("privacy.loading")}</p>}
      {snapshot.data && (
        <PrivacyControls
          values={values}
          inherited={appMaskingValues(snapshot.data.settings.privacy)}
          disabled={disabled || snapshot.isError}
          change={(area: MaskingArea, choice) => {
            if (typeof choice === "boolean") return;
            setConfig((current) => ({
              ...current,
              privacy: { ...current.privacy, mask: { ...current.privacy?.mask, [area]: choice } },
            }));
          }}
        />
      )}
    </>
  );
}
