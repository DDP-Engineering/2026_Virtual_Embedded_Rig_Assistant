import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
export function ConsentDialog({
  pending,
  choice,
  cancel,
}: {
  pending: boolean;
  choice: (consent: boolean) => Promise<void>;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const text = useId();
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="pinned-dialog"
      aria-labelledby={title}
      aria-describedby={text}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) cancel();
      }}
    >
      <h3 id={title}>{t("providers.consentTitle")}</h3>
      <p id={text}>{t("providers.consentWarning")}</p>
      <div className="workbench-actions">
        <button type="button" disabled={pending} onClick={() => void choice(false)}>
          {t("providers.memoryChoice")}
        </button>
        <button type="button" disabled={pending} onClick={() => void choice(true)}>
          {t("providers.diskChoice")}
        </button>
        <button type="button" disabled={pending} onClick={cancel}>
          {t("providers.cancel")}
        </button>
      </div>
    </dialog>
  );
}
