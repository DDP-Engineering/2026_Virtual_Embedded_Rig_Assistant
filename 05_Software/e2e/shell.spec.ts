import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
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
