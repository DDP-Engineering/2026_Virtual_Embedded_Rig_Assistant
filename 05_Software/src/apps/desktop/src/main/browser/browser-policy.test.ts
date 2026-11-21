import { request as httpRequest } from "node:http";
import { defaultSettings, mergeSettings, mergeWorkbench, workbenchSchema } from "@vera/shared";
import { describe, expect, it, vi } from "vitest";
import { BrowserHost } from "./host.js";
import { browserLaunchOptions } from "./launcher.js";
import type { BrowserNetworkPorts } from "./network.js";
import { BrowserAccessPolicy } from "./policy.js";
import { browserNetworkLimits } from "./proxy.js";

describe("BRW-02 contract", () => {
  it("keeps independent app and workbench opt-ins off by default", () => {
    const settings = defaultSettings("29e10a0d-11eb-4e3d-8693-b7f50ee5bcaf");
    const workbench = workbenchSchema.parse({
      format: 1,
      id: "wb_00000000000000000000000000",
      name: "Board",
    });
    expect(settings.interactiveBrowser ?? false).toBe(false);
    expect(workbench.interactive_browser ?? false).toBe(false);
    expect(mergeSettings(settings, { interactiveBrowser: true }).interactiveBrowser).toBe(true);
    expect(mergeWorkbench(workbench, { interactive_browser: true }).interactive_browser).toBe(true);
  });

  it("disables ambient Chromium DNS while leaving the local proxy address usable", () => {
    expect(browserLaunchOptions("chrome", "http://127.0.0.1:1").args).toContain(
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    );
  });
});

const owner = { workbenchId: "bench", sessionId: "first" };
const other = { workbenchId: "bench", sessionId: "second" };
const origin = "http://browser.example.com";
const address = { address: "93.184.215.14", family: 4 };

function fixture() {
  let app = false;
  let workbench = false;
  const resolve = vi.fn<BrowserNetworkPorts["resolve"]>(async () => [address]);
  const request = vi.fn<BrowserNetworkPorts["request"]>(async () => ({
    status: 200,
    headers: { "content-type": "text/plain" },
    body: (async function* () {
      yield Buffer.from("fixture");
    })(),
    close() {},
  }));
  const access = new BrowserAccessPolicy((id) => app && workbench && id === owner.workbenchId, {
    resolve,
    request,
  });
  return {
    access,
    resolve,
    request,
    enable(nextApp: boolean, nextWorkbench: boolean) {
      app = nextApp;
      workbench = nextWorkbench;
      access.reconcile();
    },
  };
}

const lifetime = () => new AbortController().signal;

function read(proxy: string, value: string, method = "GET") {
  const server = new URL(proxy);
  const destination = new URL(value);
  return new Promise<{ status: number | undefined; text: string }>((resolve, reject) => {
    const req = httpRequest(server, { method, path: value, headers: { host: destination.host } }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (part: Buffer) => parts.push(part));
      res.once("error", reject);
      res.once("end", () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString() }));
    });
    req.once("error", reject);
    req.end();
  });
}

it.each([
  [false, false],
  [false, true],
  [true, false],
])("requires both opt-ins before granting or acquiring (%s, %s)", async (app, workbench) => {
  const f = fixture();
  const executable = vi.fn();
  const host = new BrowserHost({ executable }, { policy: f.access });
  f.enable(app, workbench);
  expect(() => f.access.grant(owner, origin)).toThrow("policy-denied");
  await expect(host.open(owner)).rejects.toMatchObject({ code: "policy-denied" });
  expect(executable).not.toHaveBeenCalled();
});

it("binds an exact canonical origin to its owning session and actual upstream address", async () => {
  const f = fixture();
  f.enable(true, true);
  expect(f.access.grant(owner, "http://BROWSER.example.com:80/")).toBe(origin);
  expect(f.access.origins(owner)).toEqual([origin]);
  expect(f.access.origins(other)).toEqual([]);
  await expect(f.access.acquire(other, lifetime())).rejects.toMatchObject({ code: "policy-denied" });
  await expect(f.access.acquire({ ...owner, workbenchId: "another" }, lifetime())).rejects.toMatchObject({
    code: "policy-denied",
  });
  const lease = await f.access.acquire(owner, lifetime());
  try {
    expect(await read(lease.proxyServer, `${origin}/fixture`)).toEqual({ status: 200, text: "fixture" });
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith("browser.example.com", expect.any(AbortSignal));
    expect(f.request).toHaveBeenCalledExactlyOnceWith(
      new URL(`${origin}/fixture`),
      address,
      "GET",
      { "accept-encoding": "identity" },
      expect.any(AbortSignal),
    );
    for (const denied of [
      "http://sub.browser.example.com/",
      "http://browser.example.com:81/",
      "http://127.0.0.1/",
    ])
      expect((await read(lease.proxyServer, denied)).status).toBe(403);
    expect((await read(lease.proxyServer, origin, "POST")).status).toBe(405);
    expect(f.request).toHaveBeenCalledTimes(1);
  } finally {
    await lease.close();
  }
});

it.each([
  "file:///owned-fixture.html",
  "data:text/plain,fixture",
  "ws://browser.example.com/",
  "https://localhost",
  "https://127.0.0.1",
  "https://2130706433",
  "https://10.0.0.1",
  "https://169.254.169.254",
  "https://100.64.0.1",
  "http://192.88.99.1",
  "https://[::1]",
  "https://[::ffff:c000:0201]",
  "https://[fe80::1]",
  "https://[64:ff9b::c000:0201]",
  "https://[2001:2::1]",
  "https://[3fff::1]",
  "https://browser.example.com./",
  "https://user:pass@browser.example.com",
  "https://browser.example.com/path",
])("rejects a grant for %s", (value) => {
  const f = fixture();
  f.enable(true, true);
  expect(() => f.access.grant(owner, value)).toThrow("destination-denied");
  expect(f.access.origins(owner)).toEqual([]);
});

