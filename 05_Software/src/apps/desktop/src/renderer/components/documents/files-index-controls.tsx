import { LoaderCircle, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { useReindexDocuments } from "./document-index-queries.js";
import { IndexGuard } from "./index-guard.js";
import { useDocumentIndexStatus, useIndexSummary } from "./index-status.js";

export function FilesIndexControls({
  workbenchId,
  indexLease,
  readOnly,
  editExclusions,
  search,
  collapse,
}: {
  workbenchId: string;
  indexLease: number;
  readOnly: boolean;
  editExclusions: (() => void) | undefined;
  search: ReactNode;
  collapse: ReactNode;
}) {
  const { t } = useTranslation();
  const status = useDocumentIndexStatus(workbenchId, indexLease);
  const reindex = useReindexDocuments(workbenchId);
  const [restarting, setRestarting] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const indexing =
    status?.state === "indexing" || status?.state === "rebuilding" || status?.state === "scanning";
  const [summary] = useIndexSummary(status?.state);
  const showStatus = indexing || status?.state === "blocked";
  const canReindex = !readOnly && !reindex.pending && !!status && status.state !== "stopped";
  async function restartIndexer() {
    setRestarting(true);
    reindex.reset();
    setFailure(undefined);
    try {
      await api.invoke("indexer.restart", {});
    } catch (error) {
      setFailure(error);
    } finally {
      setRestarting(false);
    }
  }

  return (
    <>
      <div className="docs-toolbar">
        {search}
        <button
          type="button"
          data-action="reindex"
          aria-label={t("documents.reindex")}
          title={showStatus ? summary : t("documents.reindex")}
          aria-description={showStatus ? summary : undefined}
          data-index-state={status?.state}
          aria-busy={indexing}
          disabled={!canReindex}
          onClick={() => {
            setFailure(undefined);
            reindex.mutate();
          }}
        >
          {indexing ? (
            <LoaderCircle aria-hidden="true" className="docs-indexing" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
        </button>
        {collapse}
      </div>
      {status?.guard && (status.state === "count-guard" || status.state === "stopped") && (
        <IndexGuard
          workbenchId={workbenchId}
          guard={status.guard}
          readOnly={readOnly || status.state === "stopped"}
          editExclusions={editExclusions}
        />
      )}
      {status?.state === "stopped" && (
        <div className="indexer-stopped" data-indexer-stopped>
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
      {(failure !== undefined || reindex.isError) && <ErrorMessage error={failure ?? reindex.error} />}
    </>
  );
}
