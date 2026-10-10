import { veraErrorSchema } from "@vera/shared";
import { useTranslation } from "react-i18next";

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const parsed = veraErrorSchema.safeParse(error);
  const key = parsed.success ? parsed.data.messageKey : "errors.INTERNAL";
  const options = { operation: "", ...(parsed.success ? (parsed.data.params ?? {}) : {}) };
  const messages: Record<string, string> = {
    "errors.INVALID": t("errors.INVALID", options),
    "errors.NOT_FOUND": t("errors.NOT_FOUND", options),
    "errors.CONFLICT": t("errors.CONFLICT", options),
    "errors.BUSY": t("errors.BUSY", options),
    "errors.DENIED": t("errors.DENIED", options),
    "errors.CONTEXT_LIMIT": t("errors.CONTEXT_LIMIT", options),
    "errors.PROVIDER": t("errors.PROVIDER", options),
    "errors.OFFLINE": t("errors.OFFLINE", options),
    "errors.INTERNAL": t("errors.INTERNAL", options),
  };
  return (
    <p role="alert" data-i18n={Object.hasOwn(messages, key) ? key : "errors.INTERNAL"}>
      {Object.hasOwn(messages, key) ? messages[key] : messages["errors.INTERNAL"]}
    </p>
  );
}