it("rejects mixed or changing DNS answers and disallowed redirects before an upstream request", async () => {
  const f = fixture();
  f.enable(true, true);
  f.access.grant(owner, origin);
  f.resolve.mockResolvedValueOnce([address, { address: "10.0.0.1", family: 4 }]);
  f.request.mockResolvedValueOnce({
    status: 302,
    headers: { location: "http://another.example.com/" },
    body: (async function* () {})(),
    close() {},
  });
  const lease = await f.access.acquire(owner, lifetime());
  try {
    expect((await read(lease.proxyServer, origin)).status).toBe(403);
    expect(f.request).not.toHaveBeenCalled();
    expect((await read(lease.proxyServer, origin)).status).toBe(403);
    expect(f.request).toHaveBeenCalledTimes(1);
  } finally {
    await lease.close();
  }
});

it.each(["app", "workbench", "grant"] as const)(
  "revokes a pending request and discards its grant on %s revocation",
  async (kind) => {
    const f = fixture();
    f.enable(true, true);
    f.access.grant(owner, origin);
    const lease = await f.access.acquire(owner, lifetime());
    let markSeen!: (signal: AbortSignal) => void;
    const seen = new Promise<AbortSignal>((resolve) => {
      markSeen = resolve;
    });
    f.request.mockImplementationOnce(async (_url, _address, _method, _headers, signal) => {
      markSeen(signal);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw signal.reason;
    });
    const done = expect(read(lease.proxyServer, origin)).rejects.toThrow();
    const signal = await seen;
    if (kind === "grant") f.access.release(owner);
    else f.enable(kind !== "app", kind !== "workbench");
    expect(signal.aborted).toBe(true);
    await done;
    await lease.close();
    f.enable(true, true);
    expect(f.access.origins(owner)).toEqual([]);
    await expect(f.access.acquire(owner, lifetime())).rejects.toMatchObject({ code: "policy-denied" });
  },
);

it("bounds the grant count and refuses an oversized upstream body", async () => {
  const f = fixture();
  f.enable(true, true);
  for (let index = 0; index < 32; index++) f.access.grant(owner, `http://host${index}.example.com`);
  expect(() => f.access.grant(owner, origin)).toThrow("resource-limit");
  const closed = vi.fn();
  f.request.mockResolvedValueOnce({
    status: 200,
    headers: { "content-length": String(browserNetworkLimits.resourceBytes + 1) },
    body: (async function* () {})(),
    close: closed,
  });
  const lease = await f.access.acquire(owner, lifetime());
  try {
    expect((await read(lease.proxyServer, "http://host0.example.com/")).status).toBe(413);
    expect(closed).toHaveBeenCalledTimes(1);
  } finally {
    await lease.close();
  }
});

it("cancels the upstream at the request deadline and reports a timeout", async () => {
  const f = fixture();
  f.enable(true, true);
  f.access.grant(owner, origin);
  const lease = await f.access.acquire(owner, lifetime());
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
  f.request.mockImplementationOnce(async (_url, _address, _method, _headers, signal) => {
    deadline.abort();
    signal.throwIfAborted();
    throw Error("Request should have been cancelled");
  });
  try {
    expect((await read(lease.proxyServer, origin)).status).toBe(504);
    expect(timeout).toHaveBeenCalledWith(browserNetworkLimits.requestMs);
  } finally {
    timeout.mockRestore();
    await lease.close();
  }
});

it("rejects work over the parallel request budget before dialing upstream", async () => {
  const f = fixture();
  f.enable(true, true);
  f.access.grant(owner, origin);
  const lease = await f.access.acquire(owner, lifetime());
  f.request.mockImplementation(async (_url, _address, _method, _headers, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw signal.reason;
  });
  const requests = Promise.allSettled(
    Array.from({ length: browserNetworkLimits.parallel }, () => read(lease.proxyServer, origin)),
  );
  try {
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(browserNetworkLimits.parallel));
    expect((await read(lease.proxyServer, origin)).status).toBe(429);
    expect(f.request).toHaveBeenCalledTimes(browserNetworkLimits.parallel);
  } finally {
    await lease.close();
    await requests;
  }
});

it("cancels a stalled DNS resolution on revoke before contacting an upstream", async () => {
  const f = fixture();
  f.enable(true, true);
  f.access.grant(owner, origin);
  const lease = await f.access.acquire(owner, lifetime());
  let observed: AbortSignal | undefined;
  let cancelled = false;
  f.resolve.mockImplementationOnce(async (_host: string, signal?: AbortSignal) => {
    observed = signal;
    if (!signal) return [address];
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    cancelled = true;
    signal.throwIfAborted();
    return [address];
  });
  const result = read(lease.proxyServer, origin).then(
    () => "completed",
    () => "disconnected",
  );
  try {
    await vi.waitFor(() => expect(f.resolve).toHaveBeenCalledTimes(1));
    expect(observed).toBeInstanceOf(AbortSignal);
    f.access.release(owner);
    expect(await result).toBe("disconnected");
    expect(cancelled).toBe(true);
    expect(f.request).not.toHaveBeenCalled();
  } finally {
    await lease.close();
    await result;
  }
});
