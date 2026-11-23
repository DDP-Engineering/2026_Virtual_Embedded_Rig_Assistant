import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("provider Test displays native progress and results inline", async () => {
  const data = await mkdtemp(join(tmpdir(), "vera-wp09-"));
  const scripts = join(data, "scripts");
  await mkdir(scripts);
  await writeFile(
    join(scripts, "echo.jsonl"),
    `${JSON.stringify({ text: "OK ".repeat(40), toolCalls: [{ name: "echo", args: { text: "OK" } }] })}\n`,
  );
  let holdModels = false;
  let rejectModels = false;
  let holdReply = false;
  let releaseModels: (() => void) | undefined;
  let releaseReply: (() => void) | undefined;
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
      const respond = () => {
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
      };
      if (holdReply) {
        holdReply = false;
        releaseReply = respond;
      } else respond();
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
    args: [
      process.env.VERA_BUILD_ROOT ? join(process.env.VERA_BUILD_ROOT, "main/index.js") : "src/apps/desktop",
      `--user-data-dir=${data}`,
    ],
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
    // The card settles once its model list has loaded the provider's catalog.
    await expect(provider.locator('[data-provider-model="scripted"]')).toBeChecked();
    const status = provider.locator(".provider-test-status");
    holdModels = true;
    holdReply = true;
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("Checking Reachability…");
    await expect(button).toBeDisabled();
    await expect.poll(() => !!releaseModels).toBe(true);
    holdModels = false;
    releaseModels?.();
    await expect.poll(() => !!releaseReply).toBe(true);
    await expect(status).toHaveText("Reachability: Pass · Checking Authentication and model…");
    releaseReply?.();
    await expect(status).toHaveText("Test passed");
    await expect(button).toBeEnabled();
    const details = provider.getByText("Test details", { exact: true });
    await details.click();
    await expect(provider.locator('[data-test-status="pass"]')).toHaveCount(4);
    await expect(provider.locator('[data-test-status="pass"]').first()).toBeVisible();
    rejectModels = true;
    await button.click();
    await expect(status).toHaveText("Test found a problem");
    await details.click();
    await expect(provider.locator('[data-test-status="fail"]')).toHaveCount(1);
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
