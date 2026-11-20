import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { BrowserError } from "./failure.js";
import type { BrowserHost } from "./host.js";
import type { BrowserNetworkPorts } from "./network.js";
import type { BrowserAccessPolicy, BrowserOwner } from "./policy.js";
import { browserRelease } from "./release.js";
import type { BrowserRuntime } from "./runtime.js";

const fixtureOrigin = "https://docs.vera-browser.example.com";
const resourceOrigin = "https://assets.vera-browser.example.com";
const deniedOrigin = "https://other.vera-browser.example.com";
const fixtureUrl = `${fixtureOrigin}/fixture`;
const fixtureHtml = `<!doctype html>
<title>VERA browser fixture</title>
<main>Waiting for script</main>
<script>document.querySelector("main").textContent = "Rendered by JavaScript";</script>`;

/** The instrumented app serves official archive bytes and deterministic DNS/upstream responses. */
export function createBrowserFixture(archive: string) {
  const transfer: typeof fetch = async (input, options) => {
    if (input !== browserRelease()?.url) throw new BrowserError("download");
    const stream = createReadStream(archive, { signal: options?.signal ?? undefined });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>);
  };
  const requests: string[] = [];
  let aborted = 0;
  const network: BrowserNetworkPorts = {
    async resolve(hostname) {
      return [{ address: hostname.startsWith("internal.") ? "192.168.1.1" : "93.184.215.14", family: 4 }];
    },
    async request(url, _address, method, _headers, signal) {
      signal.throwIfAborted();
      requests.push(url.href);
      if (url.pathname === "/pending") {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted++;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }
      const result = fixtureResponse(url);
      return {
        ...result,
        body: (async function* () {
          if (method !== "HEAD") yield Buffer.from(result.body);
        })(),
        close() {},
      };
    },
  };
  return { transfer, network, receipts: () => ({ requests: requests.slice(), aborted }) };
}

function fixtureResponse(url: URL) {
  switch (url.pathname) {
    case "/fixture":
      return { status: 200, headers: { "content-type": "text/html" }, body: fixtureHtml };
    case "/redirect":
      return { status: 302, headers: { location: fixtureUrl }, body: "" };
    case "/denied-redirect":
      return { status: 302, headers: { location: `${deniedOrigin}/redirected` }, body: "" };
    case "/local-redirect":
      return { status: 302, headers: { location: "file:///vera-local-file" }, body: "" };
    case "/attachment":
      return {
        status: 200,
        headers: { "content-disposition": "attachment; filename=fixture.txt" },
        body: "discarded file",
      };
    case "/asset":
      return {
        status: 200,
        headers: { "access-control-allow-origin": fixtureOrigin },
        body: "allowed asset",
      };
    case "/frame":
      return { status: 200, headers: { "content-type": "text/html" }, body: "<title>Allowed frame</title>" };
    default:
      return { status: 404, headers: {}, body: "" };
  }
}

