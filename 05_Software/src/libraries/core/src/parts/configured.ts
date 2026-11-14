import { createHash } from "node:crypto";
import {
  type PartsCredential,
  type PartsSearchArgs,
  type PartsSearchSettings,
  type PartsSupplierId,
  partsSearchArgsSchema,
  partsSearchPluginId,
  partsSupplierIds,
} from "@vera/shared";
import type { LoadedPlugin } from "../plugins/store.js";
import { PartsHttpError, type PartsHttpOptions } from "./http.js";
import {
  type AccessToken,
  fitResult,
  groupDevices,
  type PartsItem,
  type PartsSearchResult,
  partsResultNotes,
  type SupplierAdapter,
  type SupplierAnswer,
  type SupplierReport,
  type SupplierRequest,
} from "./provider.js";
import { partsAdapters } from "./suppliers.js";

export class PartsAccessBlocked extends Error {
  constructor(readonly reason: "disabled" | "cancelled") {
    super(
      reason === "disabled"
        ? "Parts search is unavailable. Enable Web access and the official parts-search plugin for this workbench, and enable a supplier in Settings > Parts search."
        : "Parts search request cancelled or its authorization changed.",
    );
  }
}
/** The agent-facing port bound into a session's tool context. */
export interface PartsSearcher {
  search(args: unknown, signal: AbortSignal): Promise<PartsSearchResult>;
}
export interface PartsHost {
  config(): { parts: PartsSearchSettings; webEnabled: boolean };
  getCredential(supplier: PartsSupplierId, signal: AbortSignal): Promise<PartsCredential | undefined>;
  adapters?: Partial<Record<PartsSupplierId, SupplierAdapter>>;
  http?: PartsHttpOptions;
  now?: () => Date;
}
const statusMessages = {
  "key-required": "No credential is stored for this supplier. Enter it in Settings > Parts search.",
  partial:
    "Some results of this supplier are incomplete or could not be read, or it reported errors next to them.",
  failed: "The supplier reported errors and returned no readable result.",
  auth: "The supplier refused the credential. Check it in Settings > Parts search.",
  "rate-limited": "The supplier's request limit was reached. Retry later.",
  timeout: "The supplier did not answer in time. Retry or narrow the search.",
  unavailable: "The supplier could not be reached or answered with an error. Retry later.",
} as const;
const fingerprint = (credential: PartsCredential) =>
  createHash("sha256")
    .update(`${credential.id ?? ""}\u0000${credential.secret}`)
    .digest("hex");

/** The application gate stays authoritative for tools bound before a settings change (Web access model). */
export class ConfiguredPartsProvider {
  private readonly active = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly tokens = new Map<
    PartsSupplierId,
    { fingerprint: string; token?: { value: string; expiresAt: number }; request?: Promise<AccessToken> }
  >();
  private tokenController = new AbortController();
  private generation = 0;
  private closed = false;
  constructor(private readonly host: PartsHost) {}

  /** `allowed` rechecks the workbench's plugin gate at call time; Settings tests pass none. */
  search(args: unknown, caller: AbortSignal, allowed?: (signal: AbortSignal) => Promise<boolean>) {
    return this.track(this.perform(args, caller, allowed));
  }
  /** One keyword search with the stored credential; needs Web access only, not the plugin or supplier switch. */
  test(supplier: PartsSupplierId, caller: AbortSignal) {
    return this.track(
      (async () => {
        if (this.closed || !this.host.config().webEnabled) throw new PartsAccessBlocked("disabled");
        const { report } = await this.guarded(caller, (signal, assertCurrent) =>
          this.supplier(supplier, { by: "keyword", text: "resistor", limit: 1 }, signal, assertCurrent, true),
        );
        return report;
      })(),
    );
  }
  revoke() {
    this.generation++;
    this.tokens.clear();
    this.tokenController.abort(new PartsAccessBlocked("cancelled"));
    this.tokenController = new AbortController();
    for (const controller of this.active) controller.abort(new PartsAccessBlocked("cancelled"));
  }
  async close() {
    this.closed = true;
    this.revoke();
    await Promise.allSettled(this.pending);
  }

