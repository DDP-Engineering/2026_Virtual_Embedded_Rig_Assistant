import { webApiKeySchema } from "@vera/shared";
import { z } from "zod";
import { type WebHttpOptions, webJson } from "./http.js";
import {
  publicWebUrl,
  type WebProvider,
  type WebReadRequest,
  type WebSearchRequest,
  type WebSource,
  webReadSchema,
  webSearchSchema,
} from "./provider.js";

const searchReply = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string(), content: z.string() })),
});
const extractReply = z.object({ results: z.array(z.object({ url: z.string(), raw_content: z.string() })) });
export class TavilyWebProvider implements WebProvider {
  constructor(private readonly options: WebHttpOptions = {}) {}
  private call(path: "search" | "extract", body: unknown, signal: AbortSignal) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.apiKey) headers.Authorization = `Bearer ${webApiKeySchema.parse(this.options.apiKey)}`;
    else headers["X-Tavily-Access-Mode"] = "keyless";
    return webJson(
      new URL(`https://api.tavily.com/${path}`),
      { method: "POST", headers, body: JSON.stringify(body) },
      signal,
      this.options,
    );
  }
  async search(request: WebSearchRequest, signal: AbortSignal) {
    const args = webSearchSchema.parse(request);
    const parsed = searchReply.safeParse(
      await this.call(
        "search",
        {
          query: args.query,
          max_results: args.limit,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        },
        signal,
      ),
    );
    if (!parsed.success) throw Error("Web service returned an invalid search response.");
    const sources: WebSource[] = [];
    let truncated = parsed.data.results.length > args.limit;
    for (const source of parsed.data.results) {
      let url: string;
      try {
        url = publicWebUrl(source.url);
      } catch {
        continue;
      }
      if (!source.content.trim()) continue;
      truncated ||= source.content.length > 3500;
      sources.push({ url, title: source.title.slice(0, 500), content: source.content.slice(0, 3500) });
    }
    if (!sources.length) throw Error("Web service returned no usable public sources. Refine the search.");
    return {
      provider: "tavily",
      retrievedAt: (this.options.now?.() ?? new Date()).toISOString(),
      sources: sources.slice(0, args.limit),
      truncated,
    };
  }
  async read(request: WebReadRequest, signal: AbortSignal) {
    const args = webReadSchema.parse(request);
    const requested = publicWebUrl(args.url);
    const parsed = extractReply.safeParse(
      await this.call("extract", { urls: [requested], extract_depth: "basic", format: "markdown" }, signal),
    );
    if (!parsed.success) throw Error("Web service returned an invalid extraction response.");
    const source = parsed.data.results.find((s) => {
      try {
        return publicWebUrl(s.url) === requested && !!s.raw_content.trim();
      } catch {
        return false;
      }
    });
    if (!source) throw Error("Web service could not extract the requested page. Try another source.");
    return {
      provider: "tavily",
      retrievedAt: (this.options.now?.() ?? new Date()).toISOString(),
      sources: [
        {
          url: publicWebUrl(source.url),
          title: source.url,
          content: source.raw_content.slice(0, args.maxCharacters),
        },
      ],
      truncated: source.raw_content.length > args.maxCharacters,
    };
  }
}
