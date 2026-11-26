import { TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../error-message.js";
import { Pager, usePaged } from "../pager.js";
import { useIndexedDocuments, useReindexDocuments } from "./document-index-queries.js";
import { useDescribeDocument } from "./file-actions.js";
import { IndexStatusSummary, useDocumentIndexStatus } from "./index-status.js";

/** Shows measured indexing status and exceptional records on the visible overview page. */
export function WorkbenchIndexDetails({
  workbenchId,
  indexLease,
  readOnly,
}: {
  workbenchId: string;
  indexLease: number;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const status = useDocumentIndexStatus(workbenchId, indexLease);
  const list = useIndexedDocuments(workbenchId);
  const reindex = useReindexDocuments(workbenchId, true);
  const describe = useDescribeDocument();
  const exceptional = useMemo(
    () =>
      list.data?.filter(
        ({ status }) => status === "failed" || status === "needs_ocr" || status === "unsupported",
      ) ?? [],
    [list.data],
  );
  const { rows, pager } = usePaged(exceptional);
  const missingDetails = (status?.progress?.exceptions ?? 0) > exceptional.length;
  const canReindex = !readOnly && !reindex.pending && !!status && status.state !== "stopped";

  return (
    <div className="overview-index-details">
      <IndexStatusSummary status={status} />
      {list.isError && (
        <>
          <ErrorMessage error={list.error} />
          <button type="button" onClick={() => void list.refetch()}>
            {t("settings.retry")}
          </button>
        </>
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
          {missingDetails && !list.isPending && <p>{t("documents.indexFailureDetailsUnavailable")}</p>}
          <div className="overview-index-actions">
            <button type="button" disabled={!canReindex} onClick={() => reindex.mutate()}>
              {t("settings.retry")}
            </button>
          </div>
          {reindex.isError && <ErrorMessage error={reindex.error} />}
        </details>
      )}
    </div>
  );
}
