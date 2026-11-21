// REQ-UX-28ad0003 REQ-UX-2504362b REQ-UX-d455531b REQ-UX-0c1aea14 REQ-UX-597b7c82
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { veraError } from "@vera/shared";
import { ListCollapse } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { DocsTree, useTreeExpansion } from "./docs-tree.js";
import { DownloadsList } from "./downloads.js";
import { useDescribeDocument } from "./file-actions.js";
import { FilesIndexControls } from "./files-index-controls.js";
import { GitStatusControls, useGitStatus } from "./git-status.js";
import { useDocumentViewer } from "./viewer-context.js";

export function DocsTab({
  workbenchId,
  indexLease,
  gitEnabled = false,
  readOnly,
  editExclusions,
}: {
  workbenchId: string;
  indexLease: number;
  gitEnabled?: boolean;
  readOnly: boolean;
  /** Opens Edit workbench > Documents & RAG, from the count guard's "Edit exclusions". */
  editExclusions?: () => void;
}) {
  const describe = useDescribeDocument();
  const { t } = useTranslation(),
    client = useQueryClient(),
    open = useDocumentViewer();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const expansion = useTreeExpansion(workbenchId);
  const hitsTitle = useId();
  const git = useGitStatus(workbenchId, indexLease, gitEnabled);
  const gitSnapshot = git.current?.status;
  useEffect(() => {
    if (gitSnapshot?.state !== "ready") return;
    void client.invalidateQueries({ queryKey: ["docs.tree", workbenchId] });
    void client.invalidateQueries({ queryKey: ["docs.find", workbenchId] });
  }, [client, workbenchId, gitSnapshot]);
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
      return result;
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
    // Indexing reports every document; one refresh after a burst replaces a reload per event.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshSoon = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        refresh();
      }, 300);
    };
    const resetDisplay = (owner?: string) => {
      for (const channel of ["docs.list", "docs.search", "docs.tree", "docs.find", "docs.stat"])
        void client.resetQueries({ queryKey: owner === undefined ? [channel] : [channel, owner] });
    };
    const off = api.subscribe("workbench", workbenchId, (event) => {
      if (event.type === "index.document") refreshSoon();
      if (event.type === "config.changed") resetDisplay(workbenchId);
    });
    const offApp = api.subscribe("app", (event) => {
      if (event.type === "settings.changed") resetDisplay();
    });
    refresh();
    return () => {
      clearTimeout(timer);
      off();
      offApp();
    };
  }, [workbenchId, client]);
  useEffect(() => {
    // One debounce feeds the tree's name filter and the document search (TASK-b34f2cc7).
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  return (
    <section className="docs-tab" aria-label={t("panel.docs")}>
      <DownloadsList workbenchId={workbenchId} />
      <FilesIndexControls
        workbenchId={workbenchId}
        indexLease={indexLease}
        readOnly={readOnly}
        editExclusions={editExclusions}
        documents={list.data}
        refreshed={() => {
          void list.refetch();
          if (search) void results.refetch();
        }}
        search={
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
        }
        collapse={
          <button
            type="button"
            data-action="collapse-all"
            aria-label={t("documents.collapseAll")}
            title={t("documents.collapseAll")}
            // A search shows its matches expanded; collapsing applies to the browsing tree only.
            disabled={!expansion.expanded.size || !!query.trim()}
            onClick={() => expansion.save(new Set())}
          >
            <ListCollapse aria-hidden="true" />
          </button>
        }
      />
      {gitEnabled && <GitStatusControls {...git} />}
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
            describe={describe}
            query={search}
            expansion={expansion}
            gitEntries={gitSnapshot?.state === "ready" ? gitSnapshot.entries : undefined}
            gitChangesOnly={gitSnapshot?.state === "ready" && git.filtered}
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
              ) : !results.data.results.length ? (
                <p role="status">
                  {results.data.usage.mode === null && results.data.usage.reason === "revision-conflict"
                    ? t("documents.searchChanging")
                    : results.data.usage.mode === null && results.data.usage.reason === "index-not-ready"
                      ? t("documents.searchUnavailable")
                      : results.data.coverage === "complete"
                        ? t("documents.noResults")
                        : t("documents.noPublishedResults")}
                </p>
              ) : (
                <ol className="documents-list">
                  {results.data.results.map((hit) => (
                    <li key={hit.ref}>
                      <p>{hit.displayRef ?? hit.ref}</p>
                      <p>{hit.snippet}</p>
                      <button
                        type="button"
                        aria-label={t("documents.openNamed", { path: hit.displayRef ?? hit.ref })}
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
