import { type WebAccessSettings, type WebProviderId, webProviders } from "@vera/shared";
import { BraveWebProvider } from "./brave.js";
import { ExaWebProvider } from "./exa.js";
import type { WebProvider, WebReadRequest, WebResult, WebSearchRequest } from "./provider.js";
import { TavilyWebProvider } from "./tavily.js";

export class WebAccessBlocked extends Error {
  constructor(readonly reason: "disabled" | "key-required" | "cancelled") {
    super(
      reason === "disabled"
        ? "Web access is disabled globally. Enable it in Settings > Web access."
        : reason === "key-required"
          ? "An API key for the selected web provider is required in the selected access mode. Configure it in Web access settings."
          : "Web access request cancelled or its authorization changed.",
    );
  }
}

interface WebTurn {
  closed: boolean;
  exa?: { key: string | undefined; timeoutMs: number | undefined; provider: ExaWebProvider };
}

/** The application gate remains authoritative even for tools bound before a settings change. */
export class ConfiguredWebProvider implements WebProvider {
  private readonly active = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();
  private generation = 0;
  private closed = false;
  private readonly exaTurns = new Set<WebTurn>();
  constructor(
    private readonly host: {
      config(): WebAccessSettings;
      getKey(provider: WebProviderId, signal: AbortSignal): Promise<string | undefined>;
      create?: (
        provider: WebProviderId,
        key: string | undefined,
        options: { timeoutMs?: number },
      ) => WebProvider;
      /** The application's Web request timeout, read at each request (REQ-FUNC-5e129df5); 30 s when absent. */
      timeoutMs?: () => number;
    },
  ) {}
  search(args: WebSearchRequest, signal: AbortSignal) {
    return this.run("search", args, signal);
  }
  read(args: WebReadRequest, signal: AbortSignal) {
    return this.run("read", args, signal);
  }
  forTurn(): WebProvider & { close(): void } {
    const turn: WebTurn = { closed: false };
    return {
      search: (args, signal) => this.run("search", args, signal, undefined, turn),
      read: (args, signal) => this.run("read", args, signal, undefined, turn),
      close: () => {
        turn.closed = true;
        this.closeExaTurn(turn);
      },
    };
  }
  /** Direct downloads share global authorization/lifetime, never search-provider keys or capabilities. */
  withAccess<T>(
    operation: (signal: AbortSignal, assertCurrent: () => void) => Promise<T>,
    caller: AbortSignal,
  ): Promise<T> {
    const pending = (async () => {
      if (this.closed || !this.host.config().enabled) throw new WebAccessBlocked("disabled");
      caller.throwIfAborted();
      const controller = new AbortController();
      const revision = this.generation;
      this.active.add(controller);
      const signal = AbortSignal.any([caller, controller.signal]);
      const assertCurrent = () => {
        signal.throwIfAborted();
        if (revision !== this.generation || !this.host.config().enabled || this.closed)
          throw new WebAccessBlocked("cancelled");
      };
      try {
        return await operation(signal, assertCurrent);
      } catch (error) {
        if (signal.aborted) throw new WebAccessBlocked("cancelled");
        throw error;
      } finally {
        this.active.delete(controller);
      }
    })();
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
    return pending;
  }
  test(
    authentication: {
      provider: WebProviderId;
      authentication: "anonymous" | "api-key";
      apiKey?: string | undefined;
    },
    signal: AbortSignal,
  ) {
    return this.run(
      "search",
      { query: "official web search documentation", limit: 1 },
      signal,
      authentication,
    );
  }
  revoke() {
    this.generation++;
    for (const turn of this.exaTurns) this.closeExaTurn(turn);
    for (const controller of this.active) controller.abort(new WebAccessBlocked("cancelled"));
  }
  private closeExaTurn(turn: WebTurn) {
    void turn.exa?.provider.close();
    delete turn.exa;
    this.exaTurns.delete(turn);
  }

  private exaProvider(key: string | undefined, timeoutMs: number | undefined, turn: WebTurn | undefined) {
    const timing = timeoutMs === undefined ? {} : { timeoutMs };
    const options = { ...(key ? { apiKey: key } : {}), ...timing };
    if (!turn) return new ExaWebProvider(options);
    if (!turn.exa || turn.exa.key !== key || turn.exa.timeoutMs !== timeoutMs) {
      this.closeExaTurn(turn);
      turn.exa = { key, timeoutMs, provider: new ExaWebProvider({ ...options, reuseConnection: true }) };
      this.exaTurns.add(turn);
    }
    return turn.exa.provider;
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
    override?: {
      provider: WebProviderId;
      authentication: "anonymous" | "api-key";
      apiKey?: string | undefined;
    },
    turn?: WebTurn,
  ) {
    const operation = this.perform(kind, args, caller, override, turn);
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
    override?: {
      provider: WebProviderId;
      authentication: "anonymous" | "api-key";
      apiKey?: string | undefined;
    },
    turn?: WebTurn,
  ): Promise<WebResult> {
    if (this.closed || !this.host.config().enabled) throw new WebAccessBlocked("disabled");
    if (turn?.closed) throw new WebAccessBlocked("cancelled");
    caller.throwIfAborted();
    const controller = new AbortController(),
      revision = this.generation;
    this.active.add(controller);
    const signal = AbortSignal.any([caller, controller.signal]);
    try {
      const providerId = override?.provider ?? this.host.config().provider;
      if (kind === "read" && !webProviders[providerId].read)
        throw Error("Brave Search does not support page reading. Select Exa or Tavily in Web access.");
      const mode = override?.authentication ?? this.host.config().authentication;
      if (mode === "anonymous" && !webProviders[providerId].anonymous)
        throw new WebAccessBlocked("key-required");
      const key =
        mode === "api-key" ? (override?.apiKey ?? (await this.host.getKey(providerId, signal))) : undefined;
      signal.throwIfAborted();
      if (revision !== this.generation || !this.host.config().enabled || turn?.closed)
        throw new WebAccessBlocked("cancelled");
      if (mode === "api-key" && !key) throw new WebAccessBlocked("key-required");
      const timeoutMs = this.host.timeoutMs?.();
      const timing = timeoutMs === undefined ? {} : { timeoutMs };
      const provider =
        this.host.create?.(providerId, key, timing) ??
        (providerId === "exa"
          ? this.exaProvider(key, timeoutMs, turn)
          : providerId === "tavily"
            ? new TavilyWebProvider({ ...(key ? { apiKey: key } : {}), ...timing })
            : // Brave has no anonymous mode, so the checks above leave a key here.
              new BraveWebProvider({ apiKey: key ?? "", ...timing }));
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

export function unavailableWebTools(config: WebAccessSettings): string[] {
  return !config.enabled
    ? ["web_search", "web_read", "web_download"]
    : webProviders[config.provider].read
      ? []
      : ["web_read"];
}