  private track<T>(operation: Promise<T>) {
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    );
    return operation;
  }
  private async guarded<T>(
    caller: AbortSignal,
    operation: (signal: AbortSignal, assertCurrent: () => void) => Promise<T>,
  ): Promise<T> {
    caller.throwIfAborted();
    const controller = new AbortController();
    const revision = this.generation;
    this.active.add(controller);
    const signal = AbortSignal.any([caller, controller.signal]);
    const assertCurrent = () => {
      if (signal.aborted || revision !== this.generation || this.closed || !this.host.config().webEnabled)
        throw new PartsAccessBlocked("cancelled");
    };
    try {
      return await operation(signal, assertCurrent);
    } catch (error) {
      if (signal.aborted || error instanceof PartsAccessBlocked) throw new PartsAccessBlocked("cancelled");
      throw error;
    } finally {
      // A supplier that failed the call (revocation, an unexpected error) also ends its siblings' requests.
      controller.abort();
      this.active.delete(controller);
    }
  }
  private async perform(
    raw: unknown,
    caller: AbortSignal,
    allowed?: (signal: AbortSignal) => Promise<boolean>,
  ): Promise<PartsSearchResult> {
    const args: PartsSearchArgs = partsSearchArgsSchema.parse(raw);
    const enabled = () => partsSupplierIds.filter((id) => this.host.config().parts.suppliers[id].enabled);
    if (this.closed || !this.host.config().webEnabled || enabled().length === 0)
      throw new PartsAccessBlocked("disabled");
    if (allowed && !(await allowed(caller))) throw new PartsAccessBlocked("disabled");
    caller.throwIfAborted();
    const suppliers = args.supplier === "all" ? enabled() : [args.supplier];
    if (args.supplier !== "all" && !enabled().includes(args.supplier))
      throw Error(`The supplier ${args.supplier} is not enabled. Enable it in Settings > Parts search.`);
    const search =
      args.query === undefined
        ? { by: "mpn" as const, text: args.mpn ?? "", limit: args.limit }
        : { by: "keyword" as const, text: args.query, limit: args.limit };
    const now = () => (this.host.now?.() ?? new Date()).toISOString();
    const retrievedAt = now();
    // The plugin gate is checked again once the credentials are read, before any supplier is contacted.
    let recheck: Promise<boolean> | undefined;
    const stillAllowed = allowed ? () => (recheck ??= allowed(caller)) : undefined;
    const outcomes = await this.guarded(caller, (signal, assertCurrent) =>
      Promise.all(
        suppliers.map((supplier) =>
          this.supplier(supplier, search, signal, assertCurrent, false, stillAllowed),
        ),
      ),
    );
    const secrets = outcomes.flatMap((outcome) => outcome.secrets);
    return redact(
      fitResult({
        kind: "parts-search-result",
        search,
        retrievedAt,
        suppliers: outcomes.map((outcome) => outcome.report),
        devices: groupDevices(
          outcomes
            .filter((outcome) => outcome.items.length)
            .map((outcome) => ({
              supplier: outcome.report.supplier,
              retrievedAt: outcome.report.retrievedAt ?? retrievedAt,
              items: outcome.items,
            })),
        ),
        truncated: false,
        notes: [...partsResultNotes],
      }),
      secrets,
    );
  }
  /** One supplier's search; its failure becomes its status, cancellation and revocation end the call. */
  private async supplier(
    supplier: PartsSupplierId,
    search: { by: "keyword" | "mpn"; text: string; limit: number },
    signal: AbortSignal,
    assertCurrent: () => void,
    testing: boolean,
    stillAllowed?: () => Promise<boolean>,
  ): Promise<{ report: SupplierReport; items: PartsItem[]; secrets: string[] }> {
    const adapter = this.host.adapters?.[supplier] ?? partsAdapters[supplier];
    const notice = adapter.notice ? { notice: adapter.notice } : {};
    const credential = await this.host.getCredential(supplier, signal);
    if (stillAllowed && !(await stillAllowed())) throw new PartsAccessBlocked("cancelled");
    assertCurrent();
    if (!testing && !this.host.config().parts.suppliers[supplier].enabled)
      throw new PartsAccessBlocked("cancelled");
    if (!credential?.secret)
      return {
        report: { supplier, status: "key-required", items: 0, message: statusMessages["key-required"] },
        items: [],
        secrets: [],
      };
    const secrets = [credential.secret, ...(credential.id ? [credential.id] : [])];
    const settings = this.host.config().parts;
    const request: SupplierRequest = {
      ...search,
      country: settings.country,
      language: settings.language,
      currency: settings.currency,
      farnellStore: settings.farnellStore,
    };
    const http = this.host.http ?? {};
    try {
      const tokens = adapter.token ? { ...adapter, token: adapter.token } : undefined;
      let token = tokens ? await this.token(supplier, tokens, credential, signal, false) : undefined;
      if (token) secrets.push(token);
      let answer: SupplierAnswer;
      try {
        assertCurrent();
        answer = await adapter.search(request, { credential, ...(token ? { token } : {}) }, signal, http);
      } catch (error) {
        if (!(tokens && error instanceof PartsHttpError && error.kind === "auth")) throw error;
        token = await this.token(supplier, tokens, credential, signal, true);
        secrets.push(token);
        assertCurrent();
        answer = await adapter.search(request, { credential, token }, signal, http);
      }
      assertCurrent();
      const retrievedAt = (this.host.now?.() ?? new Date()).toISOString();
      const failed = answer.errors.length > 0 && answer.items.length === 0;
      const status = failed ? "failed" : answer.partial ? "partial" : "ok";
      const message =
        status === "ok"
          ? {}
          : {
              message: `${statusMessages[status]}${answer.errors.length ? ` Codes: ${answer.errors.join(", ")}.` : ""}`,
            };
      return {
        report: { supplier, status, retrievedAt, items: answer.items.length, ...message, ...notice },
        items: answer.items,
        secrets,
      };
    } catch (error) {
      if (signal.aborted || error instanceof PartsAccessBlocked) throw new PartsAccessBlocked("cancelled");
      if (!(error instanceof PartsHttpError)) throw error;
      if (error.kind === "cancelled") throw new PartsAccessBlocked("cancelled");
      const status = error.kind === "invalid" ? "failed" : error.kind;
      return {
        report: { supplier, status, items: 0, message: statusMessages[status], ...notice },
        items: [],
        secrets,
      };
    }
  }
  /** One token request at a time per supplier and credential, reused until 60 s before expiry. */
  private async token(
    supplier: PartsSupplierId,
    adapter: SupplierAdapter & Required<Pick<SupplierAdapter, "token">>,
    credential: PartsCredential,
    signal: AbortSignal,
    refresh: boolean,
  ): Promise<string> {
    const print = fingerprint(credential);
    let entry = this.tokens.get(supplier);
    if (!entry || entry.fingerprint !== print) {
      entry = { fingerprint: print };
      this.tokens.set(supplier, entry);
    }
    const now = this.host.now?.().getTime() ?? Date.now();
    if (refresh) delete entry.token;
    if (entry.token && entry.token.expiresAt - 60000 > now) return entry.token.value;
    let request = entry.request;
    if (!request) {
      const owner = entry;
      const started = this.host.now?.().getTime() ?? Date.now();
      const created = adapter.token(credential, this.tokenController.signal, this.host.http ?? {});
      request = created;
      owner.request = created;
      void created.then(
        (token) => {
          if (owner.request === created)
            owner.token = { value: token.value, expiresAt: started + token.expiresIn * 1000 };
        },
        () => {},
      );
      void created
        .finally(() => {
          if (owner.request === created) delete owner.request;
        })
        .catch(() => {});
    }
    const pending = request;
    return (
      await new Promise<AccessToken>((resolve, reject) => {
        const stop = () => reject(new PartsAccessBlocked("cancelled"));
        if (signal.aborted) return stop();
        signal.addEventListener("abort", stop, { once: true });
        pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
      })
    ).value;
  }
}

/** Replaces any credential or token text that reached a result (a supplier echoing a key) with a marker. */
function redact<T>(value: T, secrets: string[]): T {
  const known = secrets.filter((secret) => secret.length >= 4);
  if (!known.length) return value;
  const clean = (item: unknown): unknown => {
    if (typeof item === "string")
      return known.reduce((text, secret) => text.split(secret).join("[redacted]"), item);
    if (Array.isArray(item)) return item.map(clean);
    if (item && typeof item === "object")
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, clean(entry)]));
    return item;
  };
  return clean(value) as T;
}

/** The tool stays hidden unless Web access is on, the plugin is loaded and a supplier is enabled. */
export function unavailablePartsTools(
  webEnabled: boolean,
  parts: PartsSearchSettings,
  pluginLoaded: boolean,
) {
  return webEnabled && pluginLoaded && partsSupplierIds.some((id) => parts.suppliers[id].enabled)
    ? []
    : ["parts_search"];
}

/** Only the reviewed official package opens the supplier accounts; a local copy with the same id does not. */
export function officialPartsPlugin(plugin: Pick<LoadedPlugin, "manifest" | "record">) {
  return plugin.manifest.id === partsSearchPluginId && plugin.record.tier === "official";
}
