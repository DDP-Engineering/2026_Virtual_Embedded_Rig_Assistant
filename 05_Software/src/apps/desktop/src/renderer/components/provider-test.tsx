import type { ProviderTestResult, ProviderTestStep } from "@vera/shared";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import type { ProviderId } from "./provider-models.js";

const steps = ["reachability", "authentication", "tools", "streaming"] as const;

export function ProviderTest({
  id,
  model,
  version,
  disabled,
  name,
  before,
  after,
}: {
  id: ProviderId;
  model?: string | undefined;
  version: string;
  disabled: boolean;
  name: string;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const { t } = useTranslation();
  const statusId = useId();
  const active = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<
    Partial<Record<ProviderTestStep["step"], ProviderTestStep["status"]>>
  >({});
  const [result, setResult] = useState<ProviderTestResult>();
  const [error, setError] = useState<unknown>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different connection or model invalidates the running test.
  useEffect(() => {
    setPending(false);
    setProgress({});
    setResult(undefined);
    setError(undefined);
    const off = api.subscribe("app", (event) => {
      if (event.type === "provider.test.step" && event.testId === active.current)
        setProgress((current) => ({ ...current, [event.step]: event.status }));
    });
    return () => {
      active.current = undefined;
      off();
    };
  }, [version, model]);
  async function run() {
    const testId = crypto.randomUUID();
    active.current = testId;
    setPending(true);
    setError(undefined);
    setProgress({});
    setResult(undefined);
    try {
      const response = await api.invoke("providers.test", { id, ...(model ? { model } : {}), testId });
      if (active.current === testId) setResult(response);
    } catch (failure) {
      if (active.current === testId) setError(failure);
    } finally {
      if (active.current === testId) {
        active.current = undefined;
        setPending(false);
      }
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
  const completed = steps.filter((step) => progress[step]);
  const next = steps.find((step) => !progress[step]);
  const last = completed.at(-1);
  const lastStatus = last && progress[last];
  const pendingText = next ? t("providers.testStage", { step: labels[next] }) : t("providers.testing");
  const status = pending
    ? last && lastStatus
      ? `${labels[last]}: ${states[lastStatus]} · ${pendingText}`
      : pendingText
    : error !== undefined || result?.steps.some((step) => step.status === "fail")
      ? t("providers.testFailed")
      : result
        ? t("providers.testPassed")
        : "";
  return (
    <div className="provider-test">
      <div className="workbench-actions provider-actions">
        {before}
        <button
          type="button"
          data-provider-test={id}
          aria-label={t("providers.testNamed", { name })}
          aria-describedby={statusId}
          data-i18n="providers.test"
          disabled={disabled || pending}
          onClick={() => void run()}
        >
          {t("providers.test")}
        </button>
        {after}
        <span className="provider-test-status" id={statusId} role="status" title={status}>
          {status}
        </span>
      </div>
      {(error !== undefined || result) && (
        <details className="provider-test-details">
          <summary>{t("providers.testDetails")}</summary>
          {error !== undefined && <ErrorMessage error={error} />}
          {result && (
            <ol className="provider-test-results">
              {result.steps.map((step) => (
                <li key={step.step} data-test-step={step.step} data-test-status={step.status}>
                  <span>
                    {labels[step.step]} · {states[step.status]}
                  </span>
                  {step.error && <ErrorMessage error={step.error} />}
                </li>
              ))}
            </ol>
          )}
        </details>
      )}
    </div>
  );
}
