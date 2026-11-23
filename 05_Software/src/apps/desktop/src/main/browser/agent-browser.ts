import { randomUUID } from "node:crypto";
import type { AgentBrowserPort, BrowserCall, BrowserToolName, BrowserToolResult } from "@vera/core";
import type { BrowserFailureCode, BrowserSessionView } from "@vera/shared";
import type { Page } from "playwright-core";
import { BrowserError } from "./failure.js";
import { type BrowserHost, type BrowserSession, browserLimits, untilAborted } from "./host.js";
import { browserUrl } from "./network.js";
import { inspectPage, navigatePage, scrollPage } from "./page-reading.js";
import type { BrowserAccessPolicy, BrowserOwner } from "./policy.js";

export const browserAgentLimits = {
  openMs: 35_000,
  operationMs: 12_000,
  showMs: 5_000,
  operations: 80,
  pending: 8,
  resultBytes: 24_000,
} as const;

interface Tab {
  page: Page;
  id: string;
  revision: number;
  links: Map<string, string>;
}

type Access = Pick<BrowserAccessPolicy, "authorization" | "origins">;

function configuredNavigationTimeout(error: unknown, navigationMs: number | undefined) {
  return navigationMs !== undefined && error instanceof BrowserError && error.code === "operation-timeout";
}

/** Restricts every browser operation to the lease and tabs of a single VERA session. */
export class AgentBrowser implements AgentBrowserPort {
  private browser: BrowserSession | undefined;
  private active: Tab | undefined;
  private readonly tabs = new Map<Page, Tab>();
  private queued = Promise.resolve();
  private budget?: { grant: AbortSignal; used: number };
  private pending = 0;
  private viewGeneration = 0;
  private failure: { code: BrowserFailureCode; at: number } | null = null;

  constructor(
    private readonly owner: BrowserOwner,
    private readonly host: Pick<BrowserHost, "open" | "closeSession">,
    private readonly policy: Access,
    private readonly disabled: (tool: BrowserToolName) => boolean,
    private readonly navigationTimeout: () => number | undefined = () => undefined,
  ) {}

  available(tool: BrowserToolName): boolean {
    return !this.disabled(tool) && this.policy.authorization(this.owner) !== undefined;
  }

  view(noticeSince: number): Pick<BrowserSessionView, "busy" | "open" | "currentUrl" | "failure"> {
    const page = this.visiblePage();
    const failure = this.failure;
    return {
      busy: this.pending > 0,
      open: !!this.browser && !this.browser.closed.aborted,
      currentUrl: page ? this.pageUrl(page) : null,
      failure:
        failure && (failure.at >= noticeSince || this.policy.authorization(this.owner)) ? failure.code : null,
    };
  }

  clearPresentation(): void {
    this.viewGeneration++;
    this.failure = null;
  }

  async show(): Promise<void> {
    const grant = this.policy.authorization(this.owner);
    if (!grant) throw new BrowserError("policy-denied");
    const page = this.visiblePage();
    if (!page) throw new BrowserError("page-closed");
    const timeout = AbortSignal.timeout(browserAgentLimits.showMs);
    const signal = AbortSignal.any([grant, timeout]);
    try {
      signal.throwIfAborted();
      await untilAborted(page.bringToFront(), signal);
      if (page.isClosed()) throw new BrowserError("window-closed");
      if (this.policy.authorization(this.owner) !== grant || !this.pageUrl(page))
        throw new BrowserError("policy-denied");
    } catch (error) {
      if (page.isClosed()) throw new BrowserError("window-closed", { cause: error });
      if (timeout.aborted) throw new BrowserError("operation-timeout", { cause: error });
      if (grant.aborted) throw new BrowserError("policy-denied", { cause: error });
      throw error instanceof BrowserError ? error : new BrowserError("operation-failed", { cause: error });
    }
  }

  async execute(call: BrowserCall, caller: AbortSignal): Promise<BrowserToolResult> {
    const presentation = this.viewGeneration;
    try {
      if (caller.aborted) throw new BrowserError("cancelled");
      const grant = this.policy.authorization(this.owner);
      if (!grant || this.disabled(call.name)) throw new BrowserError("policy-denied");
      const closing = call.name === "browser_close";
      if (this.budget?.grant !== grant) this.budget = { grant, used: 0 };
      // Leave one queue slot for close, even at the call or queue limit.
      if (this.pending >= browserAgentLimits.pending + Number(closing))
        throw new BrowserError("operation-limit");
      if (!closing && ++this.budget.used > browserAgentLimits.operations)
        throw new BrowserError("operation-limit");

      const result = await this.enqueue(call, caller, grant);
      if (
        presentation === this.viewGeneration &&
        (call.name === "browser_open" || call.name === "browser_follow" || call.name === "browser_close")
      ) {
        this.failure = null;
      }
      return result;
    } catch (error) {
      const { code, recovery } = error instanceof BrowserError ? error : new BrowserError("operation-failed");
      if (presentation === this.viewGeneration && code !== "cancelled" && code !== "policy-denied")
        this.failure = { code, at: performance.now() };
      return { isError: true, code, error: recovery };
    }
  }

