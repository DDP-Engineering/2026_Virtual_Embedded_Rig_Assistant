import { veraErrorSchema } from "@vera/shared";
import { useTranslation } from "react-i18next";

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const parsed = veraErrorSchema.safeParse(error);
  const sent = parsed.success ? parsed.data.messageKey : "errors.INTERNAL";
  const options = {
    operation: "",
    endpoint: "",
    message: "",
    retryAfter: "",
    ...(parsed.success ? (parsed.data.params ?? {}) : {}),
  };
  const messages: Record<string, string> = {
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
    "errors.DENIED": t("errors.DENIED", options),
    "errors.CONTEXT_LIMIT": t("errors.CONTEXT_LIMIT", options),
    "errors.IMAGE_FORMAT": t("errors.IMAGE_FORMAT", options),
    "errors.IMAGE_TOO_LARGE": t("errors.IMAGE_TOO_LARGE", options),
    "errors.PROVIDER": t("errors.PROVIDER", options),
    "errors.OFFLINE": t("errors.OFFLINE", options),
    "errors.INTERNAL": t("errors.INTERNAL", options),
    "errors.YAML_INVALID": t("errors.YAML_INVALID", options),
    "errors.CONFIG_INVALID": t("errors.CONFIG_INVALID", options),
    "provider.auth": t("provider.auth", options),
    "provider.rateLimit": t("provider.rateLimit", options),
    "provider.context": t("provider.context", options),
    "provider.failure": t("provider.failure", options),
    "provider.timeout": t("provider.timeout", options),
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
  return (
    <p role="alert" data-i18n={key}>
      {messages[key]}
    </p>
  );
}
