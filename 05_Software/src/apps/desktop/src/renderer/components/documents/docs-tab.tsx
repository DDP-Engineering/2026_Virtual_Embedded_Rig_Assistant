// REQ-UX-28ad0003 REQ-UX-2504362b REQ-UX-d455531b
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { veraError, type WorkbenchEvent } from "@vera/shared";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { DocsTree, useTreeExpansion } from "./docs-tree.js";
import { DownloadsList } from "./downloads.js";
import { useDocumentViewer } from "./viewer-context.js";
import { VolumeWarning } from "./volume-warning.js";

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
  const expansion = useTreeExpansion(workbenchId);
  const hitsTitle = useId();
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
  const volume = useQuery({
    queryKey: ["docs.volume", workbenchId],
    // Events reach only a mounted Docs tab, so a remount reads the current volume again.
    refetchOnMount: "always",
    queryFn: async () => {
      const result = await api.invoke("docs.volume", { workbenchId });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result.volume;
    },
  });
  const indexer = useQuery({
    queryKey: ["indexer.status"],
    refetchOnMount: "always",
    queryFn: async () => (await api.invoke("indexer.status", {})).state,
  });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type === "indexer.status") client.setQueryData(["indexer.status"], event.state);
      }),
    [client],
  );
  const [restarting, setRestarting] = useState(false);
  async function restartIndexer() {
    setRestarting(true);
    try {
      await api.invoke("indexer.restart", {});
    } catch (error) {
      setFailure(error);
    } finally {
      setRestarting(false);
    }
  }
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
      // Folder entries follow the disk; an index change is a good moment to read them again.
      void client.invalidateQueries({ queryKey: ["docs.tree", workbenchId] });
      void client.invalidateQueries({ queryKey: ["docs.find", workbenchId] });
    };
    const off = api.subscribe("workbench", workbenchId, (event) => {
      if (event.type === "index.progress") setProgress(event);
      if (event.type === "index.volume")
        client.setQueryData(["docs.volume", workbenchId], { files: event.files, bytes: event.bytes });
      if (event.type === "index.document") refresh();
    });
    refresh();
    return off;
  }, [workbenchId, client]);
  useEffect(() => {
    // One debounce feeds the tree's name filter and the document search (TASK-b34f2cc7).
    const timer = setTimeout(() => setSearch(query.trim()), 250);
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
      <DownloadsList workbenchId={workbenchId} />
      <input
        type="search"
        data-docs-search
        aria-label={t("documents.search")}
        placeholder={t("documents.search")}
        // The name filter accepts 200 characters; document search would take more.
        maxLength={200}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="docs-actions">
        <button
          type="button"
          data-action="reindex"
          // A reindex needs a running indexer to select documents, so it waits for a restart.
          disabled={readOnly || pending || indexer.data === "stopped"}
          onClick={() => void reindex()}
        >
          {t("documents.reindex")}
        </button>
        <button
          type="button"
          data-action="collapse-all"
          // A search shows its matches expanded; collapsing applies to the browsing tree only.
          disabled={!expansion.expanded.size || !!query.trim()}
          onClick={() => expansion.save(new Set())}
        >
          {t("documents.collapseAll")}
        </button>
      </div>
      {progress && <p role="status">{t("documents.progress", progress)}</p>}
      <VolumeWarning volume={volume.data} />
      {indexer.data === "stopped" && (
        <div className="indexer-stopped" role="alert" data-indexer-stopped>
          <p>{t("documents.indexerStopped")}</p>
          <button
            type="button"
            data-action="restart-indexer"
            disabled={restarting}
            onClick={() => void restartIndexer()}
          >
            {t("documents.indexerRestart")}
          </button>
        </div>
      )}
      {readOnly && <p className="muted">{t("documents.readOnly")}</p>}
      {failure !== undefined && <ErrorMessage error={failure} />}
      {list.isError ? (
        <>
          <ErrorMessage error={list.error} />
          <button type="button" onClick={() => void list.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      ) : list.isPending ? (
        <p role="status">{t("home.loading")}</p>
      ) : (
        <>
          {!list.data.length && !search && <p>{t("documents.empty")}</p>}
          <DocsTree
            workbenchId={workbenchId}
            documents={list.data}
            describe={(doc) =>
              `${t(statusKeys[statusIndex[doc.status]])}${doc.error ? ` · ${t(reasonKeys[reasonIndex[doc.error]])}` : ""}`
            }
            query={search}
            expansion={expansion}
          />
          {search && (
            <section className="docs-hits" data-docs-hits aria-labelledby={hitsTitle}>
              <h3 id={hitsTitle}>{t("documents.inDocuments")}</h3>
              {results.isError ? (
                <>
                  <ErrorMessage error={results.error} />
                  <button type="button" onClick={() => void results.refetch()}>
                    {t("settings.retry")}
                  </button>
                </>
              ) : results.isPending ? (
                <p role="status">{t("home.loading")}</p>
              ) : !results.data.length ? (
                <p role="status">{t("documents.noResults")}</p>
              ) : (
                <ol className="documents-list">
                  {results.data.map((hit) => (
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
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
