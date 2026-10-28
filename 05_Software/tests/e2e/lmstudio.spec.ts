import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";

test("LM Studio discovers models, persists per-model settings and sends optional parameters through native IPC", async () => {
  test.setTimeout(120000);
  const live = process.env.VERA_LMSTUDIO_URL;
  const payloads: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/api/v1/models")
      return void response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          models: [
            {
              type: "llm",
              key: "qwen/test",
              display_name: "Qwen test",
              max_context_length: 262144,
              loaded_instances: [{ config: { context_length: 65536 } }],
              capabilities: {
                trained_for_tool_use: true,
                reasoning: { allowed_options: ["off", "on", "low", "xhigh"], default: "xhigh" },
              },
            },
            {
              type: "llm",
              key: "small",
              display_name: "Small model",
              max_context_length: 32768,
              loaded_instances: [],
              capabilities: {},
            },
            {
              type: "embedding",
              key: "embedding",
              display_name: "Embedding",
              max_context_length: 512,
              loaded_instances: [],
            },
          ],
        }),
      );
    if (request.url === "/v1/models")
      return void response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: [{ id: "qwen/test" }, { id: "small" }] }));
    let raw = "";
    request.on("data", (part) => {
      raw += part;
    });
    request.on("end", () => {
      const body = JSON.parse(raw);
      payloads.push(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: unknown, finish: unknown = null) =>
        response.write(
          `data: ${JSON.stringify({ id: "test", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
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
      response.end("data: [DONE]\n\n");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing address");
  const data = await mkdtemp(join(tmpdir(), "vera-lmstudio-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const launch = () =>
    _electron.launch({
      executablePath: join(
        process.cwd(),
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      chromiumSandbox: true,
      args: ["src/apps/desktop", `--user-data-dir=${data}`],
      env,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    await page.locator('[data-action="add-provider"]').click();
    await page.locator("[data-provider-preset]").selectOption("lmstudio");
    await page.locator("[data-discovery-endpoint]").fill(live ?? `http://127.0.0.1:${address.port}`);
    await page.locator('[data-action="discover-models"]').click();
    await expect(page.locator("[data-discovered-model]")).toBeVisible();
    const configuredContext = Number(
      await page.getByLabel("Context window (tokens)", { exact: true }).inputValue(),
    );
    const selected = await page.locator("[data-discovered-model]").inputValue();
    expect(selected).toBeTruthy();
    const number = await page.locator("[data-discovered-model] option").count();
    expect(number).toBeGreaterThan(0);
    if (!live) {
      expect(number).toBe(2);
      await expect(page.locator("[data-model-loaded]")).toContainText("65536");
    }
    await page.locator("[data-model-reasoning]").selectOption("off");
    await page.locator("[data-model-temperature]").fill("0");
    await page.locator('[data-provider-action="save-lmstudio"]').click();
    const row = page.locator('[data-provider="custom:lm-studio"]');
    await expect(row).toBeVisible();
    const list = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("providers.models", { id: "custom:lm-studio" }),
    );
    expect(list.models).toHaveLength(number);
    expect(list.models.find((m) => m.id === selected)?.contextWindow).toBe(configuredContext);
    if (!live) {
      await row.locator("[data-provider-test]").click();
      await expect(row.locator('[data-test-status="pass"]')).toHaveCount(4);
      expect(payloads.length).toBeGreaterThan(0);
      for (const body of payloads) expect(body).toMatchObject({ reasoning_effort: "none", temperature: 0 });
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    await page
      .locator('[data-provider="custom:lm-studio"]')
      .getByRole("button", { name: "Edit LM Studio", exact: true })
      .click();
    await expect(page.locator("[data-discovered-model]")).toHaveValue(selected);
    await expect(page.locator("[data-model-reasoning]")).toHaveValue("off");
    await expect(page.locator("[data-model-temperature]")).toHaveValue("0");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(data, { recursive: true, force: true });
  }
});
