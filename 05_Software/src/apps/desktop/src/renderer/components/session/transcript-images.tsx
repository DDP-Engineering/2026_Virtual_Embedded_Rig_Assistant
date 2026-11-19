// REQ-UX-9c6aa149 REQ-UX-482d2ced REQ-UX-16e08c34
import type { Response } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { CHAT, useDocumentTabs, useDocumentViewer } from "../documents/viewer-context.js";
import "./transcript-images.css";

type Preview = Response<"docs.imageThumbnail">;

export function TranscriptImages({ workbenchId, paths }: { workbenchId: string; paths: string[] }) {
  const list = useRef<HTMLUListElement>(null);
  const showingChat = (useDocumentTabs()?.active ?? CHAT) === CHAT;
  const [visible, setVisible] = useState(false);
  const [refresh, setRefresh] = useState({ maskRevision: 0 });
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    if (typeof IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const refreshFile = () => setRefresh((value) => ({ ...value }));
    const refreshMask = () => setRefresh(({ maskRevision }) => ({ maskRevision: maskRevision + 1 }));
    const offApp = api.subscribe("app", (event) => {
      if (event.type === "settings.changed" && event.masking !== false) refreshMask();
    });
    const offWorkbench = api.subscribe("workbench", workbenchId, (event) => {
      if (event.type === "config.changed") refreshMask();
    });
    window.addEventListener("focus", refreshFile);
    return () => {
      offApp();
      offWorkbench();
      window.removeEventListener("focus", refreshFile);
    };
  }, [workbenchId]);

  return (
    <ul className="transcript-images" ref={list}>
      {paths.map((path, index) => (
        <TranscriptImage
          // biome-ignore lint/suspicious/noArrayIndexKey: Persisted image order is fixed and paths may repeat.
          key={`${index}/${path}`}
          workbenchId={workbenchId}
          path={path}
          visible={visible}
          showingChat={showingChat}
          refresh={refresh}
        />
      ))}
    </ul>
  );
}

type LoadedImage = { format: NonNullable<Preview["preview"]>["format"]; url: string };
type Result = {
  maskRevision: number;
  data?: Omit<Preview, "preview">;
  image?: LoadedImage;
};

function releaseThumbnail(resource: { current: string | undefined }) {
  if (resource.current) URL.revokeObjectURL(resource.current);
  resource.current = undefined;
}

function TranscriptImage({
  workbenchId,
  path,
  visible,
  showingChat,
  refresh,
}: {
  workbenchId: string;
  path: string;
  visible: boolean;
  showingChat: boolean;
  refresh: { maskRevision: number };
}) {
  const { t } = useTranslation();
  const openDocument = useDocumentViewer();
  const [result, setResult] = useState<Result>();
  const resource = useRef<string>(undefined);
  const { maskRevision } = refresh;
  useEffect(() => {
    void maskRevision;
    return () => releaseThumbnail(resource);
  }, [maskRevision]);

  useEffect(() => {
    if (!visible) {
      releaseThumbnail(resource);
      setResult((previous) => (previous?.image ? undefined : previous));
      return;
    }
    if (!showingChat) return;
    const { maskRevision } = refresh;
    let active = true;
    void api
      .invoke("docs.imageThumbnail", { workbenchId, path })
      .then(({ preview, ...data }) => {
        if (!active) return;
        if (data.workbenchId !== workbenchId) throw Error("Image workbench mismatch");
        releaseThumbnail(resource);
        if (!preview) {
          setResult({ maskRevision, data });
          return;
        }
        const bytes = Uint8Array.from(atob(preview.thumbnail), (character) => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        resource.current = url;
        setResult({ maskRevision, data, image: { format: preview.format, url } });
      })
      .catch(() => {
        if (!active) return;
        releaseThumbnail(resource);
        setResult({ maskRevision });
      });
    return () => {
      active = false;
    };
  }, [visible, showingChat, refresh, workbenchId, path]);

  const current = result?.maskRevision === maskRevision ? result : undefined;
  const data = current?.data;
  const image = current?.image;
  return (
    <li>
      {data && image && visible ? (
        <button
          type="button"
          className="transcript-image-preview"
          aria-label={t("chat.openImage", { path: data.displayPath })}
          title={data.displayPath}
          onClick={() => openDocument?.({ path: data.path }, image.format)}
        >
          <img
            src={image.url}
            alt=""
            draggable={false}
            onError={() => {
              if (resource.current !== image.url) return;
              releaseThumbnail(resource);
              setResult({ maskRevision, data });
            }}
          />
        </button>
      ) : current && !image ? (
        <span className="transcript-image-path">{data?.displayPath ?? t("chat.imageUnavailable")}</span>
      ) : (
        <span className="transcript-image-placeholder" aria-hidden="true" />
      )}
    </li>
  );
}
