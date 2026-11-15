import type { SessionState } from "@vera/shared";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { UsageMeter } from "./usage-meter.js";

/** The context window dialog: token usage, limits, model, turns and tool calls of the session. */
export function SessionInspector({ state, close }: { state: SessionState; close: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog session-inspector"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={title}>{t("chat.contextWindow")}</h2>
        <button type="button" aria-label={t("panel.close")} onClick={close}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="session-inspector-body">
        <UsageMeter state={state} />
      </div>
      <footer>
        <button type="button" data-action="close-inspector" onClick={close}>
          {t("panel.close")}
        </button>
      </footer>
    </dialog>
  );
}
