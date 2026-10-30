import { webApiKeySchema } from "@vera/shared";
import { z } from "zod";
import { type WebHttpOptions, webJson } from "./http.js";
import {
  publicWebUrl,
  type WebProvider,
  type WebReadRequest,
  type WebSearchRequest,
  type WebSource,
  webSearchSchema,
} from "./provider.js";

const reply = z.object({
  web: z.object({
    results: z.array(
      z.object({
        url: z.string(),
        title: z.string(),
        description: z.string(),
        extra_snippets: z.array(z.string()).optional(),
      }),
    ),
  }),
});
export class BraveWebProvider implements WebProvider {
  constructor(private readonly options: WebHttpOptions & { apiKey: string }) {}
  async search(request: WebSearchRequest, signal: AbortSignal) {
    const args = webSearchSchema.parse(request);
    if (args.query.length > 400 || args.query.trim().split(/\s+/).length > 50)
      throw Error("Web query for Brave must be at most 400 characters and 50 words. Narrow the query.");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", args.query);
    url.searchParams.set("count", String(args.limit));
    url.searchParams.set("extra_snippets", "true");
    const parsed = reply.safeParse(
      await webJson(
        url,
        {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": webApiKeySchema.parse(this.options.apiKey),
          },
        },
        signal,
        this.options,
      ),
    );
    if (!parsed.success) throw Error("Web service returned an invalid search response.");
    const sources: WebSource[] = [];
    let truncated = parsed.data.web.results.length > args.limit;
    for (const source of parsed.data.web.results) {
      let publicUrl: string;
      try {
        publicUrl = publicWebUrl(source.url);
      } catch {
        continue;
      }
      const content = [source.description, ...(source.extra_snippets ?? [])].join("\n");
      if (!content.trim()) continue;
      truncated ||= content.length > 3500;
      sources.push({ url: publicUrl, title: source.title.slice(0, 500), content: content.slice(0, 3500) });
    }
    if (!sources.length) throw Error("Web service returned no usable public sources. Refine the search.");
    return {
      provider: "brave",
      retrievedAt: (this.options.now?.() ?? new Date()).toISOString(),
      sources: sources.slice(0, args.limit),
      truncated,
    };
  }
  async read(_request: WebReadRequest, _signal: AbortSignal): Promise<never> {
    throw Error("Brave Search does not support page reading. Select Exa or Tavily in Web access.");
  }
}
