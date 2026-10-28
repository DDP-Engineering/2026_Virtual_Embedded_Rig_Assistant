import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import { eventEnvelopeSchema, type VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const executable = join(
  desktop,
  "../../../node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const key = "fak-WP08-MIDDLE-PRIVATE-ONLY-9Zx4";
async function launch(data: string) {
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${data}`],
    env: { ...environment, VERA_TEST: "1" },
  });
  await installNetworkGuard(app);
  await app.firstWindow();
  await app.evaluate(({ ipcMain, webContents }) => {
    const internal = ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> };
    const handler = internal._invokeHandlers.get("vera:invoke");
    if (!handler) throw new Error("Missing IPC handler");
    const captured: unknown[] = [];
    Object.assign(globalThis, { veraProviderResponses: captured });
    const events: unknown[] = [];
    Object.assign(globalThis, { veraProviderEvents: events });
    for (const contents of webContents.getAllWebContents()) {
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === "vera:event") events.push(args[0]);
        send(channel, ...args);
      };
    }
    ipcMain.removeHandler("vera:invoke");
    ipcMain.handle("vera:invoke", async (...args: unknown[]) => {
      const result = await handler(...args);
      captured.push(result);
      return result;
    });
  });
  return app;
}
async function audit(app: ElectronApplication) {
  const page = await app.firstWindow();
  const visible = await page.evaluate(() => ({
    text: document.body.innerText,
    html: document.body.outerHTML,
    inputs: [...document.querySelectorAll("input")].map((i) => i.value),
  }));
  const responses = await app.evaluate(() => Reflect.get(globalThis, "veraProviderResponses"));
  const events = (await app.evaluate(() => Reflect.get(globalThis, "veraProviderEvents"))) as unknown[];
  for (const event of events) expect(eventEnvelopeSchema.safeParse(event).success).toBe(true);
  // Inspect the actual React provider's QueryClient without adding a production debug bridge.
  const caches = await page.evaluate(() => {
    const root = document.getElementById("root");
    if (!root) throw new Error("Missing React root");
    const slot = Object.keys(root).find((name) => name.startsWith("__reactContainer$"));
    if (!slot) throw new Error("Missing React container");
    type Fiber = {
      stateNode?: { current?: Fiber };
      child?: Fiber;
      sibling?: Fiber;
      memoizedProps?: {
        client?: {
          getQueryCache(): { getAll(): { queryKey: unknown; state: unknown }[] };
          getMutationCache(): { getAll(): { state: unknown }[] };
        };
      };
    };
    const container = Reflect.get(root, slot) as Fiber;
    const pending = [container.stateNode?.current ?? container];
    while (pending.length) {
      const node = pending.pop();
      if (!node) continue;
      const client = node.memoizedProps?.client;
      if (client?.getQueryCache && client.getMutationCache)
        return JSON.stringify({
          queries: client
            .getQueryCache()
            .getAll()
            .map(({ queryKey, state }) => ({ queryKey, state })),
          mutations: client
            .getMutationCache()
            .getAll()
            .map(({ state }) => state),
        });
      if (node.child) pending.push(node.child);
      if (node.sibling) pending.push(node.sibling);
    }
    throw new Error("Missing actual QueryClient provider");
  });
  for (const payload of [
    JSON.stringify(visible),
    JSON.stringify(responses),
    JSON.stringify(events),
    caches,
  ]) {
    expect(payload).not.toContain(key);
    expect(payload).not.toContain("WP08-MIDDLE-PRIVATE-ONLY");
    const withoutHints = payload.replaceAll("fak…9Zx4", "");
    expect(withoutHints).not.toContain("9Zx4");
  }
  expect(await outboundAttempts(app)).toEqual([]);
}
test("provider UI saves masked keys and exposes only bounded hints in every IPC response", async () => {
  const data = await mkdtemp(join(tmpdir(), "vera-providers-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-section="providers"]').click();
    const section = page.locator('[data-settings-section="providers"]');
    await section.locator('[data-action="add-provider"]').click();
    const input = section.getByLabel("OpenAI API key", { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await input.fill(key);
    await section
      .locator('[data-provider-editor="openai"]')
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const status = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("providers.list", {}),
    );
    if (!status.secureStorage)
      await section.getByRole("button", { name: "Use only for this run", exact: true }).click();
    await expect(input).toHaveCount(0);
    await expect(section.locator('[data-provider="openai"] [data-provider-hint]')).toHaveText("fak…9Zx4");
    await audit(app);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-section="providers"]').click();
    await expect(section.locator('[data-provider="openai"] [data-provider-hint]')).toHaveText("fak…9Zx4");
    await audit(app);
    await app.close();
    app = await launch(data);
    const restart = await app.firstWindow();
    await restart.getByRole("button", { name: "Settings", exact: true }).click();
    await restart.locator('[data-section="providers"]').click();
    if (status.secureStorage) {
      await expect(restart.locator('[data-provider="openai"] [data-provider-hint]')).toHaveText("fak…9Zx4");
      expect(existsSync(join(data, "credentials.json"))).toBe(true);
      expect(readFileSync(join(data, "credentials.json"), "utf8")).not.toContain(key);
    } else {
      await expect(restart.locator('[data-provider="openai"] [data-provider-hint]')).toHaveCount(0);
      expect(existsSync(join(data, "credentials.json"))).toBe(false);
    }
    await audit(app);
    const beforeEvents = await app.evaluate(
      () => (Reflect.get(globalThis, "veraProviderEvents") as unknown[]).length,
    );
    const shortResult = await restart.evaluate(async () => {
      const bridge = (window as unknown as { vera: VeraBridge }).vera;
      let result = await bridge.invoke("providers.save", {
        provider: "openai",
        apiKey: "type",
        model: "event-regression",
      });
      if (result.status === "consent-required")
        result = await bridge.invoke("providers.save", {
          provider: "openai",
          apiKey: "type",
          model: "event-regression",
          storageConsent: false,
        });
      return result;
    });
    expect(shortResult).toEqual({ status: "saved" });
    const running = app;
    await expect
      .poll(() => running.evaluate(() => (Reflect.get(globalThis, "veraProviderEvents") as unknown[]).length))
      .toBeGreaterThan(beforeEvents);
    await restart
      .locator('[data-provider="openai"]')
      .getByRole("button", { name: "Edit OpenAI API", exact: true })
      .click();
    await expect(restart.getByLabel("OpenAI model (optional)", { exact: true })).toHaveValue(
      "event-regression",
    );
    await expect(restart.locator('[data-provider="openai"] [data-provider-hint]')).toHaveCount(0);
    await audit(app);
  } finally {
    await app?.close();
    await rm(data, { recursive: true, force: true });
  }
});
test("custom provider add edit remove and explicit weak storage choices", async () => {
  const data = await mkdtemp(join(tmpdir(), "vera-custom-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-section="providers"]').click();
    const section = page.locator('[data-settings-section="providers"]');
    await section.getByRole("button", { name: "Add connection" }).click();
    await section.locator("[data-provider-preset]").selectOption("ollama");
    await section.getByLabel("Endpoint name", { exact: true }).fill("Local fixture");
    await section.getByLabel("Base URL", { exact: true }).fill("http://localhost:11434/v1");
    await section.getByLabel("Model", { exact: true }).fill("fake-model");
    await section
      .locator('[data-provider-editor="custom"]')
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const row = section.locator('[data-provider="custom:local-fixture"]');
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Edit Local fixture", exact: true }).click();
    await section.getByLabel("Model", { exact: true }).fill("edited-fake-model");
    await section.getByLabel("Endpoint API key", { exact: true }).fill(key);
    await section
      .locator('[data-provider-editor="custom"]')
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const list = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("providers.list", {}),
    );
    if (!list.secureStorage)
      await section.getByRole("button", { name: "Store without secure encryption", exact: true }).click();
    await expect(section.locator('[data-provider-editor="custom"]')).toHaveCount(0);
    await expect(row).toContainText("edited-fake-model");
    await audit(app);
    await row.getByRole("button", { name: "Remove Local fixture", exact: true }).click();
    await expect(row).toHaveCount(0);
    await audit(app);
    await app.close();
    app = await launch(data);
    expect(
      (
        await (
          await app.firstWindow()
        ).evaluate(() => (window as unknown as { vera: VeraBridge }).vera.invoke("providers.list", {}))
      ).custom,
    ).toEqual([]);
  } finally {
    await app?.close();
    await rm(data, { recursive: true, force: true });
  }
});
