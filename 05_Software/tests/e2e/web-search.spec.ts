// REQ-FUNC-39dc23b2 REQ-FUNC-a0ed7785 REQ-REL-ee363d68 REQ-UX-442043ad
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native agent searches and reads via Exa adapter, presents sources/activity and saves web tool exclusions", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-web-search-"));
  const folder = join(root, "bench"),
    scripts = join(root, "scripts");
  await mkdir(folder);
  await mkdir(scripts);
  await writeFile(
    join(scripts, "web.jsonl"),
    [
      { toolCalls: [{ name: "web_search", args: { query: "Current public documentation", limit: 2 } }] },
      { toolCalls: [{ name: "web_read", args: { url: "https://example.com/guide", maxCharacters: 2000 } }] },
      { text: "The guide describes public information. [Official guide](https://example.com/guide)." },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const requests: { name: string; args: Record<string, unknown> }[] = [];
  const server = createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(204).end();
      return;
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(raw);
      if (body.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (body.method === "initialize")
        result = {
          protocolVersion: body.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "owned-loopback-exa", version: "1" },
        };
      else if (body.method === "tools/list") result = { tools: [] };
      else {
        requests.push({ name: body.params.name, args: body.params.arguments });
        result = {
          content: [
            {
              type: "text",
              text:
                body.params.name === "web_search_exa"
                  ? "Title: Official guide\nURL: https://example.com/guide\nPublished: N/A\nAuthor: N/A\nHighlights:\nCurrent public facts from an authoritative source."
                  : "# Official guide\nURL: https://example.com/guide\n\nThe guide describes public information.",
            },
          ],
        };
      }
      const payload = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
      if (body.params?.name === "web_fetch_exa")
        response
          .writeHead(200, { "content-type": "text/event-stream" })
          .end(`event: message\ndata: ${payload}\n\n`);
      else response.writeHead(200, { "content-type": "application/json" }).end(payload);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing loopback fixture port");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
    env,
  });
  try {
    await installNetworkGuard(app);
    // Only this owned test redirects the fixed production endpoint to a loopback MCP server.
    await app.evaluate(({ shell }, base) => {
      const original = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url !== "https://mcp.exa.ai/mcp") return original(input, init);
        return original(`${base}/mcp`, init);
      };
      Reflect.set(globalThis, "veraWebOpened", []);
      shell.openExternal = async (url) => {
        (Reflect.get(globalThis, "veraWebOpened") as string[]).push(url);
      };
    }, `http://127.0.0.1:${address.port}`);
    const page = await app.firstWindow();
    const ids = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const bench = await api.invoke("workbench.create", { folder, name: "Web research" });
      const session = await api.invoke("session.create", { modelRef: "replay/web" });
      return { workbench: bench.config.id, session: session.id };
    }, folder);
    expect(requests).toHaveLength(0); // No background search or sign-in.
    await page.reload();
    await page.locator(`[data-session="${ids.session}"]`).click();
    const editor = page.getByRole("textbox", { name: "Message", exact: true });
    await editor.fill("Find current public documentation and read its source.");
    await editor.press("Enter");
    const source = page.locator('[data-web-source="https://example.com/guide"]');
    await expect(source).toBeVisible();
    expect(requests.map((r) => r.name)).toEqual(["web_search_exa", "web_fetch_exa"]);
    expect(requests[1]!.args).toEqual({ urls: ["https://example.com/guide"], maxCharacters: 2000 });
    if (process.env.VERA_WEB_SCREENSHOT)
      await page.screenshot({ path: process.env.VERA_WEB_SCREENSHOT.replace(".png", "-sources.png") });
    await source.click();
    await expect(page.locator("dialog[open]")).toContainText("Open external website?");
    if (process.env.VERA_WEB_SCREENSHOT)
      await page.screenshot({ path: process.env.VERA_WEB_SCREENSHOT.replace(".png", "-confirm.png") });
    await page.locator("[data-web-cancel]").click();
    expect(await app.evaluate(() => Reflect.get(globalThis, "veraWebOpened"))).toEqual([]);
    await expect(source).toBeFocused();
    await source.click();
    await page.locator("[data-web-open]").click();
    expect(await app.evaluate(() => Reflect.get(globalThis, "veraWebOpened"))).toEqual([
      "https://example.com/guide",
    ]);
    await page.locator('[data-action="show-activity"]').click();
    await expect(page.locator("dialog[open]")).toContainText("web_search");
    await expect(page.locator("dialog[open]")).toContainText("web_read");
    if (process.env.VERA_WEB_SCREENSHOT) await page.screenshot({ path: process.env.VERA_WEB_SCREENSHOT });
    await page.locator('[data-action="close-inspector"]').click();
    for (const [language, label] of [
      ["ro", "Deschizi un site extern?"],
      ["de", "Externe Website öffnen?"],
    ]) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="language"]').click();
      await page.locator("#language").selectOption(language!);
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator(`[data-session="${ids.session}"]`).click();
      await source.click();
      await expect(page.locator("dialog[open]")).toContainText(label!);
      await page.locator("[data-web-cancel]").click();
    }
    const saved = await page.evaluate(async () => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const { config } = await api.invoke("workbench.config.get", {});
      return api.invoke("workbench.config.update", {
        workbenchId: config.id,
        patch: { tools: { disabled: ["web_search", "web_read"] } },
      });
    });
    expect(saved.config.tools.disabled).toEqual(["web_search", "web_read"]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
