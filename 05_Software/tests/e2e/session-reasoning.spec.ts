// REQ-UX-09ed27ff REQ-FUNC-6014ce37 REQ-FUNC-68b75ba4
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer as createViteServer } from "vite";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native reasoning persists per session and sends selected or provider-default native effort", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-session-reasoning-"));
  const folder = join(root, "board");
  await mkdir(folder);
  const payloads: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    payloads.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: `fixture-${payloads.length}`, choices: [{ index: 0, delta: { content: `Fixture reply ${payloads.length}` }, finish_reason: "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture port");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERA_REPLAY_DIR;
  let app: ElectronApplication | undefined;
  const running = () => {
    if (!app) throw Error("Application closed");
    return app;
  };
  const boot = async () => {
    app = await _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
      env,
    });
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: VeraBridge }).vera);
    return page;
  };
  try {
    let page = await boot();
    const reference = await page.evaluate(
      async ({ folder, port }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        await api.invoke("workbench.create", { folder, name: "Reasoning workbench" });
        await api.invoke("providers.save", {
          provider: "custom",
          config: {
            name: "Reasoning fixture",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            model: "org/reasoner",
            // This fixture exercises reasoning transport with the complete current tool catalog.
            // Context-limit refusal has separate coverage; do not make this a small-context model.
            contextWindow: 131072,
            maxOutputTokens: 1024,
            protocol: "lmstudio",
            models: [
              {
                id: "org/reasoner",
                name: "Reasoning model",
                contextWindow: 131072,
                maxOutputTokens: 1024,
                reasoningOptions: ["off", "low", "high"],
                reasoning: "low",
              },
              {
                id: "org/plain",
                name: "Plain model",
                contextWindow: 131072,
                maxOutputTokens: 1024,
                reasoningOptions: [],
              },
            ],
          },
        });
        const provider = (await api.invoke("providers.list", {})).custom.find(
          (p) => p.name === "Reasoning fixture",
        );
        if (!provider) throw Error("Missing provider");
        const reference = `${provider.id}/org/reasoner`;
        await api.invoke("app.settings.update", { defaultModel: reference });
        return reference;
      },
      { folder, port: address.port },
    );
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    let picker = page.locator("[data-reasoning-picker]");
    await expect(picker).toBeVisible();
    expect(
      await picker.locator("option").evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value)),
    ).toEqual(["", "off", "low", "high"]);
    await picker.selectOption("high");
    await expect(picker).toHaveValue("high");
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Explain the fixture");
    await input.press("Enter");
    await expect(page.locator("[data-transcript]")).toContainText("Fixture reply 1");
    expect(payloads[0]).toMatchObject({ reasoning_effort: "high" });
    await picker.selectOption("");
    await expect(picker).toHaveValue("");
    await input.fill("Use the provider default");
    await input.press("Enter");
    await expect(page.locator("[data-transcript]")).toContainText("Fixture reply 2");
    expect(payloads[1]).toMatchObject({ reasoning_effort: "low" });
    await picker.selectOption("high");
    await expect(picker).toHaveValue("high");
    expect(await outboundAttempts(running())).toEqual([]);
    await running().close();
    app = undefined;
    page = await boot();
    await page.evaluate(
      async (folder) => (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.open", { folder }),
      folder,
    );
    await page.locator(`[data-session="${id}"]`).click();
    picker = page.locator("[data-reasoning-picker]");
    await expect(picker).toHaveValue("high");
    for (const width of [1280, 1024]) {
      await running().evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]?.setSize(width, 890),
        width,
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      const bounds = await picker.boundingBox();
      expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(width);
      if (process.env.VERA_REASONING_SCREENSHOT)
        await page.screenshot({
          path: process.env.VERA_REASONING_SCREENSHOT.replace(".png", `-${width}.png`),
        });
    }
    await page.locator('[data-action="new-session"]').click();
    await expect(picker).toHaveValue("");
    await page.locator(`[data-session="${id}"]`).click();
    await expect(picker).toHaveValue("high");
    await page.locator("[data-model-picker]").selectOption(reference.replace("org/reasoner", "org/plain"));
    await expect(picker).toHaveCount(0);
    expect(
      await page.evaluate(
        async (sessionId) =>
          (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId }))
            .snapshot.reasoning,
        id,
      ),
    ).toBeNull();
    expect(await outboundAttempts(running())).toEqual([]);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
});

test("browser reasoning controls remain usable at 760px", async ({ page }) => {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("Renderer configuration missing");
  const server = await createViteServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("Missing renderer port");
    await page.setViewportSize({ width: 760, height: 850 });
    await page.goto(`http://127.0.0.1:${address.port}/?mock=chat`);
    await page.evaluate(async () => {
      const path = "/api/index.ts";
      const { api } = await import(path);
      await api.invoke("workbench.create", { folder: "/mock/reasoning-layout", name: "Reasoning workbench" });
      await api.invoke("providers.save", {
        provider: "custom",
        config: {
          name: "Reasoning fixture",
          baseUrl: "http://127.0.0.1:9/v1",
          model: "org/reasoner",
          contextWindow: 16384,
          maxOutputTokens: 1024,
          protocol: "lmstudio",
          models: [
            {
              id: "org/reasoner",
              name: "Reasoning model",
              contextWindow: 16384,
              maxOutputTokens: 1024,
              reasoningOptions: ["low", "high"],
            },
          ],
        },
      });
      const provider = (await api.invoke("providers.list", {})).custom.find(
        (p: { name: string }) => p.name === "Reasoning fixture",
      );
      if (!provider) throw Error("Missing provider");
      await api.invoke("app.settings.update", { defaultModel: `${provider.id}/org/reasoner` });
    });
    await page.locator('[data-action="new-session"]').click();
    const picker = page.locator("[data-reasoning-picker]");
    await expect(picker).toBeVisible();
    await picker.selectOption("high");
    await expect(picker).toHaveValue("high");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const selector of [
      "[data-model-picker]",
      "[data-reasoning-picker]",
      '[data-action="send-message"]',
    ]) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(760);
    }
    if (process.env.VERA_REASONING_SCREENSHOT)
      await page.screenshot({ path: process.env.VERA_REASONING_SCREENSHOT.replace(".png", "-760.png") });
  } finally {
    await server.close();
  }
});
