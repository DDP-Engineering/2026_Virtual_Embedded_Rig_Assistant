// REQ-UX-4bea0005

import type { SessionState } from "@vera/shared";
import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";

function defineTranslationKeys<const T extends readonly string[]>(keys: T): T {
  return keys;
}
const compactionKeys = defineTranslationKeys([
  "chat.compaction.none",
  "chat.compaction.running",
  "chat.compaction.completed",
  "chat.compaction.unavailable",
  "chat.compaction.failed",
]);
const compactionIndex = { none: 0, running: 1, completed: 2, unavailable: 3, failed: 4 } as const;
export function UsageMeter({ state }: { state: SessionState }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  const u = state.usage;
  const value = (count: number | undefined) => (count === undefined ? "—" : number.format(count));
  const percent = contextOccupancy(state);
  const toolCalls = state.items.filter((item) => item.kind === "tool").length;
  const row = (label: string, count: number | undefined) => (
    <div className="usage-row">
      <dt>{label}</dt>
      <dd>{value(count)}</dd>
    </div>
  );
  return (
    <section className="usage-meter" data-usage>
      {percent !== undefined && (
        <div className="usage-bar">
          <span>
            {t("chat.contextPercent", { percent })}
            {u.estimated ? ` (${t("chat.estimated")})` : ""}
          </span>
          <meter min={0} max={100} value={Math.min(100, percent)} aria-label={t("chat.contextWindow")} />
        </div>
      )}
      <div className="usage-groups">
        <div className="usage-group">
          <h3>{t("chat.usageGroup")}</h3>
          <dl>
            {row(t("chat.promptInput"), u.inputTokens)}
            {row(t("chat.promptOutput"), u.outputTokens)}
            {u.contextTokens !== undefined &&
              row(u.estimated ? t("chat.estimated") : t("chat.counted"), u.contextTokens)}
            {u.requestViewTokens !== undefined && row(t("chat.requestView"), u.requestViewTokens)}
          </dl>
        </div>
        <div className="usage-group">
          <h3>{t("chat.limitsGroup")}</h3>
          <dl>
            {row(t("chat.window"), u.contextWindow)}
            {row(t("chat.inputBudget"), u.inputBudgetTokens)}
            {row(t("chat.outputReserve"), u.reservedOutputTokens)}
            {row(t("chat.margin"), u.safetyMarginTokens)}
          </dl>
        </div>
      </div>
      <dl className="usage-summary">
        <div className="usage-row">
          <dt>{t("chat.model")}</dt>
          <dd>{state.modelRef ?? t("chat.defaultModel")}</dd>
        </div>
        {row(t("chat.turns"), state.turns.length)}
        {row(t("chat.toolCalls"), toolCalls)}
      </dl>
      {u.compactionStatus !== undefined && (
        <p className="usage-status" role="status">
          {t(compactionKeys[compactionIndex[u.compactionStatus]])}
        </p>
      )}
    </section>
  );
}

export function contextOccupancy(state: SessionState): number | undefined {
  const { requestViewTokens, contextTokens, contextWindow } = state.usage;
  const tokens = requestViewTokens ?? contextTokens;
  return tokens !== undefined && contextWindow !== undefined && contextWindow > 0
    ? Math.round((tokens / contextWindow) * 100)
    : undefined;
}
export function ContextIndicator({ state, open }: { state: SessionState; open: () => void }) {
  const { t } = useTranslation();
  const percent = contextOccupancy(state);
  const label = percent === undefined ? t("chat.contextUnknown") : t("chat.contextPercent", { percent });
  return (
    <button
      type="button"
      className="context-indicator"
      data-action="show-context"
      aria-label={t("chat.contextWindow")}
      aria-haspopup="dialog"
      title={`${label}${state.usage.estimated ? ` (${t("chat.estimated")})` : ""}`}
      onClick={open}
    >
      <Gauge aria-hidden="true" />
      <span>{percent === undefined ? "—" : `${percent}%`}</span>
    </button>
  );
}
