import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";

function externalUrl(value: string) {
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password && value.length <= 4096)
      return url.href;
  } catch {
    /* File, script and relative links stay inert. */
  }
  return undefined;
}

/** Never navigate the renderer or load remote assets from generated Markdown. */
export function ExternalSourceLink({ href, children }: { href: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const url = externalUrl(href);
  if (!url) return <span className="markdown-link">{children}</span>;
  return (
    <>
      <button
        type="button"
        className="markdown-link"
        data-web-source={url}
        title={url}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && <ExternalSourceConfirmation url={url} close={() => setOpen(false)} />}
    </>
  );
}

function ExternalSourceConfirmation({ url, close }: { url: string; close: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = useId();
  const description = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const open = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await api.invoke("app.openExternal", { url, confirmed: true });
      close();
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="pinned-dialog"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy.current) close();
      }}
    >
      <h3 id={title}>{t("web.openTitle")}</h3>
      <p id={description}>{t("web.openDescription")}</p>
      <p style={{ overflowWrap: "anywhere" }}>{url}</p>
      {failed && <p role="alert">{t("web.openError")}</p>}
      <div className="workbench-actions">
        <button type="button" data-web-cancel disabled={pending} onClick={close}>
          {t("web.cancel")}
        </button>
        <button type="button" data-web-open disabled={pending} onClick={() => void open()}>
          {t("web.open")}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
