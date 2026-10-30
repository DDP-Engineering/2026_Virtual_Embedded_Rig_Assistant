// REQ-FUNC-39dc23b2 REQ-FUNC-a0ed7785 REQ-REL-ee363d68 REQ-SEC-6cf2d0e1
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { webApiKeySchema } from "@vera/shared";
import {
  publicWebUrl,
  webReadSchema as readSchema,
  webSearchSchema as searchSchema,
  type WebProvider,
  type WebReadRequest,
  type WebResult,
  type WebSearchRequest,
  type WebSource,
} from "./provider.js";

const endpoint = "https://mcp.exa.ai/mcp";
const responseLimit = 1048576;

class WebFailure extends Error {}

/** Restricted Exa client: no configurable server, OAuth, billing, sampling or server instructions. */
export class ExaWebProvider implements WebProvider {
  constructor(
    private readonly options: {
      fetch?: typeof fetch;
      now?: () => Date;
      timeoutMs?: number;
      apiKey?: string;
    } = {},
  ) {}

  async search(request: WebSearchRequest, signal: AbortSignal): Promise<WebResult> {
    const args = searchSchema.parse(request);
    const text = await this.call(
      "web_search_exa",
      {
        query: args.query,
        objective:
          args.objective ??
          "Find reliable, relevant sources answering this query, including source links and useful factual details.",
        numResults: args.limit,
      },
      signal,
    );
    const blocks = text.split(/\n\s*---\s*\n(?=\s*Title:)/);
    const sources: WebSource[] = [];
    let truncated = false;
    for (const block of blocks) {
      const match =
        /^Title:\s*([^\n]*)\nURL:\s*(\S+)[^\n]*\n(?:Published:[^\n]*\n)?(?:Author:[^\n]*\n)?(?:Highlights:|Text:|Content:)\s*\n?([\s\S]*)$/.exec(
          block.trim(),
        );
      if (!match)
        throw new WebFailure("Web provider returned an invalid response. Retry or refine the search.");
      try {
        const content = match[3]!.trim();
        sources.push({
          title: match[1]!.slice(0, 500),
          url: publicWebUrl(match[2]!),
          content: content.slice(0, 3500),
        });
        truncated ||= content.length > 3500;
      } catch {
        /* Never pass a local or credential-bearing source URL to the agent. */
      }
    }
    if (!sources.length)
      throw new WebFailure("Web provider returned no usable public sources. Refine the search.");
    return this.result(sources.slice(0, args.limit), truncated || sources.length > args.limit);
  }

  async read(request: WebReadRequest, signal: AbortSignal): Promise<WebResult> {
    const args = readSchema.parse(request);
    const text = await this.call(
      "web_fetch_exa",
      { urls: [publicWebUrl(args.url)], maxCharacters: args.maxCharacters },
      signal,
    );
    const match = /^#\s*([^\n]*)\nURL:\s*(\S+)\s*\n\s*\n([\s\S]*)$/.exec(text.trim());
    if (!match)
      throw new WebFailure("Web provider returned an invalid response. Try a different source URL.");
    const content = match[3]!.trim();
    return this.result(
      [
        {
          title: match[1]!.slice(0, 500),
          url: publicWebUrl(match[2]!),
          content: content.slice(0, args.maxCharacters),
        },
      ],
      content.length >= args.maxCharacters,
    );
  }

  private result(sources: WebSource[], truncated: boolean): WebResult {
    return {
      provider: "exa",
      retrievedAt: (this.options.now?.() ?? new Date()).toISOString(),
      sources,
      truncated,
    };
  }

  private async call(name: string, args: Record<string, unknown>, caller: AbortSignal): Promise<string> {
    const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 30000);
    const failed = new AbortController();
    let failure: WebFailure | undefined;
    const fail = (error: WebFailure) => {
      failure = error;
      failed.abort(error);
      return error;
    };
    const signal = AbortSignal.any([caller, deadline, failed.signal]);
    const client = new Client({ name: "VERA", version: "0.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      ...(this.options.apiKey
        ? { requestInit: { headers: { "x-api-key": webApiKeySchema.parse(this.options.apiKey) } } }
        : {}),
      fetch: async (input, init) => {
        signal.throwIfAborted();
        const request = new Request(input, init);
        if (request.url !== endpoint) throw new WebFailure("Web transport destination was rejected.");
        const response = await (this.options.fetch ?? fetch)(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if ([402, 429].includes(response.status))
            throw new WebFailure(
              "Web search service limit reached. Try again later or check the selected account quota.",
            );
          if ([401, 403].includes(response.status))
            throw new WebFailure(
              "Web search authentication failed. Check the selected access mode or API key.",
            );
          // An optional SSE listening stream is not supported by stateless Exa.
          if (request.method === "GET" && response.status === 405) return response;
          throw new WebFailure("Web search service is unavailable. Try again later.");
        }
        if (Number(response.headers.get("content-length")) > responseLimit) {
          await response.body?.cancel();
          throw new WebFailure("Web provider response exceeds the size limit. Narrow the request.");
        }
        if (!response.body) return response;
        const reader = response.body.getReader();
        let bytes = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                controller.close();
                return;
              }
              bytes += chunk.value.byteLength;
              if (bytes > responseLimit) {
                await reader.cancel();
                controller.error(
                  fail(new WebFailure("Web provider response exceeds the size limit. Narrow the request.")),
                );
              } else controller.enqueue(chunk.value);
            } catch (error) {
              controller.error(error);
            }
          },
          cancel: (reason) => reader.cancel(reason),
        });
        return new Response(body, { status: response.status, headers: response.headers });
      },
    });
    // Ensure pending initialize/stream reads terminate even if the server never responds.
    const abort = () => {
      void client.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      await client.connect(transport, { signal, timeout: this.options.timeoutMs ?? 30000 });
      const result = (await client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: this.options.timeoutMs ?? 30000,
      })) as CallToolResult;
      signal.throwIfAborted();
      if (result.isError)
        throw new WebFailure(
          "Web provider could not complete the request. Try again later or refine the query.",
        );
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n\n---\n\n");
      if (!text.trim()) throw new WebFailure("Web provider returned an empty response. Refine the request.");
      return text;
    } catch (error) {
      if (caller.aborted) throw new WebFailure("Web request cancelled.");
      if (deadline.aborted) throw new WebFailure("Web request timed out. Try again or narrow the request.");
      if (failure) throw failure;
      if (error instanceof WebFailure) throw error;
      throw new WebFailure(
        "Web search service is unavailable or returned an invalid response. Check your connection and try again.",
      );
    } finally {
      signal.removeEventListener("abort", abort);
      await client.close().catch(() => {});
    }
  }
}
