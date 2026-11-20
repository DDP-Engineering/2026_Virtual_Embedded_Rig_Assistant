import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { BrowserError } from "./failure.js";
import type { BrowserHost } from "./host.js";
import type { BrowserNetworkPolicy, BrowserOwner } from "./policy.js";
import { browserRelease } from "./release.js";
import type { BrowserRuntime } from "./runtime.js";

const fixtureUrl = "https://vera-browser.test/fixture";
const fixtureHtml = `<!doctype html>
<title>VERA browser fixture</title>
<main>Waiting for script</main>
<script>document.querySelector("main").textContent = "Rendered by JavaScript";</script>`;

/** The instrumented app supplies official archive bytes locally and intercepts all fixture requests. */
export function createBrowserFixture(archive: string) {
  const transfer: typeof fetch = async (input, options) => {
    if (input !== browserRelease()?.url) throw new BrowserError("download");
    const stream = createReadStream(archive, { signal: options?.signal ?? undefined });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>);
  };
  const policy: BrowserNetworkPolicy = {
    async acquire() {
      return {
        proxyServer: "http://127.0.0.1:1",
        async attach(context) {
          await context.route("**/*", (route) =>
            route.request().url() === fixtureUrl
              ? route.fulfill({ contentType: "text/html", body: fixtureHtml })
              : route.abort(),
          );
        },
        close() {},
      };
    },
  };
  return { transfer, policy };
}

export function browserFixtureApi(runtime: BrowserRuntime, host: BrowserHost, workbenchId: () => string) {
  const owner = (sessionId: string): BrowserOwner => ({ workbenchId: workbenchId(), sessionId });
  return {
    install: () => runtime.provision(),
    status: () => runtime.inspect(),
    close: (sessionId: string) => host.closeSession(owner(sessionId)),
    async open(sessionId: string, seed?: string) {
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
