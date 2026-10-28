import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";
import { changeSetting } from "./settings-navigation.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const scratch = join(tmpdir(), "vera-wp21-TASK-5423a330");
const secrets = ["fictional-native-access-WP21", "fictional-native-refresh-WP21"];
async function launch(data: string, authMode = "1") {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries({ ...process.env, VERA_TEST_CHATGPT: authMode }).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: join(
      desktop,
      "../../../node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${data}`],
    env,
  });
  await installNetworkGuard(app);
  await app.firstWindow();
  await app.evaluate(({ ipcMain, webContents }) => {
    const handlers = ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> };
    const handler = handlers._invokeHandlers.get("vera:invoke");
    if (!handler) throw Error("IPC handler missing");
    const responses: unknown[] = [],
      events: unknown[] = [];
    Object.assign(globalThis, { wp21Responses: responses, wp21Events: events });
    ipcMain.removeHandler("vera:invoke");
    ipcMain.handle("vera:invoke", async (...args: unknown[]) => {
      const value = await handler(...args);
      responses.push(value);
      return value;
    });
    for (const contents of webContents.getAllWebContents()) {
      const send = contents.send.bind(contents);
      contents.send = (name, ...args) => {
        if (name === "vera:event") events.push(args[0]);
        send(name, ...args);
      };
    }
  });
  return app;
}
async function audit(app: ElectronApplication) {
  const page = await app.firstWindow();
  const visible = await page.evaluate(() => document.documentElement.outerHTML);
  const publicData = await app.evaluate(() =>
    JSON.stringify([Reflect.get(globalThis, "wp21Responses"), Reflect.get(globalThis, "wp21Events")]),
  );
  for (const secret of secrets) {
    expect(visible).not.toContain(secret);
    expect(publicData).not.toContain(secret);
  }
  expect(await outboundAttempts(app)).toEqual([]);
}
test("native pinned OAuth starts the actual callback flow and cancels without browser or model traffic", async () => {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "startup-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(join(root, "data"), "startup");
    const page = await app.firstWindow();
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    const card = page.locator('[data-provider="chatgpt"]');
    const secure = (
      await page.evaluate(() => (window as unknown as { vera: VeraBridge }).vera.invoke("providers.list", {}))
    ).secureStorage;
    await card.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    if (!secure) await page.getByRole("button", { name: "Use only for this run", exact: true }).click();
    await expect(card.getByLabel("Paste the final redirect URL if sign-in does not complete")).toBeVisible();
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(card.getByRole("status")).toHaveText("Not signed in");
    expect(
      await page.evaluate(() =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("providers.chatgpt.status", {}),
      ),
    ).toMatchObject({ connected: false, state: "idle" });
    await audit(app);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
    await rmdir(scratch).catch(() => {});
  }
});

test("native subscription fake login persists across restart and signs out through real IPC/store", async () => {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "native-"));
  const data = join(root, "data");
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data);
    let page = await app.firstWindow();
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    const card = page.locator('[data-provider="chatgpt"]');
    const secure = (
      await page.evaluate(() => (window as unknown as { vera: VeraBridge }).vera.invoke("providers.list", {}))
    ).secureStorage;
    await card.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    if (!secure)
      await page.getByRole("button", { name: "Store without secure encryption", exact: true }).click();
    await expect(card.getByLabel("Paste the final redirect URL if sign-in does not complete")).toBeVisible();
    await card
      .getByLabel("Paste the final redirect URL if sign-in does not complete")
      .fill("http://127.0.0.1:1455/auth/callback?code=scripted");
    await card.getByRole("button", { name: "Complete sign-in", exact: true }).click();
    await expect(card.getByRole("status")).toHaveText("Signed in with ChatGPT");
    await expect(card).toContainText("Token expires at");
    const catalog = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("providers.models", { id: "chatgpt" }),
    );
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.every((m) => m.reference.startsWith("chatgpt/"))).toBe(true);
    const before = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(before.settings.defaultModel).toMatch(/^chatgpt\//);
    await audit(app);
    await app.close();
    app = undefined;
    const bytes = await readFile(join(data, "credentials.json"), "utf8");
    for (const secret of secrets) expect(bytes).not.toContain(secret);
    app = await launch(data);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    await expect(page.locator('[data-provider="chatgpt"]').getByRole("status")).toHaveText(
      "Signed in with ChatGPT",
    );
    await page
      .locator('[data-provider="chatgpt"]')
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(page.locator('[data-provider="chatgpt"]').getByRole("status")).toHaveText("Not signed in");
    expect(
      (
        await page.evaluate(() =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
        )
      ).settings.defaultModel,
    ).toBeNull();
    await audit(app);
    await app.close();
    app = undefined;
    expect(
      JSON.parse(await readFile(join(data, "credentials.json"), "utf8")).entries.chatgpt,
    ).toBeUndefined();
    for (const file of await readdir(join(data, "logs")).catch(() => [])) {
      const log = await readFile(join(data, "logs", file), "utf8");
      for (const secret of secrets) expect(log).not.toContain(secret);
    }
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
    await rmdir(scratch).catch(() => {});
  }
});
test("browser subscription controls support manual/cancel/signout and en/ro/de at minimum size", async ({
  page,
  context,
}) => {
  const server = spawn(process.execPath, ["scripts/dev-renderer.mjs"], {
    env: { ...process.env, VITE_API: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const errors: string[] = [],
    outbound: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") await route.continue();
    else {
      outbound.push(url.href);
      await route.abort();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(output)), 20000);
      const data = (b: Buffer) => {
        output += b.toString();
        if (output.includes("VERA_RENDERER_READY")) {
          clearTimeout(timer);
          resolve();
        }
      };
      server.stdout.on("data", data);
      server.stderr.on("data", data);
      server.once("error", reject);
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error(`exit${code}: ${output}`));
      });
    });
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto("http://127.0.0.1:5173");
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    const card = page.locator('[data-provider="chatgpt"]');
    for (const [lang, title, signIn, signOut, submit, cancel] of [
      ["en", "ChatGPT subscription", "Sign in with ChatGPT", "Sign out", "Complete sign-in", "Cancel"],
      [
        "ro",
        "Abonament ChatGPT",
        "Autentificare cu ChatGPT",
        "Deconectare",
        "Finalizează autentificarea",
        "Anulează",
      ],
      ["de", "ChatGPT-Abonnement", "Mit ChatGPT anmelden", "Abmelden", "Anmeldung abschließen", "Abbrechen"],
    ] as const) {
      await changeSetting(page, "language", () => page.locator("#language").selectOption(lang ?? "en"));
      await expect(card.getByRole("heading")).toHaveText(title ?? "");
      await card.getByRole("button", { name: signIn, exact: true }).click();
      await card.getByRole("button", { name: cancel, exact: true }).click();
      await expect(card.locator("input")).toHaveCount(0);
      await card.getByRole("button", { name: signIn, exact: true }).click();
      await card.locator("input").fill("http://127.0.0.1:1455/auth/callback?code=mock");
      await card.getByRole("button", { name: submit, exact: true }).click();
      await expect(card.getByRole("button", { name: signOut, exact: true })).toBeVisible();
      await card.getByRole("button", { name: signOut, exact: true }).click();
      await expect(card.getByRole("button", { name: signOut, exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
  } finally {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", () => resolve());
    });
  }
});