  private enqueue(call: BrowserCall, caller: AbortSignal, grant: AbortSignal) {
    const opening = call.name === "browser_open";
    const navigationMs = opening || call.name === "browser_follow" ? this.navigationTimeout() : undefined;
    const delay = opening
      ? navigationMs === undefined
        ? browserAgentLimits.openMs
        : browserLimits.startupMs + navigationMs
      : (navigationMs ?? browserAgentLimits.operationMs);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), delay);
    timer.unref();
    const closing = call.name === "browser_close";
    // Startup can release its own failed lease. Let BrowserHost report that failure.
    const signal = AbortSignal.any(
      closing || opening ? [caller, timeout.signal] : [caller, timeout.signal, grant],
    );
    let running = false;
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => {
        if (running && !grant.aborted) void this.host.closeSession(this.owner).catch(() => {});
        reject(new BrowserError(timeout.signal.aborted ? "operation-timeout" : "cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });

    this.pending++;
    const job = this.queued.then(async () => {
      signal.throwIfAborted();
      if (this.policy.authorization(this.owner) !== grant || this.disabled(call.name))
        throw new BrowserError("policy-denied");
      running = true;
      const operation = this.perform(call, signal, navigationMs).catch((error: unknown) => {
        if (configuredNavigationTimeout(error, navigationMs)) timeout.abort();
        throw error;
      });
      const result = await Promise.race([operation, cancelled]);
      if (!closing && (this.policy.authorization(this.owner) !== grant || this.disabled(call.name)))
        throw new BrowserError("policy-denied");
      return result;
    });
    this.queued = job
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.pending--;
      });
    return Promise.race([job, cancelled]).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    });
  }

  private async perform(
    call: BrowserCall,
    signal: AbortSignal,
    navigationMs: number | undefined,
  ): Promise<BrowserToolResult> {
    switch (call.name) {
      case "browser_open":
        return this.open(call.args.url, signal, navigationMs);
      case "browser_tabs": {
        const tabs = this.ownedTabs();
        return {
          activeTabId: tabs.find((tab) => tab === this.active)?.id ?? null,
          tabs: tabs.map(({ id, page }) => ({ tabId: id, url: this.pageUrl(page) })),
        };
      }
      case "browser_close":
        await this.host.closeSession(this.owner);
        return { closed: true };
      case "browser_switch": {
        const tab = this.ownedTabs().find((owned) => owned.id === call.args.tabId);
        if (!tab) throw new BrowserError("page-closed");
        if (!this.pageUrl(tab.page)) throw new BrowserError("unsupported-content");
        try {
          await tab.page.bringToFront();
        } catch (error) {
          if (tab.page.isClosed()) throw new BrowserError("page-closed");
          throw error;
        }
        signal.throwIfAborted();
        const url = this.location(tab);
        this.select(tab);
        return { tabId: tab.id, url };
      }
      case "browser_scroll": {
        const tab = this.selected();
        const url = this.location(tab);
        tab.links.clear();
        await scrollPage(tab.page, call.args.direction);
        signal.throwIfAborted();
        return { tabId: tab.id, url: this.location(tab, url) };
      }
      case "browser_snapshot":
        return this.snapshot(this.selected(), signal);
      case "browser_follow": {
        const tab = this.selected();
        const destination = tab.links.get(call.args.ref);
        if (!destination) throw new BrowserError("stale-reference");
        return this.navigate(tab, this.authorize(destination), signal, navigationMs);
      }
    }
  }

  private async open(value: string, signal: AbortSignal, navigationMs: number | undefined) {
    const url = this.authorize(value);
    const browser = this.browser ?? (await this.host.open(this.owner, signal));
    signal.throwIfAborted();
    if (browser.closed.aborted) throw new BrowserError("page-closed");
    if (this.browser !== browser) {
      this.browser = browser;
      browser.closed.addEventListener(
        "abort",
        () => {
          if (
            browser.closed.reason instanceof BrowserError &&
            browser.closed.reason.code === "window-closed"
          ) {
            this.clearPresentation();
            this.failure = { code: "window-closed", at: performance.now() };
          }
          this.browser = undefined;
          this.active = undefined;
          this.tabs.clear();
        },
        { once: true },
      );
    }
    const page = await browser.newTab();
    signal.throwIfAborted();
    const tab = this.remember(page);
    try {
      if (!this.available("browser_open")) throw new BrowserError("policy-denied");
      const location = await this.navigate(tab, url, signal, navigationMs);
      this.select(tab);
      return location;
    } catch (error) {
      // The operation deadline owns session cancellation and cannot wait for tab disposal.
      if (!signal.aborted && !page.isClosed() && !configuredNavigationTimeout(error, navigationMs))
        await browser.discardTab(page);
      throw error;
    }
  }

  private async navigate(tab: Tab, url: string, signal: AbortSignal, navigationMs: number | undefined) {
    tab.links.clear();
    const finalUrl = await navigatePage(tab.page, url, navigationMs);
    signal.throwIfAborted();
    return { tabId: tab.id, url: this.location(tab, finalUrl) };
  }

  private async snapshot(tab: Tab, signal: AbortSignal) {
    const url = this.location(tab);
    const revision = tab.revision;
    tab.links.clear();
    const raw = await inspectPage(tab.page);
    signal.throwIfAborted();
    if (revision !== tab.revision || url !== raw.url || url !== this.location(tab))
      throw new BrowserError("stale-reference");
    const snapshotId = randomUUID();
    const title = bounded(raw.title, 240);
    const text = bounded(raw.text, 4000);
    const result = {
      tabId: tab.id,
      url,
      snapshotId,
      title,
      text,
      contentTrust: "untrusted-web-content" as const,
      links: [] as { ref: string; label: string }[],
      truncated: raw.truncated || raw.title.length > 240 || raw.text.length > 4000,
    };
    for (const candidate of raw.links.slice(0, 48)) {
      const ref = `${snapshotId}:${result.links.length + 1}`;
      const label = bounded(candidate.label, 160);
      result.links.push({ ref, label });
      if (Buffer.byteLength(JSON.stringify(result)) > browserAgentLimits.resultBytes) {
        result.links.pop();
        result.truncated = true;
        break;
      }
      if (candidate.label.length > 160) result.truncated = true;
      tab.links.set(ref, candidate.url);
    }
    if (result.links.length < raw.links.length) result.truncated = true;
    return result;
  }

  private authorize(url: string): string {
    const allowed = browserUrl(url);
    if (
      Buffer.byteLength(JSON.stringify(allowed.href)) > 4096 ||
      !this.policy.origins(this.owner).includes(allowed.origin)
    )
      throw new BrowserError("destination-denied");
    return allowed.href;
  }

  private visiblePage(): Page | undefined {
    const selected = this.active?.page;
    if (selected && !selected.isClosed() && this.pageUrl(selected)) return selected;
    return this.browser?.tabs().find((page) => !page.isClosed() && this.pageUrl(page));
  }

  private pageUrl(page: Page): string | null {
    try {
      return this.authorize(page.url());
    } catch {
      return null;
    }
  }

  private location(tab: Tab, expected?: string): string {
    if (tab.page.isClosed()) throw new BrowserError("page-closed");
    const url = this.authorize(tab.page.url());
    if (expected && expected !== url) throw new BrowserError("stale-reference");
    return url;
  }

  private select(tab: Tab) {
    this.active?.links.clear();
    tab.links.clear();
    this.active = tab;
  }

  private selected(): Tab {
    if (!this.active || this.active.page.isClosed()) throw new BrowserError("page-closed");
    return this.active;
  }

  private ownedTabs() {
    return (this.browser?.tabs() ?? []).map((page) => this.remember(page));
  }

  private remember(page: Page): Tab {
    const known = this.tabs.get(page);
    if (known) return known;
    const tab: Tab = { page, id: randomUUID(), revision: 0, links: new Map() };
    this.tabs.set(page, tab);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        tab.links.clear();
        tab.revision++;
      }
    });
    page.once("close", () => {
      tab.links.clear();
      this.tabs.delete(page);
    });
    return tab;
  }
}

function bounded(value: string, limit: number): string {
  return value
    .slice(0, limit)
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, (character) =>
      character === "\n" || character === "\t" ? character : " ",
    )
    .replace(/[\uD800-\uDFFF]/gu, "\uFFFD");
}
