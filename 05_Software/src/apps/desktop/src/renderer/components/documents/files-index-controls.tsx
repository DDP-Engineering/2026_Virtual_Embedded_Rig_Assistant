import type { DocumentRecord } from "@vera/shared";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { Pager, usePaged } from "../pager.js";
import { useDescribeDocument } from "./file-actions.js";
import { IndexGuard } from "./index-guard.js";
import { IndexStatusSummary, useDocumentIndexStatus } from "./index-status.js";

export function FilesIndexControls({
  workbenchId,
  indexLease,
  readOnly,
  editExclusions,
  refreshed,
  search,
  collapse,
  documents,
}: {
  workbenchId: string;
  indexLease: number;
  readOnly: boolean;
  editExclusions: (() => void) | undefined;
  refreshed: () => void;
  search: ReactNode;
  collapse: ReactNode;
  documents: readonly DocumentRecord[] | undefined;
}) {
  const { t } = useTranslation();
  const status = useDocumentIndexStatus(workbenchId, indexLease);
  const describe = useDescribeDocument();
  const [pending, setPending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const indexing =
    status?.state === "indexing" || status?.state === "rebuilding" || status?.state === "scanning";
  const canReindex = !readOnly && !pending && !!status && status.state !== "stopped";
  const exceptional = useMemo(
    () =>
      documents?.filter(
        ({ status }) => status === "failed" || status === "needs_ocr" || status === "unsupported",
      ) ?? [],
    [documents],
  );
  const { rows, pager } = usePaged(exceptional);
  const missingDetails = (status?.progress?.exceptions ?? 0) > exceptional.length;

  async function reindex() {
    setPending(true);
    setFailure(undefined);
    try {
      await api.invoke("docs.reindex", { workbenchId });
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
      refreshed();
    }
  }
  async function restartIndexer() {
    setRestarting(true);
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
          title={t("documents.reindex")}
          aria-busy={indexing}
          disabled={!canReindex}
          onClick={() => void reindex()}
        >
          <RefreshCw aria-hidden="true" className={indexing ? "docs-indexing" : undefined} />
        </button>
        {collapse}
      </div>
      <IndexStatusSummary status={status} />
      {status?.guard && (status.state === "count-guard" || status.state === "stopped") && (
        <IndexGuard
          workbenchId={workbenchId}
          guard={status.guard}
          readOnly={readOnly || status.state === "stopped"}
          editExclusions={editExclusions}
        />
      )}
      {(exceptional.length > 0 || missingDetails) && (
        <details className="docs-index-failures">
          <summary>
            <TriangleAlert aria-hidden="true" />
            {t("documents.indexExceptionDetails")}
          </summary>
          {rows.length > 0 && (
            <>
              <ul>
                {rows.map((doc) => (
                  <li key={doc.id}>
                    <strong>{doc.displayPath ?? doc.path}</strong> — {describe(doc)}
                  </li>
                ))}
              </ul>
              <Pager {...pager} />
            </>
          )}
          {missingDetails && <p>{t("documents.indexFailureDetailsUnavailable")}</p>}
          <button type="button" disabled={!canReindex} onClick={() => void reindex()}>
            {t("documents.reindex")}
          </button>
        </details>
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
      {failure !== undefined && <ErrorMessage error={failure} />}
    </>
  );
}
