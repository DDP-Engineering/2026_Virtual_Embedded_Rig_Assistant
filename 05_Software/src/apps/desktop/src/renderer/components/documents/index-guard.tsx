// REQ-UX-0c1aea14 REQ-UX-597b7c82
import type { DocumentGuard } from "@vera/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

/**
 * Indexing stopped before it started: the selection holds more documents than the workbench file
 * limit (TASK-4321c06b). Shows the count, the folders holding most of them, "Index anyway", which
 * approves the shown count, and "Edit exclusions", which opens Edit workbench > Documents & RAG.
 */
export function IndexGuard({
  workbenchId,
  guard,
  readOnly,
  editExclusions,
}: {
  workbenchId: string;
  guard: DocumentGuard;
  readOnly: boolean;
  editExclusions?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState(false),
    [failure, setFailure] = useState<unknown>();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? "en");
  async function approve() {
    setPending(true);
    setFailure(undefined);
    try {
      await api.invoke("docs.approve", { workbenchId, files: guard.files });
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="index-guard" role="alert" data-index-guard>
      <p>{t("documents.guard", { files: number.format(guard.files), limit: number.format(guard.limit) })}</p>
      {guard.folders.length > 0 && (
        <ul aria-label={t("documents.guardFolders")}>
          {guard.folders.map((folder) => (
            <li key={folder.path} data-guard-folder={folder.path}>
              {t("documents.guardFolder", { path: folder.path, files: number.format(folder.files) })}
            </li>
          ))}
        </ul>
      )}
      <div className="docs-actions">
        <button
          type="button"
          className="primary"
          data-action="index-anyway"
          disabled={readOnly || pending}
          onClick={() => void approve()}
        >
          {t("documents.indexAnyway")}
        </button>
        {editExclusions && (
          <button type="button" data-action="edit-exclusions" onClick={editExclusions}>
            {t("documents.editExclusions")}
          </button>
        )}
      </div>
      {failure !== undefined && <ErrorMessage error={failure} />}
    </div>
  );
}
