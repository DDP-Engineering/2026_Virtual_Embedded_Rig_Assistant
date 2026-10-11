// REQ-UX-4bea0005
import type { SessionState } from "@vera/shared";
import { useTranslation } from "react-i18next";
export function UsageMeter({ state }: { state: SessionState }) {
  const { t } = useTranslation();
  const u = state.usage;
  return (
    <footer className="usage-meter" data-usage>
      <span>
        {t("chat.tokens")}: {u.inputTokens} / {u.outputTokens}
      </span>
      {u.contextTokens !== undefined && (
        <span>
          {u.estimated ? t("chat.estimated") : t("chat.counted")}: {u.contextTokens}
        </span>
      )}
      {u.inputBudgetTokens !== undefined && (
        <span>
          {t("chat.inputBudget")}: {u.inputBudgetTokens}
        </span>
      )}
      {u.reservedOutputTokens !== undefined && (
        <span>
          {t("chat.outputReserve")}: {u.reservedOutputTokens}
        </span>
      )}
      {u.contextWindow !== undefined && (
        <span>
          {t("chat.window")}: {u.contextWindow}
        </span>
      )}
      {u.safetyMarginTokens !== undefined && (
        <span>
          {t("chat.margin")}: {u.safetyMarginTokens}
        </span>
      )}
      <span>{state.modelRef ?? t("chat.defaultModel")}</span>
    </footer>
  );
}
