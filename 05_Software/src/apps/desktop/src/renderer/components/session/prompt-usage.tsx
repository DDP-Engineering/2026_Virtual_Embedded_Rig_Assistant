import type { SessionState } from "@vera/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

type UserItem = Extract<SessionState["items"][number], { kind: "user" }>;

/** One muted line under a question: its input and output tokens and the context it started from. */
export function PromptUsage({ usage }: { usage: UserItem["usage"] }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const percent = useMemo(
    () => new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }),
    [language],
  );
  const value = (count: number | undefined) => (count === undefined ? "—" : number.format(count));
  const context =
    usage?.contextTokens === undefined
      ? "—"
      : `${usage.estimated ? "≈" : ""}${usage.contextWindow ? percent.format(usage.contextTokens / usage.contextWindow) : t("chat.promptContextTokens", { count: usage.contextTokens, value: number.format(usage.contextTokens) })}`;
  return (
    <p className="prompt-usage" data-prompt-usage>
      <span>
        {t("chat.promptInput")} {value(usage?.inputTokens)}
      </span>
      <span>
        {t("chat.promptOutput")} {value(usage?.outputTokens)}
      </span>
      <span>
        {t("chat.promptInitialContext")} {context}
      </span>
      {usage?.shared && <span title={t("chat.promptSharedInfo")}>{t("chat.promptShared")}</span>}
    </p>
  );
}
