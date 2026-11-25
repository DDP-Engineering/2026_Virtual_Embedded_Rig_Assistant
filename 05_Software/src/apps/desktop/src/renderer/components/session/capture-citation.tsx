import { ExternalLink } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

export function CaptureCitation({
  sessionId,
  messageId,
  reference,
  frame,
}: {
  sessionId: string;
  messageId: string;
  reference: string;
  frame: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="citation"
        aria-haspopup="dialog"
        data-citation="valid"
        data-citation-kind="capture"
        onClick={() => setOpen(true)}
      >
        <ExternalLink width="1em" height="1em" aria-hidden="true" /> {t("wireshark.openFrame", { frame })}
      </button>
      {open &&
        createPortal(
          <CaptureDialog
            request={{ sessionId, messageId, ref: reference }}
            frame={frame}
            close={() => {
              setOpen(false);
              button.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function CaptureDialog({
  request,
  frame,
  close,
}: {
  request: { sessionId: string; messageId: string; ref: string };
  frame: number;
  close: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [adjusted, setAdjusted] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function openFrame(event: FormEvent) {
    event.preventDefault();
    if (pending || adjusted) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await api.invoke("wireshark.openFrame", {
        ...request,
        ...(filter.trim() && { filter: filter.trim() }),
      });
      if (result.filterAdjusted) setAdjusted(true);
      else close();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) close();
      }}
    >
      <h3 id={title}>{t("wireshark.openFrame", { frame })}</h3>
      {adjusted ? (
        <>
          <p role="status">{t("wireshark.filterAdjusted", { frame })}</p>
          <div className="workbench-actions">
            <button type="button" onClick={close}>
              {t("wireshark.close")}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void openFrame(event)}>
          <label>
            {t("wireshark.displayFilter")}
            <input
              value={filter}
              maxLength={1024}
              disabled={pending}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          {pending && <p role="status">{t("wireshark.opening")}</p>}
          {error != null && <ErrorMessage error={error} />}
          <div className="workbench-actions">
            <button type="button" onClick={close} disabled={pending}>
              {t("providers.cancel")}
            </button>
            <button type="submit" className="primary" disabled={pending}>
              {t("wireshark.open")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
