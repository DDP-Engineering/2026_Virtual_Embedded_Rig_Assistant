import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native Web access controls anonymous/key use, revokes calls, persists and translates without exposing keys", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-web-access-"));
  const folder = join(root, "bench"),
    scripts = join(root, "scripts"),
    profile = join(root, "profile");
  await mkdir(folder);
  await mkdir(scripts);
  await writeFile(
    join(scripts, "web.jsonl"),
    [
      { toolCalls: [{ name: "web_search", args: { query: "Public fixture information", limit: 1 } }] },
      { text: "Public information verified." },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const key = "exa-owned-native-key-0123456789";
  const calls: { key: string | undefined; body: string }[] = [];
  const held = new Set<ServerResponse>();
  let hold = false,
    cancelled = 0;
  const restCalls: { provider: string; key: string | undefined }[] = [];
  const tavilyKey = "owned-tavily-native-key",
    braveKey = "owned-brave-native-key";
  const server = createServer((request, response) => {
    if (request.method === "GET" && !request.url?.startsWith("/rest/")) {
      response.writeHead(405).end();
      return;
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (request.url?.startsWith("/rest/")) {
        const provider = request.url.includes("/tavily/") ? "tavily" : "brave";
        const apiKey = (
          provider === "tavily"
            ? request.headers.authorization?.replace(/^Bearer /, "")
            : request.headers["x-subscription-token"]
        ) as string | undefined;
        restCalls.push({ provider, key: apiKey });
        if (
          (provider === "brave" && apiKey !== braveKey) ||
          (provider === "tavily" && apiKey && apiKey !== tavilyKey)
        ) {
          response.writeHead(401).end("owned authentication error");
          return;
        }
        const source = {
          title: "Public guide",
          url: "https://example.com/guide",
          content: "Public information",
          description: "Public information",
        };
        const result = provider === "tavily" ? { results: [source] } : { web: { results: [source] } };
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
        return;
      }
      if (body.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (body.method === "initialize")
        result = {
          protocolVersion: body.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "owned-web-settings", version: "1" },
        };
      else if (body.method === "tools/list") result = { tools: [] };
      else {
        calls.push({ key: request.headers["x-api-key"] as string | undefined, body: raw });
        if (hold) {
          held.add(response);
          response.once("close", () => {
            held.delete(response);
            cancelled++;
          });
          return;
        }
        if (request.headers["x-api-key"] && request.headers["x-api-key"] !== key) {
          response.writeHead(401).end(`do not echo ${request.headers["x-api-key"]}`);
          return;
        }
        result = {
          content: [
            {
              type: "text",
              text: "Title: Public guide\nURL: https://example.com/guide\nPublished: N/A\nAuthor: N/A\nHighlights:\nUseful public information.",
            },
          ],
        };
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture port");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
      env,
    });
  const guard = async (app: ElectronApplication) => {
    await installNetworkGuard(app);
    await app.evaluate((_electron, base) => {
      const original = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.tavily.com/"))
          return original(`${base}/rest/tavily/${new URL(url).pathname.slice(1)}`, init);
        if (url.startsWith("https://api.search.brave.com/"))
          return original(`${base}/rest/brave/search${new URL(url).search}`, init);
        return original(url === "https://mcp.exa.ai/mcp" ? `${base}/mcp` : input, init);
      };
    }, `http://127.0.0.1:${address.port}`);
  };
  let app = await launch();
  try {
    await guard(app);
    let page = await app.firstWindow();
    const ids = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const wb = await api.invoke("workbench.create", { folder, name: "Web settings" });
      const session = await api.invoke("session.create", { modelRef: "replay/web" });
      return { workbench: wb.config.id, session: session.id };
    }, folder);
    await page.reload();
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="web"]').click();
    await expect(page.locator('[data-settings-section="web"]')).toHaveCount(1);
    await expect(page.locator("#web-enabled")).toBeChecked();
    expect(calls).toHaveLength(0);
    await page.locator("[data-web-test]").click();
    await expect(page.locator('[data-web-test-status="pass"]')).toBeVisible();
    expect(calls.at(-1)?.key).toBeUndefined();
    await expect(page.locator("dialog[open] button")).toHaveCount(1);
    await page.locator("[data-web-close]").click();
    await expect(page.locator("[data-web-test]")).toBeFocused();
    await page.locator("#web-authentication").selectOption("api-key");
    await page.locator("#web-api-key").fill(key);
    await page.locator("[data-web-test]").click();
    await expect(page.locator('[data-web-test-status="pass"]')).toBeVisible();
    expect(calls.at(-1)?.key).toBe(key);
    const draft = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("web.access.get", {}),
    );
    expect(draft.keys.exa.keyConfigured).toBe(false);
    await page.locator("[data-web-close]").click();
    await page.locator("#web-api-key").fill("invalid-owned-key");
    await page.locator("[data-web-test]").click();
    await expect(page.locator('[data-web-test-status="fail"]')).toBeVisible();
    await expect(page.locator("dialog[open]")).not.toContainText("invalid-owned-key");
    await page.locator("[data-web-close]").click();
    await page.locator("#web-api-key").fill(key);
    await page.locator("[data-web-save]").click();
    if (!draft.secureStorage) await page.locator("dialog[open] button").nth(1).click();
    await expect(page.locator("#web-api-key")).toHaveValue("");
    const stored = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("web.access.get", {}),
    );
    expect(stored).toMatchObject({
      keys: { exa: { keyConfigured: true } },
      preferences: { authentication: "api-key" },
    });
    expect(JSON.stringify(stored)).not.toContain(key);
    await page.locator("#web-provider").selectOption("tavily");
    await page.locator("[data-web-test]").click();
    await expect(page.locator('[data-web-test-status="pass"]')).toBeVisible();
    await expect(page.locator("dialog[open]")).toContainText("Tavily");
    if (process.env.VERA_WEB_ACCESS_SCREENSHOT)
      await page.screenshot({
        path: process.env.VERA_WEB_ACCESS_SCREENSHOT.replace(".png", "-tavily-result.png"),
      });
    expect(restCalls.at(-1)).toEqual({ provider: "tavily", key: undefined });
    await page.locator("[data-web-close]").click();
    await page.locator("#web-authentication").selectOption("api-key");
    await page.locator("#web-api-key").fill(tavilyKey);
    await page.locator("#web-provider").selectOption("brave");
    await expect(page.locator("#web-api-key")).toHaveValue("");
    await expect(page.locator("#web-authentication option")).toHaveCount(1);
    await expect(page.locator("[data-web-test]")).toBeDisabled();
    await page.locator("#web-api-key").fill(braveKey);
    await page.locator("[data-web-test]").click();
    await expect.poll(() => restCalls.at(-1)).toEqual({ provider: "brave", key: braveKey });
    await expect(page.locator('[data-web-test-status="pass"]')).toBeVisible();
    await expect(page.locator("dialog[open]")).toContainText("Brave Search");
    expect(restCalls.at(-1)).toEqual({ provider: "brave", key: braveKey });
    await page.locator("[data-web-close]").click();
    if (process.env.VERA_WEB_ACCESS_SCREENSHOT)
      await page.screenshot({ path: process.env.VERA_WEB_ACCESS_SCREENSHOT.replace(".png", "-brave.png") });
    await page.locator("[data-web-save]").click();
    if (!stored.secureStorage) await page.locator("dialog[open] button").nth(1).click();
    await expect(page.locator("#web-api-key")).toHaveValue("");
    await page.locator("[data-web-test]").click();
    await expect(page.locator('[data-web-test-status="pass"]')).toBeVisible();
    expect(restCalls.at(-1)).toEqual({ provider: "brave", key: braveKey });
    await page.locator("[data-web-close]").click();
    await page.locator("#web-provider").selectOption("tavily");
    await page.locator("#web-authentication").selectOption("api-key");
    await page.locator("#web-api-key").fill(tavilyKey);
    await page.locator("[data-web-save]").click();
    if (!stored.secureStorage) await page.locator("dialog[open] button").nth(1).click();
    await expect(page.locator("#web-api-key")).toHaveValue("");
    const allKeys = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("web.access.get", {}),
    );
    expect(Object.values(allKeys.keys).every((meta) => meta.keyConfigured)).toBe(true);
    expect(JSON.stringify(allKeys)).not.toContain(tavilyKey);
    expect(JSON.stringify(allKeys)).not.toContain(braveKey);
    await page.locator("#web-provider").selectOption("exa");
    await page.locator("#web-authentication").selectOption("api-key");
    await page.locator("[data-web-save]").click();
    await expect(page.locator('.web-access [role="status"]')).toContainText("saved");

    expect(await readFile(join(profile, "settings.json"), "utf8")).not.toContain(key);
    expect(await readFile(join(profile, "credentials.json"), "utf8")).not.toContain(key);
    await page.locator("[data-web-test]").click();
    await expect(page.locator('[data-web-test-status="pass"]')).toBeVisible();
    expect(calls.at(-1)?.key).toBe(key);
    await page.locator("[data-web-close]").click();
    await page.locator("#web-authentication").selectOption("anonymous");
    await page.locator("[data-web-save]").click();
    await expect(page.locator('.web-access [role="status"]')).toContainText("saved");
    hold = true;
    let count = calls.length;
    await page.locator("[data-web-test]").click();
    await expect.poll(() => calls.length).toBe(count + 1);
    expect(calls.at(-1)?.key).toBeUndefined();
    await page.locator("[data-web-close]").click();
    await expect.poll(() => cancelled).toBe(1);
    await expect(page.locator("[data-web-test]")).toBeFocused();
    await expect(page.locator("[data-web-test]")).toBeEnabled();
    count = calls.length;
    await page.evaluate(async (sessionId) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("session.send", {
        sessionId,
        text: "Search the public web",
      });
    }, ids.session);
    await expect.poll(() => calls.length).toBe(count + 1);
    await page.locator("#web-enabled").uncheck();
    await page.locator("[data-web-save]").click();
    await expect.poll(() => cancelled).toBe(2);
    const disabled = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("web.access.get", {}),
    );
    expect(disabled.preferences.enabled).toBe(false);
    await expect(page.locator("[data-web-test]")).toBeDisabled();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              async (sessionId) =>
                (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId }),
              ids.session,
            )
          ).snapshot.status,
      )
      .toBe("idle");
    count = calls.length;
    const blockedSession = await page.evaluate(async () => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const session = await api.invoke("session.create", { modelRef: "replay/web" });
      await api.invoke("session.send", { sessionId: session.id, text: "A blocked web search" });
      return session.id;
    });
    await expect
      .poll(async () => {
        const state = await page.evaluate(
          async (sessionId) =>
            (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId }),
          blockedSession,
        );
        return state.snapshot.status === "idle" && state.snapshot.turns.length === 1;
      })
      .toBe(true);
    expect(calls.length).toBe(count);
    expect(calls.every((call) => !call.body.includes(key))).toBe(true);
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await guard(app);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="web"]').click();
    await expect(page.locator("#web-enabled")).not.toBeChecked();
    expect(
      (
        await page.evaluate(() =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("web.access.get", {}),
        )
      ).keys.exa.keyConfigured,
    ).toBe(true);
    await page.locator("[data-web-remove]").click();
    await expect(page.locator("[data-web-remove]")).toHaveCount(0);
    hold = false;
    for (const [language, title] of [
      ["en", "Web access"],
      ["ro", "Acces web"],
      ["de", "Webzugriff"],
    ]) {
      await page.locator('[data-section="language"]').click();
      await page.locator("#language").selectOption(language!);
      await page.locator('[data-section="web"]').click();
      await expect(page.locator(".web-access h2")).toHaveText(title!);
      await expect(page.locator(".web-access")).not.toContainText("webAccess.");
      await page.locator("#web-enabled").check();
      await page.locator("[data-web-save]").click();
      await expect(page.locator("[data-web-test]")).toBeEnabled();
      if (language === "ro" && process.env.VERA_WEB_ACCESS_SCREENSHOT)
        await page.screenshot({ path: process.env.VERA_WEB_ACCESS_SCREENSHOT });
      await page.locator("[data-web-test]").click();
      await expect(page.locator('[data-web-test-status="pass"]')).toBeVisible();
      const box = await page.locator("dialog[open]").boundingBox(),
        viewport = page.viewportSize();
      if (box && viewport) expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
      if (language === "ro" && process.env.VERA_WEB_ACCESS_SCREENSHOT)
        await page.screenshot({
          path: process.env.VERA_WEB_ACCESS_SCREENSHOT.replace(".png", "-result.png"),
        });
      await page.locator("[data-web-close]").click();
    }
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    for (const response of held) response.destroy();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
