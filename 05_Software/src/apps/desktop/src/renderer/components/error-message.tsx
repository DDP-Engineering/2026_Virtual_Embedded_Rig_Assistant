import { browserFailureCodeSchema, terminalInputLimit, veraErrorSchema } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { browserFailureText } from "../lib/browser-failure.js";

/** Asks the application to show Settings > Providers. */
export const OPEN_PROVIDERS = "vera:open-providers";

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const parsed = veraErrorSchema.safeParse(error);
  const sent = parsed.success ? parsed.data.messageKey : "errors.INTERNAL";
  if (sent.startsWith("browser.failure.")) {
    const browserFailure = browserFailureCodeSchema.safeParse(sent.slice("browser.failure.".length));
    if (browserFailure.success) return <p role="alert">{browserFailureText(t, browserFailure.data)}</p>;
  }
  const options = {
    operation: "",
    endpoint: "",
    message: "",
    retryAfter: "",
    ...(parsed.success ? (parsed.data.params ?? {}) : {}),
  };
  const messages: Record<string, string> = {
    "wireshark.invalidCitation": t("wireshark.invalidCitation"),
    "wireshark.fileUnavailable": t("wireshark.fileUnavailable"),
    "wireshark.staleCapture": t("wireshark.staleCapture"),
    "wireshark.invalidFilter": t("wireshark.invalidFilter"),
    "wireshark.desktopUnavailable": t("wireshark.desktopUnavailable"),
    "wireshark.tsharkUnavailable": t("wireshark.tsharkUnavailable"),
    "wireshark.launchFailed": t("wireshark.launchFailed"),
    "wireshark.timedOut": t("wireshark.timedOut"),
    "wireshark.verificationFailed": t("wireshark.verificationFailed"),
    "chatgpt.timeout": t("chatgpt.timeout"),
    "chatgpt.portBusy": t("chatgpt.portBusy"),
    "chatgpt.loginFailed": t("chatgpt.loginFailed"),
    "chatgpt.browserFailed": t("chatgpt.browserFailed"),

    "chatActions.clipboardFailed": t("chatActions.clipboardFailed"),
    "chatActions.promptNotReady": t("chatActions.promptNotReady"),
    "chatActions.shellMismatch": t("chatActions.shellMismatch"),
    "chatActions.shellUnavailable": t("chatActions.shellUnavailable", options),
    "errors.INVALID": t("errors.INVALID", options),
    "errors.NOT_FOUND": t("errors.NOT_FOUND", options),
    "errors.CONFLICT": t("errors.CONFLICT", options),
    "errors.BUSY": t("errors.BUSY", options),
    "errors.TURN_LIMIT": t("errors.TURN_LIMIT", { limit: "", ...options }),
    "errors.DENIED": t("errors.DENIED", options),
    "errors.CONTEXT_LIMIT": t("errors.CONTEXT_LIMIT", options),
    "errors.IMAGE_FORMAT": t("errors.IMAGE_FORMAT", options),
    "errors.IMAGE_TOO_LARGE": t("errors.IMAGE_TOO_LARGE", options),
    "errors.PROVIDER": t("errors.PROVIDER", options),
    "errors.OFFLINE": t("errors.OFFLINE", options),
    "errors.INTERNAL": t("errors.INTERNAL", options),
    "runs.stopUnconfirmed": t("runs.stopUnconfirmed"),
    "terminal.inputTooLong": t("terminal.inputTooLong", { limit: terminalInputLimit }),
    "errors.YAML_INVALID": t("errors.YAML_INVALID", options),
    "errors.CONFIG_INVALID": t("errors.CONFIG_INVALID", options),
    "provider.noModel": t("provider.noModel"),
    "provider.modelUnavailable": t("provider.modelUnavailable"),
    "provider.auth": t("provider.auth", options),
    "provider.openCodePlan": t("provider.openCodePlan"),
    "provider.openCodeCatalog": t("provider.openCodeCatalog"),
    "provider.openCodeBudget": t("provider.openCodeBudget"),
    "provider.workspaceInvalid": t("provider.workspaceInvalid"),
    "provider.workspaceUnavailable": t("provider.workspaceUnavailable"),
    "provider.serviceBindingInvalid": t("provider.serviceBindingInvalid"),
    "provider.serviceBindingAuth": t("provider.serviceBindingAuth"),
    "provider.scopedModelUnavailable": t("provider.scopedModelUnavailable"),
    "provider.qwenCloudAuth": t("provider.qwenCloudAuth"),
    "provider.qwenCloudModel": t("provider.qwenCloudModel"),
    "provider.qwenCloudQuota": t("provider.qwenCloudQuota"),
    "provider.rateLimit": options.retryAfter
      ? t("provider.rateLimitWithRetry", options)
      : t("provider.rateLimit"),
    "provider.context": t("provider.context", options),
    "provider.failure": t("provider.failure", options),
    "provider.timeout": t("provider.timeout", options),
    "provider.discoveryTimeout": t("provider.discoveryTimeout", options),
    "context.budget_exceeded": t("context.budget_exceeded", options),
    "approval.confirmMismatch": t("approval.confirmMismatch"),
    "documents.textBinary": t("documents.textBinary"),
    "documents.textTooLarge": t("documents.textTooLarge"),
    "plugins.catalogError.sha256": t("plugins.catalogError.sha256"),
    "plugins.catalogError.mismatch": t("plugins.catalogError.mismatch"),
    "plugins.catalogError.downgrade": t("plugins.catalogError.downgrade"),
    "plugins.catalogError.download": t("plugins.catalogError.download"),
  };
  // A key this list does not know still says what kind of error it is, by its code.
  const key = Object.hasOwn(messages, sent)
    ? sent
    : parsed.success
      ? `errors.${parsed.data.code}`
      : "errors.INTERNAL";
  // These errors are fixed on one page; the button takes the user there.
  const providers = ["provider.noModel", "provider.auth", "provider.modelUnavailable"].includes(key);
  return (
    <>
      <p role="alert" data-i18n={key}>
        {messages[key]}
      </p>
      {providers && (
        <button
          type="button"
          data-action="open-providers"
          onClick={() => window.dispatchEvent(new Event(OPEN_PROVIDERS))}
        >
          {t("provider.openSettings")}
        </button>
      )}
    </>
  );
}
