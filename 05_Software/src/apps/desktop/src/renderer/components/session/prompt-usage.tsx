import type { SessionState } from "@vera/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

type UserItem = Extract<SessionState["items"][number], { kind: "user" }>;

/** One muted line under a question: when it was sent, its input and output tokens and the context it started from. */
export function PromptUsage({
  usage,
  timestamp,
}: {
  usage: UserItem["usage"];
  timestamp?: number | undefined;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);
  const percent = useMemo(
    () => new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }),
    [language],
  );
  const time = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" }),
    [language],
  );
  // An out-of-range stored value would make Date throw; such a line shows no time.
  const sent = timestamp === undefined ? undefined : new Date(timestamp);
  const sentValid = sent !== undefined && !Number.isNaN(sent.getTime());
  const value = (count: number | undefined) => (count === undefined ? "—" : number.format(count));
  const context =
    usage?.contextTokens === undefined
      ? "—"
      : `${usage.estimated ? "≈" : ""}${usage.contextWindow ? percent.format(usage.contextTokens / usage.contextWindow) : t("chat.promptContextTokens", { count: usage.contextTokens, value: number.format(usage.contextTokens) })}`;
  return (
    <p className="prompt-usage" data-prompt-usage>
      {sentValid && (
        <time data-prompt-time dateTime={sent.toISOString()}>
          {time.format(sent)}
        </time>
      )}
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
