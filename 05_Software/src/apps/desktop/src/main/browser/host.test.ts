import type { BrowserContext, Page } from "playwright-core";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserHost, browserLimits } from "./host.js";
import type { BrowserProcess } from "./launcher.js";
import type { BrowserNetworkPolicy, BrowserOwner } from "./policy.js";

const owner = (sessionId = "session", workbenchId = "workbench"): BrowserOwner => ({
  workbenchId,
  sessionId,
});
const networkLease = () => ({ proxyServer: "http://127.0.0.1:1", attach: vi.fn(), close: vi.fn() });

function fakeBrowser() {
  const pages = new Set<Page>();
  let reportExit: () => void = () => {};
  let reportPage: (page: Page) => void = () => {};
  const createPage = () => {
    const page = {
      close: vi.fn(async () => {
        pages.delete(page as unknown as Page);
      }),
    } as unknown as Page;
    pages.add(page);
    reportPage(page);
    return page;
  };
  const context = {
    pages: () => Array.from(pages),
    newPage: vi.fn(async () => createPage()),
    on: (_event: string, report: (page: Page) => void) => {
      reportPage = report;
    },
  } as unknown as BrowserContext;
  const child: BrowserProcess = {
    context,
    onExit: (listener) => {
      reportExit = listener;
    },
    close: vi.fn(async () => {
      pages.clear();
    }),
  };
  return { child, exit: () => reportExit(), createPage };
}

const hosts: BrowserHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.shutdown()));
  vi.useRealTimers();
});

function create(policy: BrowserNetworkPolicy = { acquire: async () => networkLease() }) {
  const executable = vi.fn(async () => "verified");
  const launch = vi.fn(async (_executable: string, _signal: AbortSignal) => fakeBrowser().child);
  const host = new BrowserHost({ executable }, { policy, launch });
  hosts.push(host);
  return { host, executable, launch };
}

it("refuses product access before checking or launching the runtime", async () => {
  const executable = vi.fn(async () => "verified");
  const launch = vi.fn();
  const host = new BrowserHost({ executable }, { launch });
  hosts.push(host);
  await expect(host.open(owner())).rejects.toMatchObject({ code: "policy-denied" });
  expect(executable).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
});

it("bounds sessions and tabs including concurrently requested tabs and unsolicited tabs", async () => {
  const { host, launch } = create();
  const first = fakeBrowser();
  launch.mockResolvedValueOnce(first.child);
  const session = await host.open(owner());
  expect(await host.open(owner())).toBe(session);
  for (let index = 1; index < browserLimits.sessions; index++) await host.open(owner(String(index)));
  await expect(host.open(owner("excess"))).rejects.toMatchObject({ code: "session-limit" });
  const tabs = await Promise.all(Array.from({ length: browserLimits.tabs }, () => session.newTab()));
  expect(new Set(tabs).size).toBe(browserLimits.tabs);
  await expect(session.newTab()).rejects.toMatchObject({ code: "tab-limit" });
  const overflow = first.createPage();
  await vi.waitFor(() => expect(overflow.close).toHaveBeenCalled());
  expect(first.child.context.pages()).toHaveLength(browserLimits.tabs);
});

it("drains cancelled startup, child exit, workbench close and host shutdown", async () => {
  const lease = networkLease();
  const { host, launch } = create({ acquire: async () => lease });
  const first = fakeBrowser();
  const controller = new AbortController();
  let finish!: (child: BrowserProcess) => void;
  launch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = host.open(owner(), controller.signal);
  const cancelled = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  controller.abort();
  finish(first.child);
  await cancelled;
  expect(first.child.close).toHaveBeenCalledTimes(1);
  expect(lease.close).toHaveBeenCalledTimes(1);

  const exited = fakeBrowser();
  launch.mockResolvedValueOnce(exited.child);
  const session = await host.open(owner());
  exited.exit();
  await expect(session.newTab()).rejects.toMatchObject({ code: "cancelled" });
  await vi.waitFor(() => expect(exited.child.close).toHaveBeenCalledTimes(1));

  const sibling = fakeBrowser();
  launch.mockResolvedValueOnce(sibling.child);
  await host.open(owner("survivor", "other"));
  const family = fakeBrowser();
  launch.mockResolvedValueOnce(family.child);
  await host.open(owner("other-tab"));
  await host.closeWorkbench("workbench");
  expect(family.child.close).toHaveBeenCalledTimes(1);
  expect(sibling.child.close).not.toHaveBeenCalled();
  await host.shutdown();
  expect(sibling.child.close).toHaveBeenCalledTimes(1);
  await expect(host.open(owner())).rejects.toMatchObject({ code: "cancelled" });
});

it("expires a live session", async () => {
  vi.useFakeTimers();
  const { host, launch } = create();
  const browser = fakeBrowser();
  launch.mockResolvedValueOnce(browser.child);
  const session = await host.open(owner());
  await vi.advanceTimersByTimeAsync(browserLimits.lifetimeMs);
  expect(browser.child.close).toHaveBeenCalledTimes(1);
  await expect(session.newTab()).rejects.toMatchObject({ code: "cancelled" });
});

it("expires an in-progress startup and releases its network lease", async () => {
  vi.useFakeTimers();
  const lease = networkLease();
  const { host, launch } = create({ acquire: async () => lease });
  launch.mockImplementationOnce(
    (_executable, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const result = expect(host.open(owner())).rejects.toMatchObject({ code: "startup-timeout" });
  await vi.advanceTimersByTimeAsync(browserLimits.startupMs);
  await result;
  expect(lease.close).toHaveBeenCalledOnce();
});

it("closes Chromium if policy attachment stalls after launch", async () => {
  const lease = { ...networkLease(), attach: vi.fn(() => new Promise<void>(() => {})) };
  const { host, launch } = create({ acquire: async () => lease });
  const browser = fakeBrowser();
  launch.mockResolvedValueOnce(browser.child);
  const result = expect(host.open(owner())).rejects.toMatchObject({ code: "cancelled" });
  await vi.waitFor(() => expect(lease.attach).toHaveBeenCalledOnce());
  await host.shutdown();
  await result;
  expect(browser.child.close).toHaveBeenCalledOnce();
  expect(lease.close).toHaveBeenCalledOnce();
});

it("releases a late network lease from a cancelled startup", async () => {
  let deliver!: (lease: ReturnType<typeof networkLease>) => void;
  const acquire = vi.fn(
    () =>
      new Promise<ReturnType<typeof networkLease>>((resolve) => {
        deliver = resolve;
      }),
  );
  const { host, launch } = create({ acquire });
  const result = expect(host.open(owner())).rejects.toMatchObject({ code: "cancelled" });
  await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  await host.closeWorkbench("workbench");
  await result;
  const lease = networkLease();
  deliver(lease);
  await vi.waitFor(() => expect(lease.close).toHaveBeenCalledOnce());
  expect(launch).not.toHaveBeenCalled();
});
