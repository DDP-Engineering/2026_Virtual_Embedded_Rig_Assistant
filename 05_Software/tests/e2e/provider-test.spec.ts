import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("provider Test displays per-step native results and test-build replay is registered", async () => {
  const data = await mkdtemp(join(tmpdir(), "vera-wp09-"));
  const scripts = join(data, "scripts");
  await mkdir(scripts);
  await writeFile(
    join(scripts, "echo.jsonl"),
    `${JSON.stringify({ text: "OK ".repeat(40), toolCalls: [{ name: "echo", args: { text: "OK" } }] })}\n`,
  );
  let holdModels = false;
  let rejectModels = false;
  let releaseModels: (() => void) | undefined;
  const server = createServer((req, res) => {
    if (req.url?.endsWith("/models")) {
      const respond = () =>
        res
          .writeHead(rejectModels ? 401 : 200, { "content-type": "application/json" })
          .end(JSON.stringify({ data: [{ id: "scripted" }] }));
      if (holdModels) releaseModels = respond;
      else respond();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: unknown, finish: unknown = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "scripted", object: "chat.completion.chunk", created: 0, model: "scripted", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      if (body.tools) {
        send({
          tool_calls: [
            {
              index: 0,
              id: "echo",
              type: "function",
              function: { name: "echo", arguments: '{"text":"OK"}' },
            },
          ],
        });
        send({}, "tool_calls");
      } else {
        send({ content: "O" });
        send({ content: "K" });
        send({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("address");
  const env: NodeJS.ProcessEnv = { ...process.env, VERA_REPLAY_DIR: scripts };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: join(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: ["src/apps/desktop", `--user-data-dir=${data}`],
    chromiumSandbox: true,
    env: env as Record<string, string>,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    const replay = await page.evaluate(async () => {
      const bridge = (window as unknown as { vera: VeraBridge }).vera;
      await bridge.invoke("app.settings.update", { language: "en" });
      return bridge.invoke("providers.test", { id: "replay", model: "echo" });
    });
    expect(replay.steps.map((s) => s.status)).toEqual(["pass", "pass", "pass", "pass"]);
    await page.evaluate(async (baseUrl) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("providers.save", {
        provider: "custom",
        config: { name: "Scripted", baseUrl, model: "scripted", contextWindow: 8192, maxOutputTokens: 2048 },
      });
    }, `http://127.0.0.1:${addr.port}/v1`);
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    const provider = page.locator('[data-provider="custom:scripted"]');
    const button = provider.locator('[data-i18n="providers.test"]');
    await expect(button).toBeVisible();
    const bounds = await provider.boundingBox();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(provider.locator('[data-test-status="pass"]')).toHaveCount(4);
    await expect(provider.locator('[data-i18n="providers.testComplete"]')).toBeVisible();
    const dialog = provider.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await provider.boundingBox()).toEqual(bounds);
    await dialog.locator("[data-provider-test-close]").click();
    await expect(dialog).not.toBeVisible();
    await expect(button).toBeFocused();
    expect(await provider.boundingBox()).toEqual(bounds);
    await button.click();
    await expect(dialog.locator('[data-test-status="pass"]')).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    holdModels = true;
    await button.click();
    await expect(dialog.locator('[data-i18n="providers.testing"]')).toBeVisible();
    const pendingBounds = await dialog.boundingBox();
    expect(await provider.boundingBox()).toEqual(bounds);
    await expect.poll(() => !!releaseModels).toBe(true);
    await dialog.locator("[data-provider-test-close]").click();
    await expect(dialog).not.toBeVisible();
    holdModels = false;
    releaseModels?.();
    await expect(button).toBeEnabled();
    await expect(dialog).not.toBeVisible();
    rejectModels = true;
    await button.click();
    await expect(dialog.locator('[data-test-status="fail"]')).toHaveCount(1);
    expect(await dialog.boundingBox()).toEqual(pendingBounds);
    expect(await provider.boundingBox()).toEqual(bounds);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    const metadata = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("providers.list", {}),
    );
    expect(metadata.custom[0]?.supportsTools).toBe(true);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(data, { recursive: true, force: true });
  }
});
