import { EventEmitter } from "node:events";
import type { BrowserCall } from "@vera/core";
import { errors, type Page } from "playwright-core";
import { afterEach, expect, it, vi } from "vitest";
import { AgentBrowser, browserAgentLimits } from "./agent-browser.js";
import { BrowserError } from "./failure.js";
import type { BrowserSession } from "./host.js";
import { inspectPage } from "./page-reading.js";

vi.mock("./page-reading.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./page-reading.js")>()),
  inspectPage: vi.fn(),
}));

const url = "https://example.com/";
const nextUrl = `${url}next`;
const owner = { workbenchId: "bench", sessionId: "session" };
class FakePage extends EventEmitter {
  current = "about:blank";
  url = () => this.current;
  mainFrame = () => this;
  goto = vi.fn(async (destination: string) => {
    this.current = destination;
    this.emit("framenavigated", this);
    return {
      url: () => destination,
      headers: () => ({ "content-type": "text/html" }),
      status: () => 200,
    };
  });
  isClosed = () => this.closed;
  closed = false;
  close = async () => {
    this.closed = true;
    this.emit("close");
  };
  bringToFront = vi.fn(async () => {});
}

function harness(disabled = () => false, navigationTimeout?: () => number | undefined) {
  const grant = new AbortController();
  const closed = new AbortController();
  const all: FakePage[] = [];
  const prepareTab = vi.fn<(page: FakePage) => void>();
  const discardTab = vi.fn((page: Page) => page.close());
  const host = {
    open: vi.fn(
      async (): Promise<BrowserSession> => ({
        closed: closed.signal,
        discardTab,
        tabs: () => all.filter((page) => !page.closed) as unknown as Page[],
        async newTab() {
          const page = new FakePage();
          all.push(page);
          prepareTab(page);
          return page as unknown as Page;
        },
        async close() {
          await host.closeSession(owner);
        },
      }),
    ),
    closeSession: vi.fn(async (_owner: typeof owner) => {
      grant.abort();
      closed.abort();
      await Promise.all(all.map((page) => page.close()));
    }),
  };
  const access = {
    authorization: () => (grant.signal.aborted ? undefined : grant.signal),
    origins: () => [new URL(url).origin],
  };
  const browser = new AgentBrowser(owner, host, access, disabled, navigationTimeout);
  const run = (name: BrowserCall["name"], args = {}, signal = new AbortController().signal) =>
    browser.execute({ name, args } as BrowserCall, signal);
  return { host, run, all, browser, grant, closed, prepareTab, discardTab };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

it("captures the configured deadline for open and follow and restores automatic navigation on reset", async () => {
  let deadline: number | undefined = 20_000;
  const h = harness(undefined, () => deadline);
  await expect(h.run("browser_open", { url })).resolves.toMatchObject({ url });
  expect(h.all[0]?.goto).toHaveBeenLastCalledWith(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  vi.mocked(inspectPage).mockResolvedValue({
    url,
    title: "",
    text: "",
    links: [{ url: nextUrl, label: "Next" }],
    truncated: false,
  });
  const snapshot = await h.run("browser_snapshot");
  if (!("links" in snapshot)) throw Error("Missing snapshot");
  deadline = 25_000;
  await expect(h.run("browser_follow", { ref: snapshot.links[0]?.ref })).resolves.toMatchObject({
    url: nextUrl,
  });
  expect(h.all[0]?.goto).toHaveBeenLastCalledWith(nextUrl, {
    waitUntil: "domcontentloaded",
    timeout: 25_000,
  });
  deadline = undefined;
  await expect(h.run("browser_open", { url })).resolves.toMatchObject({ url });
  expect(h.all[1]?.goto).toHaveBeenLastCalledWith(url, { waitUntil: "domcontentloaded", timeout: 0 });
});

it("reports a configured navigation timeout and closes the browser session", async () => {
  const h = harness(undefined, () => 20_000);
  await h.run("browser_open", { url });
  const page = h.all[0];
  if (!page) throw Error("Missing opened page");
  vi.mocked(inspectPage).mockResolvedValue({
    url,
    title: "",
    text: "",
    links: [{ url: nextUrl, label: "Next" }],
    truncated: false,
  });
  const snapshot = await h.run("browser_snapshot");
  if (!("links" in snapshot)) throw Error("Missing snapshot");
  page.goto.mockRejectedValueOnce(new errors.TimeoutError("Navigation timed out"));
  await expect(h.run("browser_follow", { ref: snapshot.links[0]?.ref })).resolves.toMatchObject({
    isError: true,
    code: "operation-timeout",
  });
  expect(h.host.closeSession).toHaveBeenCalledExactlyOnceWith(owner);
});

it("reports an open navigation timeout without waiting for tab discard", async () => {
  const h = harness(undefined, () => 5_000);
  h.prepareTab.mockImplementation((page) => {
    page.goto.mockRejectedValueOnce(new errors.TimeoutError("Navigation timed out"));
  });
  h.discardTab.mockImplementation(() => new Promise(() => {}));
  await expect(h.run("browser_open", { url })).resolves.toMatchObject({
    isError: true,
    code: "operation-timeout",
  });
  expect(h.discardTab).not.toHaveBeenCalled();
  expect(h.host.closeSession).toHaveBeenCalledExactlyOnceWith(owner);
});

it("retains the inherited open and follow deadlines", async () => {
  vi.useFakeTimers();
  const opening = harness();
  opening.prepareTab.mockImplementation((page) => {
    page.goto.mockImplementation(() => new Promise(() => {}));
  });
  const open = opening.run("browser_open", { url });
  await vi.advanceTimersByTimeAsync(34_999);
  expect(opening.host.closeSession).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(open).resolves.toMatchObject({ code: "operation-timeout" });
  expect(opening.host.closeSession).toHaveBeenCalledExactlyOnceWith(owner);

  const following = harness();
  await following.run("browser_open", { url });
  vi.mocked(inspectPage).mockResolvedValue({
    url,
    title: "",
    text: "",
    links: [{ url: nextUrl, label: "Next" }],
    truncated: false,
  });
  const snapshot = await following.run("browser_snapshot");
  if (!("links" in snapshot)) throw Error("Missing snapshot");
  following.all[0]?.goto.mockImplementation(() => new Promise(() => {}));
  const follow = following.run("browser_follow", { ref: snapshot.links[0]?.ref });
  await vi.advanceTimersByTimeAsync(11_999);
  expect(following.host.closeSession).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(follow).resolves.toMatchObject({ code: "operation-timeout" });
  expect(following.host.closeSession).toHaveBeenCalledExactlyOnceWith(owner);
});

it("serializes tabs and invalidates stale, crossed and navigated snapshot references", async () => {
  const a = harness();
  const b = harness();
  await expect(a.run("browser_open", { url })).resolves.toMatchObject({ url });
  await b.run("browser_open", { url });
  vi.mocked(inspectPage).mockResolvedValue({
    url,
    title: "Fixture",
    text: "Untrusted rendered text",
    links: [{ url: nextUrl, label: "Next" }],
    truncated: false,
  });
  const first = await a.run("browser_snapshot");
  if (!("links" in first)) throw Error("Missing snapshot");
  expect(first).toMatchObject({ contentTrust: "untrusted-web-content", text: "Untrusted rendered text" });
  const ref = first.links[0]?.ref;
  await expect(b.run("browser_follow", { ref })).resolves.toMatchObject({ code: "stale-reference" });
  expect(b.all[0]?.goto).toHaveBeenCalledTimes(1);
  const second = await a.run("browser_snapshot");
  if (!("links" in second)) throw Error("Missing replacement snapshot");
  await expect(a.run("browser_follow", { ref })).resolves.toMatchObject({ code: "stale-reference" });
  const next = { ref: second.links[0]?.ref };
  await expect(a.run("browser_follow", next)).resolves.toMatchObject({ url: nextUrl });
  await expect(a.run("browser_follow", next)).resolves.toMatchObject({ code: "stale-reference" });
  await a.all[0]?.close();
  await expect(a.run("browser_snapshot")).resolves.toMatchObject({ code: "page-closed" });
});

it("presents a closed-window notice only to the current renderer after authority ends", async () => {
  const a = harness();
  await a.run("browser_open", { url });
  expect(a.browser.view(0)).toMatchObject({ open: true, currentUrl: url });
  a.closed.abort(new BrowserError("window-closed"));
  a.grant.abort();
  expect(a.browser.view(0)).toMatchObject({ open: false, currentUrl: null, failure: "window-closed" });
  expect(a.browser.view(performance.now() + 1)).toMatchObject({
    open: false,
    currentUrl: null,
    failure: null,
  });
});

it("stops waiting for the browser to show when its lease is revoked", async () => {
  const a = harness();
  await a.run("browser_open", { url });
  a.all[0]?.bringToFront.mockReturnValueOnce(new Promise(() => {}));
  const show = a.browser.show();
  a.grant.abort();
  await expect(show).rejects.toMatchObject({ code: "policy-denied" });
});

it("rechecks the tool gate after startup before navigating the new tab", async () => {
  let disabled = false;
  const a = harness(() => disabled);
  const start = a.host.open.getMockImplementation();
  if (!start) throw Error("Missing mock startup");
  a.host.open.mockImplementationOnce(async () => {
    const browser = await start();
    disabled = true;
    return browser;
  });
  await expect(a.run("browser_open", { url })).resolves.toMatchObject({ code: "policy-denied" });
  expect(a.all[0]?.goto).not.toHaveBeenCalled();
  expect(a.all[0]?.closed).toBe(true);
});

it("reports a page that closes halfway through switching tabs", async () => {
  const a = harness();
  const opened = await a.run("browser_open", { url });
  if (!("tabId" in opened) || !a.all[0]) throw Error("Missing tab");
  const page = a.all[0];
  page.bringToFront.mockImplementationOnce(async () => {
    await page.close();
    throw Error("Page closed during switch");
  });
  await expect(a.run("browser_switch", { tabId: opened.tabId })).resolves.toMatchObject({
    code: "page-closed",
  });
});

it("returns a deadline error and releases the owned session during stalled browser work", async () => {
  vi.useFakeTimers();
  const a = harness();
  await a.run("browser_open", { url });
  vi.mocked(inspectPage).mockReturnValue(new Promise(() => {}));
  const snapshot = a.run("browser_snapshot");
  await vi.advanceTimersByTimeAsync(browserAgentLimits.operationMs);
  await expect(snapshot).resolves.toMatchObject({ code: "operation-timeout" });
  expect(a.host.closeSession).toHaveBeenCalledWith(owner);
});

it("cancels queued calls without interrupting an active call and disposes actively aborted work", async () => {
  const a = harness();
  await a.run("browser_open", { url });
  vi.mocked(inspectPage).mockReturnValue(new Promise(() => {}));
  const active = new AbortController();
  const queued = new AbortController();
  const snapshot = a.run("browser_snapshot", {}, active.signal);
  await vi.waitFor(() => expect(inspectPage).toHaveBeenCalledOnce());
  const tabs = a.run("browser_tabs", {}, queued.signal);
  queued.abort();
  await expect(tabs).resolves.toMatchObject({ code: "cancelled" });
  expect(a.host.closeSession).not.toHaveBeenCalled();
  active.abort();
  await expect(snapshot).resolves.toMatchObject({ code: "cancelled" });
  expect(a.host.closeSession).toHaveBeenCalledOnce();
});

it("caps result text and total admission per grant while preserving close", async () => {
  const a = harness();
  const b = harness();
  await a.run("browser_open", { url });
  await b.run("browser_open", { url });
  vi.mocked(inspectPage).mockResolvedValue({
    url,
    title: "\uD800".repeat(4000),
    text: "\uD800".repeat(30000),
    links: Array.from({ length: 100 }, () => ({ label: '"'.repeat(300), url: nextUrl })),
    truncated: false,
  });
  const snapshot = await a.run("browser_snapshot");
  expect(snapshot).toMatchObject({ truncated: true, url });
  expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(browserAgentLimits.resultBytes);
  for (let index = 2; index < browserAgentLimits.operations; index++) {
    await expect(a.run("browser_tabs")).resolves.toHaveProperty("tabs");
  }
  await expect(a.run("browser_tabs")).resolves.toMatchObject({ code: "operation-limit" });
  await expect(a.run("browser_close")).resolves.toEqual({ closed: true });
  expect(a.all[0]?.closed).toBe(true);
  expect(b.all[0]?.closed).toBe(false);
});
