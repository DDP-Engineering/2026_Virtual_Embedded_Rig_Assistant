// REQ-UX-4d1b3324
import { useQuery } from "@tanstack/react-query";
import { type DocumentRecord, veraError } from "@vera/shared";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useBytes } from "../../lib/bytes.js";
import { ErrorMessage } from "../error-message.js";

/**
 * Properties of a Docs tree entry in a modal dialog (TASK-66b7d4aa): path, type, size and modified
 * time read from the workbench, and what the index knows - a document's status, reason and pages,
 * or the number of indexed documents beneath a folder. Focus returns to the row on close.
 */
export function TreeProperties({
  workbenchId,
  path,
  name,
  type,
  ignored,
  doc,
  count,
  describe,
  close,
}: {
  workbenchId: string;
  path: string;
  name: string;
  type: "folder" | "file";
  /** Hidden from the agent and the index by VERA's ignore rules. */
  ignored: boolean;
  doc: DocumentRecord | undefined;
  /** Indexed documents beneath a folder. */
  count: number;
  describe: (doc: DocumentRecord) => string;
  close: () => void;
}) {
  const { t, i18n } = useTranslation();
  const bytes = useBytes();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const stat = useQuery({
    queryKey: ["docs.stat", workbenchId, path],
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const result = await api.invoke("docs.stat", { workbenchId, path });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result.properties;
    },
  });
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  const properties = stat.data;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog tree-properties"
      aria-labelledby={title}
      data-tree-properties
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h3 id={title}>{t("documents.propertiesTitle", { name })}</h3>
      <dl>
        <dt>{t("documents.propertyPath")}</dt>
        <dd data-prop="path">{path}</dd>
        <dt>{t("documents.propertyType")}</dt>
        <dd data-prop="type">{type === "folder" ? t("documents.typeFolder") : t("documents.typeFile")}</dd>
        {properties?.size != null && (
          <>
            <dt>{t("documents.propertySize")}</dt>
            <dd data-prop="size">{bytes(properties.size)}</dd>
          </>
        )}
        {properties && (
          <>
            <dt>{t("documents.propertyModified")}</dt>
            <dd data-prop="modified">{date.format(new Date(properties.modified))}</dd>
          </>
        )}
        {ignored ? (
          <>
            <dt>{t("documents.propertyIndex")}</dt>
            <dd data-prop="status">{t("documents.ignored")}</dd>
          </>
        ) : type === "file" ? (
          <>
            <dt>{t("documents.propertyIndex")}</dt>
            <dd data-prop="status">{doc ? describe(doc) : t("documents.notIndexed")}</dd>
          </>
        ) : (
          <>
            <dt>{t("documents.propertyIndexed")}</dt>
            <dd data-prop="count">{count}</dd>
          </>
        )}
        {doc?.pages != null && (
          <>
            <dt>{t("documents.propertyPages")}</dt>
            <dd data-prop="pages">{doc.pages}</dd>
          </>
        )}
      </dl>
      {stat.isError && <ErrorMessage error={stat.error} />}
      <div className="workbench-actions">
        <button type="button" data-action="close-properties" onClick={close}>
          {t("panel.close")}
        </button>
      </div>
    </dialog>
  );
}
