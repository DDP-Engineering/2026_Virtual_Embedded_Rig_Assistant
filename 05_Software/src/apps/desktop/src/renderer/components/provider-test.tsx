import type { ProviderTestResult } from "@vera/shared";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

export function ProviderTest({
  id,
  version,
  disabled,
  name,
  before,
  after,
}: {
  id: "openai" | `custom:${string}`;
  version: string;
  disabled: boolean;
  name?: string;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const { t } = useTranslation();
  const label = useId();
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const origin = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, [visible]);
  const generation = useRef(0);
  const currentVersion = useRef(version);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProviderTestResult>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    currentVersion.current = version;
    generation.current++;
    setResult(undefined);
    setError(undefined);
    setPending(false);
    setVisible(false);
    return () => {
      generation.current++;
    };
  }, [version]);
  async function run() {
    const current = ++generation.current;
    const isCurrent = () => current === generation.current && currentVersion.current === version;
    setPending(true);
    setVisible(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await api.invoke("providers.test", { id });
      if (isCurrent()) setResult(response);
    } catch (failure) {
      if (isCurrent()) setError(failure);
    } finally {
      if (isCurrent()) setPending(false);
    }
  }
  const labels = {
    reachability: t("providers.steps.reachability"),
    authentication: t("providers.steps.authentication"),
    tools: t("providers.steps.tools"),
    streaming: t("providers.steps.streaming"),
  };
  const states = {
    pass: t("providers.results.pass"),
    fail: t("providers.results.fail"),
    skipped: t("providers.results.skipped"),
  };
  return (
    <fieldset className="provider-test" aria-labelledby={label} aria-busy={pending}>
      <div className="workbench-actions provider-actions">
        {before}
        <button
          type="button"
          id={label}
          data-provider-test={id}
          aria-label={t("providers.testNamed", { name: name ?? id })}
          data-i18n="providers.test"
          disabled={disabled || pending}
          onClick={() => void run()}
        >
          {t("providers.test")}
        </button>
        {after}
      </div>
      <dialog
        ref={dialog}
        className="pinned-dialog provider-test-dialog"
        aria-labelledby={title}
        onCancel={(event) => {
          event.preventDefault();
          setVisible(false);
        }}
      >
        <header className="provider-test-header">
          <h3 id={title}>{t("providers.testNamed", { name: name ?? id })}</h3>
          <button type="button" aria-label={t("panel.close")} onClick={() => setVisible(false)}>
            ×
          </button>
        </header>
        <div className="provider-test-body" aria-busy={pending}>
          {(pending || result) && (
            <p
              role="status"
              aria-live="polite"
              data-i18n={pending ? "providers.testing" : result ? "providers.testComplete" : undefined}
            >
              {pending ? t("providers.testing") : result ? t("providers.testComplete") : ""}
            </p>
          )}
          {error !== undefined && <ErrorMessage error={error} />}
          {result && (
            <ol className="provider-test-results">
              {result.steps.map((step) => (
                <li key={step.step} data-test-step={step.step} data-test-status={step.status}>
                  <span>
                    {labels[step.step]}: {states[step.status]}
                  </span>
                  {step.error && <ErrorMessage error={step.error} />}
                </li>
              ))}
            </ol>
          )}
        </div>
      </dialog>
    </fieldset>
  );
}
