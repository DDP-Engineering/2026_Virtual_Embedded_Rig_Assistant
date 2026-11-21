import type { GitStatusEntry, GitStatusOwner, GitStatusUpdate } from "@vera/shared";
import type { TFunction } from "i18next";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";

const sameView = (one: GitStatusOwner, two: GitStatusOwner) =>
  one.indexLease === two.indexLease && one.workbenchId === two.workbenchId && one.viewId === two.viewId;

/** Subscribes only while the opted-in Files view is mounted. */
export function useGitStatus(workbenchId: string, indexLease: number, enabled: boolean) {
  const [update, setUpdate] = useState<GitStatusUpdate>();
  const [busy, setBusy] = useState(false);
  const [filtered, setFiltered] = useState(false);
  const active = useRef<GitStatusOwner>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const owner = { workbenchId, indexLease, viewId: crypto.randomUUID() };
    active.current = owner;
    setBusy(true);
    const accept = (value: GitStatusUpdate) => {
      if (active.current !== owner) return;
      setUpdate(value);
      setBusy(false);
    };
    const unavailable = () => accept({ ...owner, status: { state: "failed" }, watchLimited: false });
    const off = api.subscribe("workbench", workbenchId, (event) => {
      if (event.type === "git.status" && sameView(owner, event.update)) accept(event.update);
      if (event.type === "config.changed" && event.config.interface.git_status) {
        setUpdate(undefined);
        setBusy(true);
        void api.invoke("git.status", { ...owner, action: "refresh" }).catch(unavailable);
      }
    });
    const offApp = api.subscribe("app", (event) => {
      if (event.type !== "settings.changed" || event.masking === false) return;
      setUpdate(undefined);
      setBusy(true);
      void api.invoke("git.status", { ...owner, action: "refresh" }).catch(unavailable);
    });
    void api.invoke("git.status", { ...owner, action: "open" }).catch(unavailable);
    return () => {
      active.current = undefined;
      off();
      offApp();
      void api.invoke("git.status", { ...owner, action: "close" }).catch(() => {});
    };
  }, [workbenchId, indexLease, enabled]);

  const current =
    enabled && update && active.current && sameView(update, active.current) ? update : undefined;
  return {
    current,
    busy,
    filtered,
    setFiltered,
    refresh: () => {
      const owner = active.current;
      if (!owner) return;
      setBusy(true);
      void api.invoke("git.status", { ...owner, action: "refresh" }).catch(() => {
        if (active.current !== owner) return;
        setUpdate({ ...owner, status: { state: "failed" }, watchLimited: false });
        setBusy(false);
      });
    },
  };
}

export function GitStatusControls({
  current,
  busy,
  filtered,
  setFiltered,
  refresh,
}: ReturnType<typeof useGitStatus>) {
  const { t } = useTranslation();
  const status = current?.status;
  const unavailable = {
    "no-repository": t("gitStatus.availability.no-repository"),
    "missing-git": t("gitStatus.availability.missing-git"),
    unsupported: t("gitStatus.availability.unsupported"),
    failed: t("gitStatus.availability.failed"),
    loading: t("gitStatus.availability.loading"),
  };
  return (
    <div className="git-status">
      <div className="git-toolbar">
        <button
          type="button"
          className="git-filter"
          aria-pressed={status?.state === "ready" && filtered}
          disabled={status?.state !== "ready"}
          onClick={() => setFiltered(!filtered)}
        >
          {t("gitStatus.changesOnly")}
        </button>
        <button
          type="button"
          aria-label={t("gitStatus.refresh")}
          title={t("gitStatus.refresh")}
          aria-busy={busy}
          onClick={refresh}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>
      <div className="git-info" role="status">
        {status?.state === "ready" ? (
          <>
            <bdi className="git-branch">
              {status.branch.kind === "detached"
                ? t("gitStatus.branch.detached", { name: status.branch.name })
                : status.branch.kind === "unborn"
                  ? t("gitStatus.branch.unborn", { name: status.branch.name })
                  : t("gitStatus.branch.named", { name: status.branch.name })}
            </bdi>
            <span>{t("gitStatus.changed", { count: status.changed })}</span>
            <span>{t("gitStatus.conflicts", { count: status.conflicts })}</span>
          </>
        ) : (
          <span>{unavailable[status?.state ?? "loading"]}</span>
        )}
        {current?.watchLimited && status?.state === "ready" && <span>{t("gitStatus.watchLimited")}</span>}
      </div>
    </div>
  );
}

function changeLabel(t: TFunction, code: NonNullable<GitStatusEntry["staged"]>) {
  switch (code) {
    case "M":
      return t("gitStatus.change.M");
    case "?":
      return t("gitStatus.change.?");
    case "A":
      return t("gitStatus.change.A");
    case "R":
      return t("gitStatus.change.R");
    case "D":
      return t("gitStatus.change.D");
  }
}

export function GitBadges({
  entry,
  count,
}: {
  entry: GitStatusEntry | undefined;
  count: number | undefined;
}) {
  const { t } = useTranslation();
  const comparisons = [
    ["staged", entry?.staged],
    ["unstaged", entry?.unstaged],
  ] as const;
  return (
    <>
      {count !== undefined && (
        <span
          className="tree-count git-badge"
          data-git-count={count}
          title={t("gitStatus.folder", { count })}
        >
          <span aria-hidden="true">±{count}</span>
          <span className="sr-only">{t("gitStatus.folder", { count })}</span>
        </span>
      )}
      {entry?.conflict && (
        <span className="git-badge" data-git-badge="conflict" title={t("gitStatus.conflict")}>
          <span aria-hidden="true">!</span>
          <span className="sr-only">{t("gitStatus.conflict")}</span>
        </span>
      )}
      {comparisons.map(([layer, code]) => {
        if (!code) return null;
        const status = changeLabel(t, code);
        const label =
          layer === "staged"
            ? t("gitStatus.comparison.staged", { status })
            : t("gitStatus.comparison.unstaged", { status });
        const short = layer === "staged" ? t("gitStatus.short.staged") : t("gitStatus.short.unstaged");
        return (
          <span key={layer} className="git-badge" data-git-badge={layer} title={label}>
            <span aria-hidden="true">
              {short} {code}
            </span>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
      {entry?.virtual && <span className="sr-only">{t("gitStatus.absent")}</span>}
    </>
  );
}
