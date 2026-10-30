class WebHttpFailure extends Error {}
/** Fixed-service JSON transport; never fetches a source URL or returns response/error bodies. */
export type WebHttpOptions = { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number; now?: () => Date };
export async function webJson(
  url: URL,
  init: RequestInit,
  caller: AbortSignal,
  options: WebHttpOptions,
): Promise<unknown> {
  const allowed = new Set([
    "https://api.tavily.com/search",
    "https://api.tavily.com/extract",
    "https://api.search.brave.com/res/v1/web/search",
  ]);
  if (!allowed.has(url.origin + url.pathname) || url.username || url.password || url.hash)
    throw new WebHttpFailure("Web destination rejected.");
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 30000);
  const signal = AbortSignal.any([caller, deadline]);
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    response = await (options.fetch ?? fetch)(url, { ...init, redirect: "error", signal });
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        throw new WebHttpFailure("Web authentication failed. Check the selected provider API key.");
      if ([402, 429, 432, 433].includes(response.status))
        throw new WebHttpFailure(
          "Web service limit reached. Check the selected account quota or retry later.",
        );
      throw new WebHttpFailure("Web service unavailable. Retry later.");
    }
    if (Number(response.headers.get("content-length")) > 1048576)
      throw new WebHttpFailure("Web response exceeds the size limit.");
    if (!response.body) throw new WebHttpFailure("Web service returned an empty response.");
    const reader = response.body.getReader();
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        signal.throwIfAborted();
        const item = await reader.read();
        signal.throwIfAborted();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 1048576) {
          await reader.cancel();
          throw new WebHttpFailure("Web response exceeds the size limit.");
        }
        chunks.push(item.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new WebHttpFailure("Web service returned an invalid response.");
      }
    } finally {
      signal.removeEventListener("abort", abort);
      reader.releaseLock();
    }
  } catch (error) {
    if (caller.aborted) throw new WebHttpFailure("Web request cancelled.");
    if (deadline.aborted) throw new WebHttpFailure("Web request timed out. Retry or narrow the request.");
    if (error instanceof WebHttpFailure) throw error;
    throw new WebHttpFailure("Web service could not be reached. Check the connection and retry.");
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
