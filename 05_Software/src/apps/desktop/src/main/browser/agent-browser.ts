import { randomUUID } from "node:crypto";
import type { AgentBrowserPort, BrowserCall, BrowserToolName, BrowserToolResult } from "@vera/core";
import type { Page } from "playwright-core";
import { BrowserError } from "./failure.js";
import type { BrowserHost, BrowserSession } from "./host.js";
import { browserUrl } from "./network.js";
import { inspectPage, navigatePage, scrollPage } from "./page-reading.js";
import type { BrowserAccessPolicy, BrowserOwner } from "./policy.js";

export const browserAgentLimits = {
  openMs: 35_000,
  operationMs: 12_000,
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

/** Restricts every browser operation to the lease and tabs of a single VERA session. */
export class AgentBrowser implements AgentBrowserPort {
  private browser: BrowserSession | undefined;
  private active: Tab | undefined;
  private readonly tabs = new Map<Page, Tab>();
  private queued = Promise.resolve();
  private budget?: { grant: AbortSignal; used: number };
  private pending = 0;

  constructor(
    private readonly owner: BrowserOwner,
    private readonly host: Pick<BrowserHost, "open" | "closeSession">,
    private readonly policy: Access,
    private readonly disabled: (tool: BrowserToolName) => boolean,
  ) {}

  available(tool: BrowserToolName): boolean {
    return !this.disabled(tool) && this.policy.authorization(this.owner) !== undefined;
  }

  async execute(call: BrowserCall, caller: AbortSignal): Promise<BrowserToolResult> {
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

      return await this.enqueue(call, caller, grant);
    } catch (error) {
      const { code, recovery } = error instanceof BrowserError ? error : new BrowserError("operation-failed");
      return { isError: true, code, error: recovery };
    }
  }

  private enqueue(call: BrowserCall, caller: AbortSignal, grant: AbortSignal) {
    const delay = call.name === "browser_open" ? browserAgentLimits.openMs : browserAgentLimits.operationMs;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), delay);
    timer.unref();
    const closing = call.name === "browser_close";
    // Startup can release its own failed lease. Let BrowserHost report that failure.
    const signal = AbortSignal.any(
      closing || call.name === "browser_open" ? [caller, timeout.signal] : [caller, timeout.signal, grant],
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
      const result = await Promise.race([this.perform(call, signal), cancelled]);
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

  private async perform(call: BrowserCall, signal: AbortSignal): Promise<BrowserToolResult> {
    switch (call.name) {
      case "browser_open":
        return this.open(call.args.url, signal);
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
        return this.navigate(tab, this.authorize(destination), signal);
      }
    }
  }

  private async open(value: string, signal: AbortSignal) {
    const url = this.authorize(value);
    const browser = this.browser ?? (await this.host.open(this.owner, signal));
    signal.throwIfAborted();
    if (browser.closed.aborted) throw new BrowserError("page-closed");
    if (this.browser !== browser) {
      this.browser = browser;
      browser.closed.addEventListener(
        "abort",
        () => {
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
      const location = await this.navigate(tab, url, signal);
      this.select(tab);
      return location;
    } catch (error) {
      if (!signal.aborted) await page.close();
      throw error;
    }
  }

  private async navigate(tab: Tab, url: string, signal: AbortSignal) {
    tab.links.clear();
    const finalUrl = await navigatePage(tab.page, url);
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
