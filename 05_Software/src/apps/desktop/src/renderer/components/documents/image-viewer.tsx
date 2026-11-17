import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../error-message.js";
import { type ImageFile, readImageBlob } from "./image-source.js";
import "./image-viewer.css";

type Size = { width: number; height: number };
const zooms = [25, 50, 75, 100, 125, 150, 200, 300, 400];

/** A Blob-backed img keeps SVG in the browser's inert image context, never the live document. */
export function ImageViewer({ file, retry }: { file: ImageFile; retry?: (() => void) | undefined }) {
  const { t } = useTranslation();
  const [natural, setNatural] = useState<Size>();
  const [zoom, setZoom] = useState("fit");
  const [resource, setResource] = useState<{ file: ImageFile; url: string }>();
  const [failure, setFailure] = useState<{ error: unknown } | "decode">();
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setResource(undefined);
    setNatural(undefined);
    setFailure(undefined);
    setZoom("fit");
    void readImageBlob(file, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResource({ file, url });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure({ error });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  const fit = zoom === "fit";
  const width = natural && !fit ? (natural.width * Number(zoom)) / 100 : undefined;
  const height = natural && !fit ? (natural.height * Number(zoom)) / 100 : undefined;
  return (
    <div className="image-viewer" data-image-viewer>
      <div className="image-toolbar">
        <label>
          {t("documents.imageZoom")}
          <select data-image-zoom value={zoom} onChange={(event) => setZoom(event.target.value)}>
            <option value="fit">{t("documents.imageFit")}</option>
            {zooms.map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </label>
      </div>
      {failure !== undefined && (
        <div className="image-error">
          {failure === "decode" ? (
            <p role="alert">{t("documents.imageError")}</p>
          ) : (
            <ErrorMessage error={failure.error} />
          )}
          <button type="button" data-image-retry onClick={retry}>
            {t("settings.retry")}
          </button>
        </div>
      )}
      <div className="image-viewport" data-image-viewport>
        {failure === undefined && resource?.file === file ? (
          <div className="image-stage" data-image-fit={fit || undefined} style={{ width, height }}>
            <img
              data-image-preview
              src={resource.url}
              alt={t("documents.imagePreview")}
              draggable={false}
              style={{
                width,
                height,
                maxWidth: fit ? "100%" : undefined,
                maxHeight: fit ? "100%" : undefined,
                visibility: natural ? "visible" : "hidden",
              }}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth > 0 && image.naturalHeight > 0)
                  setNatural({ width: image.naturalWidth, height: image.naturalHeight });
              }}
              onError={() => {
                URL.revokeObjectURL(resource.url);
                setResource(undefined);
                setFailure("decode");
              }}
            />
          </div>
        ) : failure === undefined ? (
          <p role="status">{t("home.loading")}</p>
        ) : null}
      </div>
    </div>
  );
}
