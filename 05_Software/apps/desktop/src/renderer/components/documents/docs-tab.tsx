// REQ-UX-28ad0003
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { veraError, type WorkbenchEvent } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { useDocumentViewer } from "./viewer-context.js";

function defineTranslationKeys<const T extends readonly string[]>(keys: T): T {
  return keys;
}
const statusKeys = defineTranslationKeys([
  "documents.status.pending",
  "documents.status.indexed",
  "documents.status.failed",
  "documents.status.unsupported",
  "documents.status.needs_ocr",
]);
const statusIndex = { pending: 0, indexed: 1, failed: 2, unsupported: 3, needs_ocr: 4 } as const;
const reasonKeys = defineTranslationKeys([
  "documents.reason.SIZE_LIMIT",
  "documents.reason.TYPE_UNSUPPORTED",
  "documents.reason.BINARY",
  "documents.reason.IO",
  "documents.reason.PROCESSING",
  "documents.reason.NEEDS_OCR",
]);
const reasonIndex = {
  SIZE_LIMIT: 0,
  TYPE_UNSUPPORTED: 1,
  BINARY: 2,
  IO: 3,
  PROCESSING: 4,
  NEEDS_OCR: 5,
} as const;

export function DocsTab({ workbenchId, readOnly }: { workbenchId: string; readOnly: boolean }) {
  const { t } = useTranslation(),
    client = useQueryClient(),
    open = useDocumentViewer();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [progress, setProgress] = useState<Extract<WorkbenchEvent, { type: "index.progress" }>>();
  const [pending, setPending] = useState(false),
    [failure, setFailure] = useState<unknown>();
  const list = useQuery({
    queryKey: ["docs.list", workbenchId],
    queryFn: async () => {
      const result = await api.invoke("docs.list", { workbenchId });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result.documents;
    },
  });
  const results = useQuery({
    queryKey: ["docs.search", workbenchId, search],
    enabled: !!search,
    queryFn: async () => {
      const result = await api.invoke("docs.search", { workbenchId, query: search });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result.results;
    },
  });
  useEffect(() => {
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ["docs.list", workbenchId] });
      void client.invalidateQueries({ queryKey: ["docs.search", workbenchId] });
    };
    const off = api.subscribe("workbench", workbenchId, (event) => {
      if (event.type === "index.progress") setProgress(event);
      if (event.type === "index.document") refresh();
    });
    refresh();
    return off;
  }, [workbenchId, client]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  async function reindex() {
    setPending(true);
    setFailure(undefined);
    try {
      await api.invoke("docs.reindex", { workbenchId });
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
      void list.refetch();
      if (search) void results.refetch();
    }
  }
  return (
    <section className="docs-tab" aria-label={t("panel.docs")}>
      <label>
        {t("documents.search")}
        <input maxLength={1000} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <button type="button" disabled={readOnly || pending} onClick={() => void reindex()}>
        {t("documents.reindex")}
      </button>
      {progress && <p role="status">{t("documents.progress", progress)}</p>}
      {readOnly && <p className="muted">{t("documents.readOnly")}</p>}
      {failure !== undefined && <ErrorMessage error={failure} />}
      {list.isError || (!!search && results.isError) ? (
        <>
          <ErrorMessage error={list.error ?? results.error} />
          <button
            type="button"
            onClick={() => {
              void list.refetch();
              if (search) void results.refetch();
            }}
          >
            {t("settings.retry")}
          </button>
        </>
      ) : list.isPending || (!!search && results.isPending) ? (
        <p role="status">{t("home.loading")}</p>
      ) : search ? (
        <>
          {!results.data?.length && <p>{t("documents.noResults")}</p>}
          <ol className="documents-list">
            {results.data?.map((hit) => (
              <li key={hit.ref}>
                <p>{hit.ref}</p>
                <p>{hit.snippet}</p>
                <button
                  type="button"
                  aria-label={t("documents.openNamed", { path: hit.ref })}
                  onClick={() => open?.({ ref: hit.ref })}
                >
                  {t("documents.open")}
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          {!list.data.length && <p>{t("documents.empty")}</p>}
          <ol className="documents-list">
            {list.data.map((doc) => (
              <li key={doc.id} data-document={doc.path}>
                <p>{doc.path}</p>
                <p>
                  {t(statusKeys[statusIndex[doc.status]])}
                  {doc.error && ` · ${t(reasonKeys[reasonIndex[doc.error]])}`}
                </p>
                <button
                  type="button"
                  aria-label={t("documents.openNamed", { path: doc.path })}
                  disabled={doc.status !== "indexed" && doc.status !== "needs_ocr"}
                  onClick={() => open?.({ path: doc.path })}
                >
                  {t("documents.open")}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
