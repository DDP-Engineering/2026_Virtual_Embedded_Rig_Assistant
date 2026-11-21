import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentIndexStatus as Status } from "@vera/shared";
import {
  CircleCheck,
  CircleMinus,
  CirclePause,
  Database,
  LockKeyhole,
  ScanSearch,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";

export function useDocumentIndexStatus(workbenchId: string, indexLease: number) {
  const client = useQueryClient();
  const { data } = useQuery<Status>({
    queryKey: ["docs.status", workbenchId, indexLease],
    queryFn: skipToken,
  });

  useEffect(() => {
    const key = ["docs.status", workbenchId, indexLease];
    let active = true;
    const accept = (incoming: Status) => {
      if (!active || incoming.workbenchId !== workbenchId || incoming.indexLease !== indexLease) return;
      const previous = client.getQueryData<Status>(key);
      if (!previous || previous.revision < incoming.revision) client.setQueryData(key, incoming);
    };
    const load = () => {
      void api.invoke("docs.status", { workbenchId, indexLease }).then(accept, () => {});
    };
    const off = api.subscribe("workbench", workbenchId, (event) => {
      if (event.type === "index.status") accept(event.status);
      if (event.type === "config.changed") load();
    });
    const offApp = api.subscribe("app", (event) => {
      if (event.type === "settings.changed" && event.masking !== false) load();
    });
    load();
    return () => {
      active = false;
      off();
      offApp();
    };
  }, [client, workbenchId, indexLease]);

  return data;
}

function useIndexSummary(state: Status["state"] | undefined) {
  const { t } = useTranslation();
  switch (state) {
    case "scanning":
      return [t("documents.indexStateScanning"), ScanSearch] as const;
    case "indexing":
      return [t("documents.indexStateIndexing"), Database] as const;
    case "rebuilding":
      return [t("documents.indexStateRebuilding"), Database] as const;
    case "ready":
      return [t("documents.indexStateReady"), CircleCheck] as const;
    case "exceptions":
      return [t("documents.indexStateExceptions"), TriangleAlert] as const;
    case "count-guard":
      return [t("documents.indexStateCountGuard"), TriangleAlert] as const;
    case "blocked":
      return [t("documents.indexStateBlocked"), TriangleAlert] as const;
    case "stopped":
      return [t("documents.indexStateStopped"), CirclePause] as const;
    case "empty":
      return [t("documents.indexStateEmpty"), CircleMinus] as const;
    case "read-only":
      return [t("documents.indexStateReadOnly"), LockKeyhole] as const;
    default:
      return [t("documents.indexStateUnavailable"), ScanSearch] as const;
  }
}

export function WorkbenchIndexStatus({
  workbenchId,
  indexLease,
  open,
}: {
  workbenchId: string;
  indexLease: number;
  open: () => void;
}) {
  const { t } = useTranslation();
  const status = useDocumentIndexStatus(workbenchId, indexLease);
  const [summary, Icon] = useIndexSummary(status?.state);
  const countsId = useId();
  const counts: string[] = [];
  if (status?.progress) counts.push(t("documents.indexProcessed", status.progress));
  if (status && status.searchable !== null)
    counts.push(t("documents.indexSearchable", { count: status.searchable }));
  const label = t("documents.openIndexDetails", { status: summary });
  return (
    <button
      type="button"
      className="workbench-index-status"
      data-index-state={status?.state}
      aria-label={label}
      aria-describedby={counts.length ? countsId : undefined}
      onClick={open}
    >
      <Icon aria-hidden="true" />
      <span className="workbench-index-tooltip">
        <span aria-hidden="true">{label}</span>
        {counts.length > 0 && <span id={countsId}> {counts.join(". ")}</span>}
      </span>
    </button>
  );
}

export function IndexStatusSummary({ status }: { status: Status | undefined }) {
  const { t } = useTranslation();
  const [summary] = useIndexSummary(status?.state);
  return (
    <div className="docs-index-status" data-index-state={status?.state}>
      <p>{summary}</p>
      {status?.progress && <p>{t("documents.indexProcessed", status.progress)}</p>}
      {status && status.searchable !== null && (
        <p>{t("documents.indexSearchable", { count: status.searchable })}</p>
      )}
    </div>
  );
}
