import { type VeraError, veraErrorSchema } from "@vera/shared";

export interface ProviderFailure {
  status?: number;
  retryAfter?: string | undefined;
  offline?: boolean;
  context?: boolean;
}
export function mapProviderError(
  error: unknown,
  scrub: (text: string) => string,
  endpoint: string,
  failure: ProviderFailure = {},
): VeraError {
  const structured = veraErrorSchema.safeParse(error);
  if (structured.success) {
    const params = structured.data.params;
    return {
      ...structured.data,
      ...(params
        ? {
            params: Object.fromEntries(
              Object.entries(params).map(([k, v]) => [scrub(k), typeof v === "string" ? scrub(v) : v]),
            ),
          }
        : {}),
    };
  }
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = scrub(raw);
  if (
    failure.offline ||
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|connection error|network error/i.test(raw)
  )
    return { code: "OFFLINE", messageKey: "errors.OFFLINE", params: { endpoint: scrub(endpoint) } };
  const reason =
    failure.status === 401 || failure.status === 403
      ? "auth"
      : failure.status === 429
        ? "rate_limit"
        : failure.context ||
            /context[_ -]?(length|window)|maximum context|too many tokens|token limit/i.test(raw)
          ? "context"
          : "provider";
  const messageKey =
    reason === "auth"
      ? "provider.auth"
      : reason === "rate_limit"
        ? "provider.rateLimit"
        : reason === "context"
          ? "provider.context"
          : "provider.failure";
  return {
    code: "PROVIDER",
    messageKey,
    params: {
      reason,
      message,
      endpoint: scrub(endpoint),
      ...(reason === "rate_limit" && failure.retryAfter ? { retryAfter: scrub(failure.retryAfter) } : {}),
    },
  };
}
