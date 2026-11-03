import { veraErrorSchema } from "@vera/shared";
import { useTranslation } from "react-i18next";

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const parsed = veraErrorSchema.safeParse(error);
  const key = parsed.success ? parsed.data.messageKey : "errors.INTERNAL";
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

    "errors.INVALID": t("errors.INVALID", options),
    "errors.NOT_FOUND": t("errors.NOT_FOUND", options),
    "errors.CONFLICT": t("errors.CONFLICT", options),
    "errors.BUSY": t("errors.BUSY", options),
    "errors.DENIED": t("errors.DENIED", options),
    "errors.CONTEXT_LIMIT": t("errors.CONTEXT_LIMIT", options),
    "errors.PROVIDER": t("errors.PROVIDER", options),
    "errors.OFFLINE": t("errors.OFFLINE", options),
    "errors.INTERNAL": t("errors.INTERNAL", options),
    "errors.YAML_INVALID": t("errors.YAML_INVALID", options),
    "errors.CONFIG_INVALID": t("errors.CONFIG_INVALID", options),
    "provider.auth": t("provider.auth", options),
    "provider.rateLimit": t("provider.rateLimit", options),
    "provider.context": t("provider.context", options),
    "provider.failure": t("provider.failure", options),
    "context.budget_exceeded": t("context.budget_exceeded", options),
    "approval.confirmMismatch": t("approval.confirmMismatch"),
    "documents.textBinary": t("documents.textBinary"),
    "documents.textTooLarge": t("documents.textTooLarge"),
    "plugins.catalogError.sha256": t("plugins.catalogError.sha256"),
    "plugins.catalogError.mismatch": t("plugins.catalogError.mismatch"),
    "plugins.catalogError.downgrade": t("plugins.catalogError.downgrade"),
    "plugins.catalogError.download": t("plugins.catalogError.download"),
  };
  return (
    <p role="alert" data-i18n={Object.hasOwn(messages, key) ? key : "errors.INTERNAL"}>
      {Object.hasOwn(messages, key) ? messages[key] : messages["errors.INTERNAL"]}
    </p>
  );
}
