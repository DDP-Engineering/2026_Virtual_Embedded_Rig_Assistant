import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Asks before saving a model change that replaces the workbench's vectors. */
export function EmbeddingSwitchDialog({
  count,
  cancel,
  confirm,
}: {
  count: number;
  cancel: () => void;
  confirm: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const dismiss = () => {
    dialog.current?.close();
    cancel();
  };
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <h3 id={title}>{t("projects.embeddingSwitchTitle")}</h3>
      <div id={description}>
        <p>{t("projects.embeddingSwitchCount", { count })}</p>
        <p>{t("projects.embeddingSwitchBody")}</p>
      </div>
      <div className="workbench-actions">
        <button type="button" onClick={dismiss}>
          {t("projects.cancel")}
        </button>
        <button type="button" className="primary" onClick={confirm}>
          {t("projects.embeddingSwitchConfirm")}
        </button>
      </div>
    </dialog>
  );
}
