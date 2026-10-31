// REQ-UX-b93197aa
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { veraError, type WebDownload, webDownloadResultSchema } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { useDocumentViewer } from "./viewer-context.js";
import "./downloads.css";

export function downloadFromResult(text: string): WebDownload | undefined {
  try {
    const parsed = webDownloadResultSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.download : undefined;
  } catch {
    return undefined;
  }
}

function DownloadItem({ download }: { download: WebDownload }) {
  const { t, i18n } = useTranslation(),
    open = useDocumentViewer();
  const [error, setError] = useState<unknown>();
  const isPdf = download.mime === "application/pdf";
  return (
    <div className="download-card" data-download={download.downloadId}>
      <div>
        <strong>{download.name}</strong>
        <p className="muted">{t("downloads.source", { host: new URL(download.sourceUrl).hostname })}</p>
        <time dateTime={download.createdAt}>
          {new Date(download.createdAt).toLocaleString(i18n.language)}
        </time>
      </div>
      <button
        type="button"
        disabled={isPdf && !open}
        aria-label={
          isPdf
            ? t("downloads.openNamed", { name: download.name })
            : t("downloads.revealNamed", { name: download.name })
        }
        onClick={() => {
          if (isPdf) open?.({ downloadId: download.downloadId });
          else {
            setError(undefined);
            void api.invoke("app.revealPath", { path: download.path }).catch(setError);
          }
        }}
      >
        {isPdf ? t("downloads.open") : t("downloads.reveal")}
      </button>
      {error !== undefined && <ErrorMessage error={error} />}
    </div>
  );
}

export function DownloadCard({ result }: { result: string }) {
  const download = downloadFromResult(result),
    client = useQueryClient();
  const id = download?.downloadId;
  useEffect(() => {
    if (id) void client.invalidateQueries({ queryKey: ["downloads.list"] });
  }, [id, client]);
  return download ? <DownloadItem download={download} /> : null;
}

export function DownloadsList({ workbenchId }: { workbenchId: string }) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ["downloads.list", workbenchId],
    queryFn: async () => {
      const result = await api.invoke("downloads.list", { workbenchId });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result.downloads;
    },
  });
  if (list.isError)
    return (
      <section aria-label={t("downloads.title")}>
        <ErrorMessage error={list.error} />
        <button type="button" onClick={() => void list.refetch()}>
          {t("settings.retry")}
        </button>
      </section>
    );
  if (!list.data?.length) return null;
  return (
    <section className="downloads-list" aria-label={t("downloads.title")}>
      <h3>{t("downloads.title")}</h3>
      <p className="muted">{t("downloads.localOnly")}</p>
      <ul>
        {list.data.map((download) => (
          <li key={download.downloadId}>
            <DownloadItem download={download} />
          </li>
        ))}
      </ul>
    </section>
  );
}
