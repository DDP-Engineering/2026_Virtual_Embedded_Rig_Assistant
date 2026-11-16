// REQ-UX-33b9d601 REQ-UX-bb147586
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type PermissionMode, permissionModeSchema } from "@vera/shared";
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
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function choose(next: PermissionMode, confirmed = false) {
    if (disabled || busy.current || next === mode) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      if (next === "bypass" && !confirmed) {
        const rules = workbenchId ? await irreversibleRules(client, workbenchId).catch(() => []) : [];
        if (!alive.current) return;
        setIrreversible(rules);
        setWarning(true);
      } else {
        await change(next);
        if (alive.current) setWarning(false);
      }
    } catch (failure) {
      if (alive.current) setError(failure);
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  function cancel() {
    if (busy.current) return;
    setWarning(false);
    setError(undefined);
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
          disabled={disabled || pending || warning}
          onChange={(event) => void choose(permissionModeSchema.parse(event.target.value))}
        >
          <option value="read-only">{t("approval.readOnly")}</option>
          <option value="ask">{t("approval.ask")}</option>
          <option value="auto-edit">{t("approval.autoEdit")}</option>
          <option value="bypass">⚠ {t("bypass.option")}</option>
        </select>
      </label>
      {!warning && error !== undefined && <ErrorMessage error={error} />}
      {warning &&
        createPortal(
          <BypassWarning
            opener={picker}
            irreversible={irreversible}
            pending={pending}
            disabled={disabled}
            error={error}
            cancel={cancel}
            confirm={() => void choose("bypass", true)}
          />,
          document.body,
        )}
    </>
  );
}

function BypassWarning({
  opener,
  irreversible,
  pending,
  disabled,
  error,
  cancel,
  confirm,
}: {
  opener: RefObject<HTMLSelectElement | null>;
  irreversible: IrreversibleRule[];
  pending: boolean;
  disabled: boolean;
  error: unknown;
  cancel: () => void;
  confirm: () => void;
}) {
  const { t } = useTranslation();
  const title = useId(),
    description = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>('[data-action="cancel-bypass"]')?.focus();
    return () => {
      node?.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [opener]);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog bypass-warning"
      aria-labelledby={title}
      aria-describedby={description}
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) cancel();
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
      {error !== undefined && <ErrorMessage error={error} />}
      <footer>
        <button type="button" data-action="cancel-bypass" disabled={pending} onClick={cancel}>
          {t("workbench.cancel")}
        </button>
        <button
          type="button"
          className="primary"
          data-action="confirm-bypass"
          disabled={pending || disabled}
          onClick={confirm}
        >
          {t("bypass.confirm")}
        </button>
      </footer>
    </dialog>
  );
}
