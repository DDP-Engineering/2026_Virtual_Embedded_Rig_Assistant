import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop");
const executable = join(
  desktop,
  "../../node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

async function launch(userData: string, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  expect(existsSync(join(desktop, "out/main/index.js")), "built desktop entrypoint").toBe(true);
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${userData}`],
    env: { ...environment, VERA_TEST: "1", ...extraEnv },
  });
  try {
    await installNetworkGuard(app);
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}

test("built shell enforces the desktop security boundary", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-shell-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData, { ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" });
    const errors: string[] = [];
    app.on("window", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page).toHaveTitle("VERA");
    await expect(page.getByRole("heading", { name: "VERA" })).toBeVisible();
    await expect(page.locator('[data-i18n="home.version"]')).toBeVisible({ timeout: 5000 });
    const metadata = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.info", {}),
    );
    const nativeMetadata = await app.evaluate(({ app }) => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      locale: app.getLocale(),
      portable: false,
    }));
    expect(metadata).toEqual(nativeMetadata);
    for (const [field, value] of Object.entries(metadata)) {
      if (field !== "portable")
        await expect(page.locator(`[data-info="${field}"]`)).toHaveText(String(value));
    }
    const labels = JSON.parse(readFileSync(join(desktop, "src/renderer/locales/en.json"), "utf8")).home;
    await expect(page.locator('[data-info="portable"]')).toHaveText(
      metadata.portable ? labels.yes : labels.no,
    );
    expect(
      await page.evaluate(() => Object.keys((window as unknown as { vera: VeraBridge }).vera).sort()),
    ).toEqual(["invoke", "subscribe"]);
    const rejected = await page.evaluate(async () => {
      try {
        await (window as unknown as { vera: VeraBridge }).vera.invoke("app.info", { extra: true } as never);
      } catch (error) {
        return error;
      }
      return null;
    });
    expect(rejected).toEqual({ code: "INVALID", messageKey: "errors.INVALID" });
    expect(
      await page.evaluate(() => (window as unknown as { vera: VeraBridge }).vera.invoke("app.info", {})),
    ).toEqual(metadata);
    await page.screenshot({ path: test.info().outputPath("shell.png") });
    const info = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("Missing window");
      // Electron exposes this native inspection helper without public typings.
      const contents = window.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
      return { minimum: window.getMinimumSize(), preferences: contents.getLastWebPreferences() };
    });
    expect(info.minimum).toEqual([1024, 640]);
    expect(info.preferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    expect(await page.evaluate(() => [typeof require, typeof process, typeof module])).toEqual([
      "undefined",
      "undefined",
      "undefined",
    ]);

    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https:|http:|ws:/);
    const response = await page.reload();
    const responsePolicy = await response?.headerValue("Content-Security-Policy");
    expect(responsePolicy).toBe(policy);
    expect(
      await app.evaluate(async ({ net }) => {
        const urls = [
          "vera://foreign/index.html",
          "vera://app/%2e%2e%2fpackage.json",
          "vera://app/%5c..%5cpackage.json",
        ];
        return Promise.all(urls.map(async (url) => (await net.fetch(url)).status));
      }),
    ).toEqual([403, 403, 403]);
    const inline = await page.evaluate(async () => {
      const violations: string[] = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        violations.push(event.violatedDirective),
      );
      const script = document.createElement("script");
      script.textContent = "document.documentElement.dataset.inlineExecuted = 'yes'";
      document.body.append(script);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { executed: document.documentElement.dataset.inlineExecuted, violations };
    });
    expect(inline.executed).toBeUndefined();
    expect(inline.violations.length).toBeGreaterThan(0);
    expect(inline.violations.every((directive) => directive === "script-src-elem")).toBe(true);

    const original = page.url();
    await page.evaluate(() => location.assign("https://example.com"));
    await expect
      .poll(() =>
        app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL()),
      )
      .toBe(original);
    expect(await page.evaluate(() => location.href)).toBe(original);
    // A cancelled native navigation emits no commit event; resync Playwright's locator waiter.
    await page.reload();
    expect(await page.evaluate(() => window.open("https://example.com"))).toBeNull();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(await page.evaluate(() => Notification.requestPermission())).toBe("denied");
    expect(
      await page.evaluate(async () => (await navigator.permissions.query({ name: "notifications" })).state),
    ).toBe("denied");

    const second = spawn(executable, [desktop, `--user-data-dir=${userData}`], {
      env: environment,
      stdio: "ignore",
    });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        second.once("error", reject);
        second.once("exit", resolve);
        const timer = setTimeout(() => reject(new Error("Second instance did not exit")), 10_000);
        second.once("exit", () => clearTimeout(timer));
      });
      expect(code).toBe(0);
    } finally {
      if (second.exitCode === null) second.kill();
    }
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(page.getByRole("heading", { name: "VERA" })).toBeVisible();
    expect(await outboundAttempts(app)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("foundation preferences and panel dimensions survive native restarts", async () => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "vera-ui-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    let page = await app.firstWindow();
    await page.locator('[data-i18n="nav.settings"]').click({ timeout: 2000 });
    expect(page.url()).toBe("vera://app/index.html");
    for (const theme of ["light", "dark", "system"] as const) {
      await page.locator(`[data-theme-option="${theme}"]`).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme === "system" ? /light|dark/ : theme,
      );
      await expect.poll(() => app?.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(theme);
      await expect(page.locator('[data-i18n="settings.saving"]')).toHaveCount(0);
      await app.close();
      app = await launch(userData);
      page = await app.firstWindow();
      await page.locator('[data-i18n="nav.settings"]').click();
      await expect(page.locator(`[data-theme-option="${theme}"]`)).toHaveAttribute("aria-pressed", "true");
      expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(theme);
    }
    for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
      await page.locator(`[data-scale="${scale}"]`).click();
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
        .toBe(`${14 * scale}px`);
      await expect(page.locator('[data-i18n="settings.saving"]')).toHaveCount(0);
      await app.close();
      app = await launch(userData);
      page = await app.firstWindow();
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
        .toBe(`${14 * scale}px`);
      await page.locator('[data-i18n="nav.settings"]').click();
      await expect(page.locator(`[data-scale="${scale}"]`)).toHaveAttribute("aria-pressed", "true");
    }
    await page.locator('[data-scale="1"]').click();
    const sidebar = page.locator('[data-panel="sidebar"]');
    const before = await sidebar.boundingBox();
    const separator = await page.locator('[data-resize="sidebar"]').boundingBox();
    if (!separator || !before) throw new Error("Missing sidebar");
    await page.mouse.move(separator.x + separator.width / 2, separator.y + separator.height / 2);
    await page.mouse.down();
    await page.mouse.move(separator.x + 60, separator.y + separator.height / 2);
    await page.mouse.up();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeGreaterThan(before.width + 30);
    const resizedWidth = (await sidebar.boundingBox())?.width;
    await page.locator('[data-toggle="right"]').click();
    const rightSeparator = page.locator('[data-resize="right"]');
    await rightSeparator.focus();
    await page.keyboard.press("ArrowLeft");
    const rightBounds = await rightSeparator.boundingBox();
    if (!rightBounds) throw new Error("Missing right separator");
    await page.mouse.move(rightBounds.x + rightBounds.width / 2, rightBounds.y + 80);
    await page.mouse.down();
    await page.mouse.move(rightBounds.x - 35, rightBounds.y + 80);
    await page.mouse.up();
    const resizedRightWidth = (await page.locator('[data-panel="right"]').boundingBox())?.width;
    const geometry = await page.evaluate(() => localStorage.getItem("vera.ui.layout"));
    await page.locator('[data-toggle="sidebar"]').click();
    const collapsed = await page.evaluate(() => localStorage.getItem("vera.ui.layout"));
    await app.close();
    app = await launch(userData);
    page = await app.firstWindow();
    await expect(page.locator('[data-panel="sidebar"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("vera.ui.layout"))).toBe(collapsed);
    await page.locator('[data-toggle="sidebar"]').click();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("vera.ui.layout") ?? "{}")),
    ).toMatchObject(JSON.parse(geometry ?? "{}"));
    await expect
      .poll(async () => (await page.locator('[data-panel="sidebar"]').boundingBox())?.width ?? 0)
      .toBe(resizedWidth);
    await expect(page.locator('[data-panel="right"]')).toBeVisible();
    expect((await page.locator('[data-panel="right"]').boundingBox())?.width).toBe(resizedRightWidth);
    await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", {
        theme: "dark",
        language: "de",
      }),
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator('[data-i18n="nav.settings"]')).toHaveText("Einstellungen");
    await app.close();
    app = await launch(userData);
    page = await app.firstWindow();
    await expect(page.locator('[data-i18n="nav.settings"]')).toHaveText("Einstellungen");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const noOp = await page.evaluate(async () => {
      const bridge = (window as unknown as { vera: VeraBridge }).vera;
      let count = 0;
      const stop = bridge.subscribe("app", () => count++);
      const before = await bridge.invoke("app.settings.get", {});
      const after = await bridge.invoke("app.settings.update", { theme: "dark" });
      await bridge.invoke("app.info", {});
      stop();
      return { count, same: JSON.stringify(before) === JSON.stringify(after) };
    });
    expect(noOp).toEqual({ count: 0, same: true });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("network guard rejects native and Chromium non-loopback connections", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-egress-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    await expect(await app.firstWindow()).toHaveTitle("VERA");
    expect(
      await app.evaluate(() => {
        try {
          process.getBuiltinModule("node:net").connect({ host: "example.com", port: 443 });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    expect(
      await app.evaluate(async ({ net }) => {
        try {
          await net.fetch("https://example.com/");
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    expect(await outboundAttempts(app)).toEqual(["node://example.com:443", "https://example.com/"]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("bridge subscriptions clean up and main denies a foreign real renderer", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-bridge-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    const page = await app.firstWindow();
    await expect(page.locator('[data-info="version"]')).toBeVisible();
    await page.evaluate(() => {
      const bridge = (window as unknown as { vera: VeraBridge }).vera;
      const probe = { events: [] as string[], stop: () => {} };
      probe.stop = bridge.subscribe("app", (event) => probe.events.push(event.type));
      (window as unknown as { probe: typeof probe }).probe = probe;
    });
    const entry = join(desktop, "out/main/index.js");
    const emit = () =>
      app?.evaluate(async (_electron, path) => {
        const { emitAppEvent } = process.getBuiltinModule("node:module").createRequire(path)(path);
        return emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } });
      }, entry);
    expect(await emit()).toBe(true);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { probe: { events: string[] } }).probe.events))
      .toEqual(["settings.changed"]);
    await page.evaluate(() => {
      const probe = (window as unknown as { probe: { stop: () => void } }).probe;
      probe.stop();
      probe.stop();
    });
    await emit();
    // Drain a second invoke round trip after the event send, then observe no additional callback.
    await page.evaluate(() => (window as unknown as { vera: VeraBridge }).vera.invoke("app.info", {}));
    expect(
      await page.evaluate(() => (window as unknown as { probe: { events: string[] } }).probe.events),
    ).toEqual(["settings.changed"]);
    const foreign = await app.evaluate(
      async ({ BrowserWindow }, preload) => {
        const extra = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await extra.loadURL("vera://app/index.html");
          return await extra.webContents.executeJavaScript(
            `window.vera.invoke("app.info", {}).then(() => null, error => error)`,
          );
        } finally {
          extra.destroy();
        }
      },
      join(desktop, "out/preload/index.cjs"),
    );
    expect(foreign).toEqual({ code: "DENIED", messageKey: "errors.DENIED" });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("validated settings update survives an application restart", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-settings-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    const page = await app.firstWindow();
    await expect(page.locator('[data-info="version"]')).toBeVisible();
    const first = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(first.readOnly).toBe(false);
    await page.evaluate(() => {
      const probe = { count: 0 };
      (window as unknown as { settingsProbe: typeof probe }).settingsProbe = probe;
      (window as unknown as { vera: VeraBridge }).vera.subscribe("app", () => {
        probe.count++;
      });
    });
    const updated = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", { theme: "dark" }),
    );
    expect(updated.settings.theme).toBe("dark");
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { settingsProbe: { count: number } }).settingsProbe.count),
      )
      .toBe(1);
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch(userData);
    const restarted = await app.firstWindow();
    await expect(restarted.locator('[data-info="version"]')).toBeVisible();
    const stored = await restarted.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(stored).toEqual(updated);
    expect(stored.settings.installationId).toBe(first.settings.installationId);
    expect(JSON.parse(readFileSync(join(userData, "settings.json"), "utf8"))).toEqual(updated.settings);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("newer settings stay read-only and byte-identical through native IPC and shutdown", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-newer-settings-"));
  let app: ElectronApplication | undefined;
  const raw = '{ "schemaVersion": 99, "future": "preserve exactly" }';
  try {
    await import("node:fs/promises").then(({ writeFile }) => writeFile(join(userData, "settings.json"), raw));
    app = await launch(userData);
    const page = await app.firstWindow();
    await expect(page.locator('[data-info="version"]')).toBeVisible();
    const snapshot = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(snapshot).toMatchObject({ readOnly: true, settings: { schemaVersion: 1, theme: "system" } });
    await page.locator('[data-i18n="nav.settings"]').click();
    await expect(page.locator('[data-i18n="settings.readOnly"]')).toBeVisible();
    for (const control of await page.locator("[data-theme-option], [data-scale], #language").all())
      await expect(control).toBeDisabled();
    await page.locator('[data-toggle="sidebar"]').click();
    expect(await page.evaluate(() => localStorage.getItem("vera.ui.layout"))).toBeNull();
    expect(
      await page.evaluate(() =>
        (window as unknown as { vera: VeraBridge }).vera
          .invoke("app.settings.update", { theme: "dark" })
          .then(
            () => null,
            (error) => error,
          ),
      ),
    ).toEqual({ code: "DENIED", messageKey: "errors.DENIED" });
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = undefined;
    expect(readFileSync(join(userData, "settings.json"), "utf8")).toBe(raw);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("window geometry survives a process restart", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-bounds-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    await (await app.firstWindow()).waitForLoadState();
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("Missing window");
      const display = screen.getPrimaryDisplay().workArea;
      window.setBounds({ x: display.x + 20, y: display.y + 20, width: 1080, height: 680 });
      return window.getNormalBounds();
    });
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch(userData);
    await (await app.firstWindow()).waitForLoadState();
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getNormalBounds()),
    ).toEqual(bounds);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("development React and HMR load with sandbox and bounded CSP", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-dev-"));
  const server = spawn(process.execPath, ["scripts/dev-test-server.mjs"], {
    cwd: join(desktop, "../.."),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let app: ElectronApplication | undefined;
  let output = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Dev server startup timed out: ${output}`)), 20_000);
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("VERA_DEV_READY")) {
          clearTimeout(timer);
          resolve();
        }
      };
      server.stdout.on("data", read);
      server.stderr.on("data", read);
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Dev server exit ${code}: ${output}`));
      });
    });
    app = await launch(userData, { ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForURL("http://127.0.0.1:5173/");
    await expect(page.getByRole("heading", { name: "VERA" })).toBeVisible();
    expect(await page.evaluate(() => [typeof require, typeof process, typeof module])).toEqual([
      "undefined",
      "undefined",
      "undefined",
    ]);
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("'sha256-");
    expect(policy).toContain("ws://127.0.0.1:5173");
    expect(
      await page.evaluate(async () => {
        const script = document.createElement("script");
        script.textContent = "document.documentElement.dataset.inlineExecuted = 'yes'";
        document.body.append(script);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return document.documentElement.dataset.inlineExecuted;
      }),
    ).toBeUndefined();
    await page.reload();
    await expect(page.getByRole("heading", { name: "VERA" })).toBeVisible();
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector("h1") ?? document.body).fontSize),
    ).toBe("24px");
    expect(errors).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", () => resolve());
    });
    await rm(userData, { recursive: true, force: true });
  }
});
