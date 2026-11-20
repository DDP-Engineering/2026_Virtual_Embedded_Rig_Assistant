import {
  providerRetryAfterSchema,
  type QwenCloudPlan,
  type VeraError,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import { z } from "zod";

export interface ProviderFailure {
  status?: number;
  retryAfter?: string | undefined;
  offline?: boolean;
  context?: boolean;
  openCode?: { operation: "catalog" | "inference"; body?: unknown };
  qwenCloud?: { plan: QwenCloudPlan; operation: "catalog" | "inference"; body?: unknown };
}
function openCodeError(failure: ProviderFailure, raw: string): VeraError | undefined {
  const source = failure.openCode;
  if (!source || failure.status === 401) return undefined;
  const body = source.body;
  const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
  const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
  const detail = [type, code, message, typeof error === "string" ? error : raw]
    .filter((item) => typeof item === "string")
    .join(" ");
  if (/AuthError|invalid[_ ]api[_ ]key|invalid (?:or expired )?(?:key|token)|unauthenticated/i.test(detail))
    return { ...veraError("PROVIDER"), messageKey: "provider.auth" };
  if (
    failure.status === 402 ||
    /BalanceError|(?:User|Workspace)?BudgetError|SubscriptionUsageLimitError|insufficient[_ ](?:balance|credit)|(?:monthly limit|spending limit|usage limit|budget(?: limit)?) (?:reached|exceeded|exhausted)/i.test(
      detail,
    )
  )
    return { ...veraError("PROVIDER"), messageKey: "provider.openCodeBudget" };
  if (source.operation === "catalog" && failure.status === 403)
    return { ...veraError("PROVIDER"), messageKey: "provider.openCodeCatalog" };
  if (
    source.operation === "inference" &&
    (failure.status === 403 ||
      failure.status === 404 ||
      /ModelError|SubscriptionError|model_not_found|no active (?:Go )?subscription|model .*not (?:available|supported|allowed)/i.test(
        detail,
      ))
  )
    return { ...veraError("PROVIDER"), messageKey: "provider.openCodePlan" };
  return undefined;
}

const qwenCloudErrorFields = z.object({
  code: z.string().nullish(),
  type: z.string().nullish(),
  message: z.string().nullish(),
});
const qwenCloudErrorSchema = qwenCloudErrorFields.extend({ error: qwenCloudErrorFields.nullish() });
const qwenCloudModelAccessCodes = new Set([
  "access_denied",
  "accessdenied",
  "accessdenied.unpurchased",
  "model.accessdenied",
  "app.accessdenied",
  "workspace.accessdenied",
  "endpoint.accessdenied",
]);

function qwenCloudError(failure: ProviderFailure): VeraError | undefined {
  const source = failure.qwenCloud;
  if (!source) return;
  if (failure.status === 401) return { ...veraError("PROVIDER"), messageKey: "provider.qwenCloudAuth" };
  const parsed = qwenCloudErrorSchema.safeParse(source.body).data;
  const code = (parsed?.error?.code ?? parsed?.code ?? parsed?.error?.type ?? parsed?.type)?.toLowerCase();
  const message = parsed?.error?.message ?? parsed?.message ?? "";
  if (
    source.plan === "token-plan" &&
    failure.status === 429 &&
    (code === "insufficient_quota" || /^your token-plan quota has been exhausted[.!]?$/i.test(message))
  )
    return { ...veraError("PROVIDER"), messageKey: "provider.qwenCloudQuota" };
  if (
    source.operation === "inference" &&
    (failure.status === 404 ||
      (failure.status === 403 && code !== undefined && qwenCloudModelAccessCodes.has(code)) ||
      (failure.status === 400 &&
        (code === "invalid_parameter_error" || code === "invalidparameter") &&
        /^(?:the product is not activated\b|model not exist[.!]?\s*$)/i.test(message)))
  )
    return { ...veraError("PROVIDER"), messageKey: "provider.qwenCloudModel" };
  if (failure.status === 403) return { ...veraError("PROVIDER"), messageKey: "provider.qwenCloudAuth" };
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
      messageKey:
        scrub(structured.data.messageKey) === structured.data.messageKey
          ? structured.data.messageKey
          : `errors.${structured.data.code}`,
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
  const qwenCloud = qwenCloudError(failure);
  if (qwenCloud) return qwenCloud;
  if (
    failure.offline ||
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|connection error|network error/i.test(raw)
  )
    return { code: "OFFLINE", messageKey: "errors.OFFLINE", params: { endpoint: scrub(endpoint) } };
  const openCode = openCodeError(failure, raw);
  if (openCode) return openCode;
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
  const retryAfter =
    reason === "rate_limit" && failure.retryAfter
      ? providerRetryAfterSchema.safeParse(scrub(failure.retryAfter)).data
      : undefined;
  return {
    code: "PROVIDER",
    messageKey,
    params: {
      reason,
      message,
      endpoint: scrub(endpoint),
      ...(retryAfter ? { retryAfter } : {}),
    },
  };
}
