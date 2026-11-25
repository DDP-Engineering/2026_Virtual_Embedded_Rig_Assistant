import {
  type MaskingArea,
  maskingAreaSchema,
  maskingDefaults,
  type Settings,
  type WorkbenchMaskingChoice,
} from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

type Choice = boolean | WorkbenchMaskingChoice;
/** App values for controls and inherited labels, including omitted preferences. */
export function appMaskingValues(privacy: Settings["privacy"]): Record<MaskingArea, boolean> {
  return {
    display: privacy?.mask?.display ?? maskingDefaults.display,
    runs: privacy?.mask?.runs ?? maskingDefaults.runs,
    agent: privacy?.mask?.agent ?? maskingDefaults.agent,
    exports: privacy?.mask?.exports ?? maskingDefaults.exports,
  };
}
export function PrivacyControls({
  values,
  inherited,
  disabled,
  change,
}: {
  values: Record<MaskingArea, Choice>;
  inherited?: Record<MaskingArea, boolean>;
  disabled: boolean;
  change: (area: MaskingArea, choice: Choice) => void;
}) {
  const { t } = useTranslation();
  const labels = {
    display: t("privacy.display"),
    runs: t("privacy.runs"),
    agent: t("privacy.agent"),
    exports: t("privacy.exports"),
  };
  const [warning, setWarning] = useState<{ choice: Choice; opener: HTMLElement }>();
  const id = useId();
  const effective = (choice: Choice) =>
    typeof choice === "boolean"
      ? choice
      : choice === "on" || (choice === "default" && inherited?.agent === true);
  function choose(area: MaskingArea, choice: Choice, opener: HTMLElement) {
    if (disabled) return;
    if (area === "agent" && effective(values.agent) && !effective(choice)) setWarning({ choice, opener });
    else change(area, choice);
  }
  return (
    <>
      <h4>{t("privacy.maskTitle")}</h4>
      <div className="settings-columns" data-privacy-controls>
        {maskingAreaSchema.options.map((area) => (
          <label key={area} data-mask-area={area} htmlFor={`${id}-${area}`}>
            {labels[area]}
            {inherited ? (
              <select
                id={`${id}-${area}`}
                disabled={disabled}
                value={String(values[area])}
                onChange={(event) =>
                  choose(area, event.target.value as WorkbenchMaskingChoice, event.currentTarget)
                }
              >
                <option value="default">
                  {t("privacy.default", { value: inherited[area] ? t("privacy.on") : t("privacy.off") })}
                </option>
                <option value="on">{t("privacy.on")}</option>
                <option value="off">{t("privacy.off")}</option>
              </select>
            ) : (
              <input
                id={`${id}-${area}`}
                type="checkbox"
                role="switch"
                aria-checked={values[area] === true}
                disabled={disabled}
                checked={values[area] === true}
                onChange={(event) => choose(area, event.target.checked, event.currentTarget)}
              />
            )}
          </label>
        ))}
      </div>
      {warning &&
        createPortal(
          <AgentMaskWarning
            opener={warning.opener}
            disabled={disabled}
            cancel={() => setWarning(undefined)}
            confirm={() => {
              if (disabled) return;
              change("agent", warning.choice);
              setWarning(undefined);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function AgentMaskWarning({
  opener,
  disabled,
  cancel,
  confirm,
}: {
  opener: HTMLElement;
  disabled: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  const { t } = useTranslation();
  const title = useId(),
    description = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>('[data-action="cancel-mask-off"]')?.focus();
    return () => {
      node?.close();
      if (opener.isConnected) opener.focus();
    };
  }, [opener]);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog bypass-warning"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <header>
        <h2 id={title}>{t("privacy.confirmTitle")}</h2>
      </header>
      <p id={description}>{t("privacy.warning")}</p>
      <footer>
        <button type="button" data-action="cancel-mask-off" onClick={cancel}>
          {t("workbench.cancel")}
        </button>
        <button
          type="button"
          className="primary"
          data-action="confirm-mask-off"
          disabled={disabled}
          onClick={confirm}
        >
          {t("privacy.confirm")}
        </button>
      </footer>
    </dialog>
  );
}
