/** Supplier endpoints, exact origin and path; nothing else is ever contacted for parts search. */
export const partsEndpoints = new Set([
  "https://api.mouser.com/api/v2/search/keywordandmanufacturer",
  "https://api.mouser.com/api/v2/search/partnumberandmanufacturer",
  "https://api.digikey.com/v1/oauth2/token",
  "https://api.digikey.com/products/v4/search/keyword",
  "https://api.tme.eu/auth/token",
  "https://api.tme.eu/products/search",
  "https://api.tme.eu/products/data",
  "https://api.element14.com/catalog/products",
  "https://www.rutronik24.com/api/search/",
]);
export const PARTS_BODY_LIMIT = 4 * 1024 * 1024;

export type PartsHttpKind = "auth" | "rate-limited" | "timeout" | "cancelled" | "unavailable" | "invalid";
const messages: Record<PartsHttpKind, string> = {
  auth: "The supplier refused the credential. Check it in Settings > Parts search.",
  "rate-limited": "The supplier's request limit was reached. Retry later.",
  timeout: "The supplier did not answer in time. Retry or narrow the search.",
  cancelled: "Parts search request cancelled.",
  unavailable: "The supplier could not be reached or answered with an error. Retry later.",
  invalid: "The supplier answered in an unexpected form.",
};
/** A fixed message per kind: never a response body, a URL or a credential. */
export class PartsHttpError extends Error {
  constructor(readonly kind: PartsHttpKind) {
    super(messages[kind]);
  }
}
export interface PartsHttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Waits before the single retry of a 429 answer; tests shorten it. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
/** Seconds of an integer Retry-After header, bounded to 5 s; 1 s without one. */
export function retryDelay(header: string | null): number {
  const seconds = header !== null && /^\d{1,6}$/.test(header.trim()) ? Number(header.trim()) : 1;
  return Math.min(seconds, 5) * 1000;
}

/** One JSON request to a fixed supplier endpoint: 30 s, no redirect, 4 MiB, one bounded retry after 429. */
export async function partsJson(
  url: URL,
  init: RequestInit,
  caller: AbortSignal,
  options: PartsHttpOptions = {},
): Promise<unknown> {
  if (!partsEndpoints.has(url.origin + url.pathname) || url.username || url.password || url.hash)
    throw new PartsHttpError("unavailable");
  for (let attempt = 0; ; attempt++) {
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 30000);
    const signal = AbortSignal.any([caller, deadline]);
    let response: Response | undefined;
    try {
      signal.throwIfAborted();
      response = await (options.fetch ?? fetch)(url, { ...init, redirect: "error", signal });
      if (response.status === 429 && attempt === 0) {
        const wait = retryDelay(response.headers.get("retry-after"));
        await response.body?.cancel().catch(() => {});
        await (options.sleep ?? sleep)(wait, caller);
        continue;
      }
      if ([401, 403].includes(response.status)) throw new PartsHttpError("auth");
      if (response.status === 429) throw new PartsHttpError("rate-limited");
      if (!response.ok) throw new PartsHttpError("unavailable");
      if (Number(response.headers.get("content-length")) > PARTS_BODY_LIMIT)
        throw new PartsHttpError("unavailable");
      if (!response.body) throw new PartsHttpError("invalid");
      const text = await readLimited(response.body, signal);
      try {
        return JSON.parse(text);
      } catch {
        throw new PartsHttpError("invalid");
      }
    } catch (error) {
      if (caller.aborted) throw new PartsHttpError("cancelled");
      if (deadline.aborted) throw new PartsHttpError("timeout");
      if (error instanceof PartsHttpError) throw error;
      throw new PartsHttpError("unavailable");
    } finally {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }
}

async function readLimited(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string> {
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const item = await reader.read();
      signal.throwIfAborted();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > PARTS_BODY_LIMIT) {
        await reader.cancel();
        throw new PartsHttpError("unavailable");
      }
      chunks.push(item.value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
