import type { WebAccessSettings } from "@vera/shared";
import { ExaWebProvider } from "./exa.js";
import type { WebProvider, WebReadRequest, WebResult, WebSearchRequest } from "./provider.js";

export class WebAccessBlocked extends Error {
  constructor(readonly reason: "disabled" | "key-required" | "cancelled") {
    super(
      reason === "disabled"
        ? "Web access is disabled globally. Enable it in Settings > Web access."
        : reason === "key-required"
          ? "An Exa API key is required in the selected access mode. Configure it in Web access settings."
          : "Web access request cancelled or its authorization changed.",
    );
  }
}

/** The application gate remains authoritative even for tools bound before a settings change. */
export class ConfiguredWebProvider implements WebProvider {
  private readonly active = new Set<AbortController>();
  private readonly pending = new Set<Promise<WebResult>>();
  private generation = 0;
  private closed = false;
  constructor(
    private readonly host: {
      config(): WebAccessSettings;
      getKey(signal: AbortSignal): Promise<string | undefined>;
      create?: (key: string | undefined) => WebProvider;
    },
  ) {}
  search(args: WebSearchRequest, signal: AbortSignal) {
    return this.run("search", args, signal);
  }
  read(args: WebReadRequest, signal: AbortSignal) {
    return this.run("read", args, signal);
  }
  test(
    authentication: { authentication: "anonymous" | "api-key"; apiKey?: string | undefined },
    signal: AbortSignal,
  ) {
    return this.run(
      "search",
      { query: "Exa official web search documentation", limit: 1 },
      signal,
      authentication,
    );
  }
  revoke() {
    this.generation++;
    for (const controller of this.active) controller.abort(new WebAccessBlocked("cancelled"));
  }
  async close() {
    this.closed = true;
    this.revoke();
    await Promise.allSettled(this.pending);
  }
  private run(
    kind: "search" | "read",
    args: WebSearchRequest | WebReadRequest,
    caller: AbortSignal,
    override?: { authentication: "anonymous" | "api-key"; apiKey?: string | undefined },
  ) {
    const operation = this.perform(kind, args, caller, override);
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    );
    return operation;
  }
  private async perform(
    kind: "search" | "read",
    args: WebSearchRequest | WebReadRequest,
    caller: AbortSignal,
    override?: { authentication: "anonymous" | "api-key"; apiKey?: string | undefined },
  ): Promise<WebResult> {
    if (this.closed || !this.host.config().enabled) throw new WebAccessBlocked("disabled");
    caller.throwIfAborted();
    const controller = new AbortController(),
      revision = this.generation;
    this.active.add(controller);
    const signal = AbortSignal.any([caller, controller.signal]);
    try {
      const mode = override?.authentication ?? this.host.config().authentication;
      const key = mode === "api-key" ? (override?.apiKey ?? (await this.host.getKey(signal))) : undefined;
      signal.throwIfAborted();
      if (revision !== this.generation || !this.host.config().enabled)
        throw new WebAccessBlocked("cancelled");
      if (mode === "api-key" && !key) throw new WebAccessBlocked("key-required");
      const provider = this.host.create?.(key) ?? new ExaWebProvider(key ? { apiKey: key } : {});
      const result =
        kind === "search"
          ? await provider.search(args as WebSearchRequest, signal)
          : await provider.read(args as WebReadRequest, signal);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      if (signal.aborted) throw new WebAccessBlocked("cancelled");
      throw error;
    } finally {
      this.active.delete(controller);
    }
  }
}