export function browserFixtureApi(
  runtime: BrowserRuntime,
  host: BrowserHost,
  access: BrowserAccessPolicy,
  fixture: ReturnType<typeof createBrowserFixture>,
  workbenchId: () => string,
  optIn: () => Promise<void>,
) {
  const owner = (sessionId: string): BrowserOwner => ({ workbenchId: workbenchId(), sessionId });
  return {
    install: () => runtime.provision(),
    status: () => runtime.inspect(),
    close: (sessionId: string) => host.closeSession(owner(sessionId)),
    allowed: (sessionId: string) => access.origins(owner(sessionId)),
    acquire: async (sessionId: string) => {
      try {
        await host.open(owner(sessionId));
        return "opened";
      } catch (error) {
        if (error instanceof BrowserError) return error.code;
        throw error;
      }
    },
    receipts: fixture.receipts,
    async probe(sessionId: string, localUrl: string, loopbackUrl: string) {
      const sessionOwner = owner(sessionId);
      for (const origin of [fixtureOrigin, resourceOrigin, "https://internal.vera-browser.example.com"]) {
        access.grant(sessionOwner, origin);
      }
      const session = await host.open(sessionOwner);
      const tab = await session.newTab();
      tab.setDefaultTimeout(5000);
      tab.setDefaultNavigationTimeout(5000);
      await tab.goto(`${fixtureOrigin}/redirect`);
      const finalUrl = tab.url();
      const pageText = await tab.locator("main").innerText();
      tab.on("dialog", (dialog) => void dialog.dismiss());
      const resources = await tab.evaluate(
        async ({ other, assets, docs, loopback }) => {
          const browser = globalThis as unknown as {
            document: {
              createElement(name: "iframe"): { src: string };
              body: { append(frame: { src: string }): void };
            };
            navigator: {
              serviceWorker?: { register(url: string): Promise<unknown> };
              permissions: { query(input: { name: "geolocation" }): Promise<{ state: string }> };
            };
          };
          const { document, navigator } = browser;
          const read = (url: string) =>
            fetch(url)
              .then(async (response) => ({
                status: response.status,
                text: await response.text(),
              }))
              .catch(() => null);
          const frame = document.createElement("iframe");
          frame.src = `${docs}/frame`;
          document.body.append(frame);
          const deniedFrame = document.createElement("iframe");
          deniedFrame.src = `${other}/denied-frame`;
          document.body.append(deniedFrame);
          const serviceWorker = await navigator.serviceWorker?.register("/worker.js").then(
            (registration) => (registration ? "registered" : "blocked"),
            () => "blocked",
          );
          const webSocket = await new Promise<string>((resolve) => {
            const socket = new WebSocket(`wss://${new URL(docs).hostname}/socket`);
            socket.onopen = () => resolve("connected");
            socket.onerror = () => resolve("blocked");
            setTimeout(() => {
              socket.close();
              resolve("blocked");
            }, 2000);
          });
          const webTransport = await (async () => {
            const Transport = (
              globalThis as unknown as {
                WebTransport?: new (url: string) => { ready: Promise<void>; close(): void };
              }
            ).WebTransport;
            if (!Transport) return "blocked";
            try {
              const transport = new Transport(`${docs}/transport`);
              const timeout = new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 2000));
              return await Promise.race([
                transport.ready.then(
                  () => "connected",
                  () => "blocked",
                ),
                timeout,
              ]).finally(() => transport.close());
            } catch {
              return "blocked";
            }
          })();
          return {
            authorized: await read(`${assets}/asset`),
            xhr: await read(`${other}/background`),
            privateAddress: await read(loopback),
            privateDns: await read("https://internal.vera-browser.example.com/fixture"),
            serviceWorker,
            webSocket,
            webTransport,
            geolocation: (await navigator.permissions.query({ name: "geolocation" })).state,
            picker: "showOpenFilePicker" in globalThis,
          };
        },
        { other: deniedOrigin, assets: resourceOrigin, docs: fixtureOrigin, loopback: loopbackUrl },
      );
      const frameTitle = await tab.frameLocator("iframe").first().locator("title").textContent();
      const popupEvent = tab.waitForEvent("popup");
      await tab.evaluate((url) => {
        (globalThis as unknown as { open(value: string): void }).open(url);
      }, `${fixtureOrigin}/frame`);
      const popup = await popupEvent;
      await popup.waitForLoadState("domcontentloaded");
      const popupTitle = await popup.title();
      await popup.close();
      const policyResponses = await tab.evaluate(async () => {
        async function status(path: string) {
          return (await fetch(path)).status;
        }
        return {
          deniedRedirect: await status("/denied-redirect"),
          fileRedirect: await status("/local-redirect"),
          attachment: await status("/attachment"),
        };
      });
      const localTab = await session.newTab();
      const localFile = await localTab.goto(localUrl, { timeout: 5000 }).then(
        () => "readable",
        (error: unknown) =>
          error instanceof Error && error.message.includes("ERR_BLOCKED_BY_ADMINISTRATOR")
            ? "blocked"
            : "unexpected error",
      );
      await localTab.close();
      const loopbackTab = await session.newTab();
      const loopbackNavigation = await loopbackTab.goto(loopbackUrl, { timeout: 5000 }).then(
        (response) => (response?.status() === 403 ? "blocked" : "unexpected response"),
        (error: unknown) =>
          error instanceof Error && error.message.includes("net::ERR_") ? "blocked" : "unexpected error",
      );
      await loopbackTab.close();
      await tab.evaluate(() => {
        void fetch("/pending").catch(() => {});
      });
      return {
        finalUrl,
        pageText,
        resources,
        frameTitle,
        popupTitle,
        ...policyResponses,
        localFile,
        loopbackNavigation,
      };
    },
    async open(sessionId: string, seed?: string) {
      await optIn();
      access.grant(owner(sessionId), fixtureOrigin);
      const session = await host.open(owner(sessionId));
      const initialTabs = session.tabs().length;
      const tab = await session.newTab();
      if (seed !== undefined) {
        await tab
          .context()
          .addCookies([{ name: "fixture", value: seed, url: fixtureUrl, secure: true, sameSite: "Strict" }]);
      }
      await tab.goto(fixtureUrl, { timeout: 10_000 });
      const stored = await tab.evaluate((value) => {
        const { document } = globalThis as unknown as {
          document: { cookie: string; visibilityState: string };
        };
        if (value !== undefined) localStorage.setItem("fixture", value);
        return {
          cookies: document.cookie,
          storage: localStorage.getItem("fixture"),
          visibility: document.visibilityState,
        };
      }, seed);
      const state = { ...stored, text: await tab.locator("main").innerText({ timeout: 5000 }) };
      const cdp = await tab.context().browser()?.newBrowserCDPSession();
      if (!cdp) throw new Error("Fixture requires an owned Chromium browser");
      try {
        const { product } = await cdp.send("Browser.getVersion");
        const sandbox = process.platform === "linux" ? await readLinuxSandbox(tab) : undefined;
        const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
        const pid = processInfo.find((item) => item.type === "browser")?.id;
        if (!pid) throw new Error("Fixture could not identify the Chromium process");
        const childPids = processInfo.filter((item) => item.type !== "browser").map((item) => item.id);
        return { initialTabs, state, product, pid, childPids, sandbox };
      } finally {
        await cdp.detach();
      }
    },
  };
}

async function readLinuxSandbox(tab: import("playwright-core").Page): Promise<string> {
  await tab.goto("chrome://sandbox", { timeout: 5000 });
  return tab.locator("body").innerText({ timeout: 5000 });
}

export type BrowserFixtureApi = ReturnType<typeof browserFixtureApi>;
