// REQ-UX-33b9d601 REQ-UX-bb147586
import {
  type QueryClient,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type PermissionMode, permissionModeSchema, type SettingsSnapshot } from "@vera/shared";
import { TriangleAlert } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

interface IrreversibleRule {
  plugin: string;
  match: string;
  note?: string | undefined;
}
/** Irreversible rules of the workbench's enabled, issue-free plugins that are not trials. */
async function irreversibleRules(client: QueryClient, workbenchId: string): Promise<IrreversibleRule[]> {
  const plugins = await client.fetchQuery({
    queryKey: ["plugins.list", workbenchId],
    queryFn: () => api.invoke("plugins.list", { workbenchId }),
    staleTime: 0,
  });
  return plugins
    .filter((plugin) => plugin.enabled && !plugin.issues.length && plugin.tier !== "trial")
    .flatMap((plugin) =>
      (plugin.irreversible ?? []).map((rule) => ({ plugin: plugin.name ?? plugin.id, ...rule })),
    );
}

export function PermissionPicker({
  mode,
  disabled,
  change,
  label,
  workbenchId,
}: {
  mode: PermissionMode;
  disabled: boolean;
  change: (mode: PermissionMode) => void | Promise<void>;
  label?: string;
  /** The session's workbench: switching to bypass lists its plugins' irreversible rules. */
  workbenchId?: string | undefined;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [warning, setWarning] = useState(false);
  const [irreversible, setIrreversible] = useState<IrreversibleRule[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const picker = useRef<HTMLSelectElement>(null);
  const alive = useRef(false);
  const preferences = useQuery({ queryKey: ["app.settings"], queryFn: () => api.getSettings() });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function choose(next: PermissionMode) {
    if (disabled || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await change(next);
      if (next !== "bypass") return;
      // An unreadable plugin list shows the warning even when it is suppressed.
      const rules = workbenchId ? await irreversibleRules(client, workbenchId).catch(() => null) : [];
      if (!alive.current) return;
      setIrreversible(rules ?? []);
      if (rules === null || rules.length > 0 || preferences.data?.settings.suppressBypassWarning !== true)
        setWarning(true);
    } catch (failure) {
      if (alive.current) setError(failure);
    } finally {
      if (alive.current) setPending(false);
    }
  }
  return (
    <>
      <label className="permission-field">
        <span className={label ? undefined : "sr-only"}>{label ?? t("approval.mode")}</span>
        <select
          ref={picker}
          data-permission-picker
          aria-label={label ?? t("approval.mode")}
          className={mode === "bypass" ? "bypass-selected" : undefined}
          value={mode}
          disabled={disabled || pending}
          onChange={(event) => void choose(permissionModeSchema.parse(event.target.value))}
        >
          <option value="read-only">{t("approval.readOnly")}</option>
          <option value="ask">{t("approval.ask")}</option>
          <option value="auto-edit">{t("approval.autoEdit")}</option>
          <option value="bypass">⚠ {t("bypass.option")}</option>
        </select>
      </label>
      {error !== undefined && <ErrorMessage error={error} />}
      {warning &&
        createPortal(
          <BypassWarning
            opener={picker}
            preferences={preferences}
            irreversible={irreversible}
            close={() => {
              setWarning(false);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function BypassWarning({
  opener,
  preferences,
  irreversible,
  close,
}: {
  opener: RefObject<HTMLSelectElement | null>;
  preferences: UseQueryResult<SettingsSnapshot, Error>;
  irreversible: IrreversibleRule[];
  close: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const title = useId(),
    description = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [remember, setRemember] = useState(false);
  const save = useMutation({
    mutationFn: () => api.updateSettings({ suppressBypassWarning: true }),
    onSuccess: (snapshot) => client.setQueryData(["app.settings"], snapshot),
  });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>('[data-action="close-bypass-warning"]')?.focus();
    return () => {
      node?.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [opener]);
  async function dismiss() {
    if (save.isPending) return;
    if (remember) {
      try {
        await save.mutateAsync();
      } catch {
        return;
      }
    }
    close();
  }
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog bypass-warning"
      aria-labelledby={title}
      aria-describedby={description}
      aria-busy={save.isPending}
      onCancel={(event) => {
        event.preventDefault();
        void dismiss();
      }}
    >
      <header>
        <h2 id={title}>
          <TriangleAlert aria-hidden="true" />
          {t("bypass.title")}
        </h2>
      </header>
      <p id={description}>{t("bypass.warning")}</p>
      {irreversible.length > 0 && (
        <section className="bypass-irreversible" data-bypass-irreversible>
          <p>{t("bypass.irreversible")}</p>
          <ul>
            {irreversible.map((rule, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Rules are a fixed list for the dialog's lifetime and may repeat.
              <li key={index}>
                <strong>{rule.plugin}</strong> <code>{rule.match}</code>
                {rule.note && <span> — {rule.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <label className="bypass-remember">
        <input
          type="checkbox"
          data-hide-bypass-warning
          checked={remember}
          disabled={!preferences.data || save.isPending}
          onChange={(event) => setRemember(event.target.checked)}
        />
        <span>{t("bypass.dontShowAgain")}</span>
      </label>
      {preferences.isError && (
        <>
          <ErrorMessage error={preferences.error} />
          <button type="button" onClick={() => void preferences.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {save.isError && <ErrorMessage error={save.error} />}
      <footer>
        <button
          type="button"
          data-action="close-bypass-warning"
          disabled={save.isPending}
          onClick={() => void dismiss()}
        >
          {t("panel.close")}
        </button>
      </footer>
    </dialog>
  );
}
