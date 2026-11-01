import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";
import { changeSetting } from "./settings-navigation.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
test("native compact chrome retains window controls and a persistent navigation rail", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-compact-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () =>
    _electron.launch({
      executablePath: join(
        desktop,
        "../../../node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      chromiumSandbox: true,
      args: [desktop, `--user-data-dir=${userData}`],
      env,
    });
  let app = await launch();
  try {
    await installNetworkGuard(app);
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 30, y: 30, width: 1712, height: 920 }),
    );
    await expect(page.locator(".topbar")).toHaveCount(1);
    expect((await page.locator(".topbar").boundingBox())?.height).toBe(40);
    expect(
      await app.evaluate(({ BrowserWindow, Menu }) => ({
        menu: BrowserWindow.getAllWindows()[0]?.isMenuBarVisible(),
        applicationMenu: Menu.getApplicationMenu(),
      })),
    ).toEqual({ menu: false, applicationMenu: null });
    await expect(page.locator(".metadata")).toHaveCount(0);
    await page.keyboard.press("F10");
    await expect(page.locator('[data-window-menu="file"]')).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-window-menu="edit"]')).toBeFocused();
    if (process.env.VERA_UI_CAPTURE_DIR) {
      await mkdir(process.env.VERA_UI_CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.VERA_UI_CAPTURE_DIR, "expanded.png") });
    }
    await page.locator('[data-toggle="sidebar"]').click();
    await expect(page.locator("#sidebar")).toHaveAttribute("data-collapsed", "true");
    expect((await page.locator("#sidebar").boundingBox())?.width).toBeLessThan(65);
    if (process.env.VERA_UI_CAPTURE_DIR)
      await page.screenshot({ path: join(process.env.VERA_UI_CAPTURE_DIR, "rail.png") });
    await page.locator('[data-i18n="nav.settings"]').click();
    await expect(page.locator('[data-settings-section="about"] .metadata')).toHaveCount(1);
    await expect(page.locator("#sidebar")).toHaveAttribute("data-collapsed", "false");
    await page.locator('[data-toggle="sidebar"]').click();
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    await expect(page.locator("#sidebar")).toHaveAttribute("data-collapsed", "true");
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="language"]').click();
    await expect(page.locator("#language")).toBeVisible();
    // Settings replaces the primary navigation with its Back action.
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await expect(page.locator("[data-workbench-create]")).toBeVisible();
    await page.locator('[data-toggle="sidebar"]').click();
    await page.locator('[data-action="show-projects"]').click();
    await expect(page.locator("#sidebar")).toHaveAttribute("data-collapsed", "false");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize());
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized()))
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.unmaximize());
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized()))
      .toBe(false);
    expect(await outboundAttempts(app)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("compact navigation fits all languages, themes and text scales at minimum size", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const server = spawn(process.execPath, ["scripts/dev-renderer.mjs"], {
    env: { ...process.env, VITE_API: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outbound: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      outbound.push(route.request().url());
      await route.abort();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error(`Renderer startup timeout: ${output}`)), 20000);
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("VERA_RENDERER_READY")) {
          clearTimeout(timer);
          resolve();
        }
      };
      server.stdout.on("data", read);
      server.stderr.on("data", read);
      server.once("error", reject);
    });
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto("http://127.0.0.1:5173");
    for (const language of ["en", "ro", "de"]) {
      for (const theme of ["light", "dark"]) {
        for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
          await page.locator('[data-i18n="nav.settings"]').click();
          await changeSetting(page, "language", () => page.locator("#language").selectOption(language));
          await changeSetting(page, "appearance", () =>
            page.locator(`[data-theme-option="${theme}"]`).click(),
          );
          await changeSetting(page, "appearance", () =>
            page.locator("#interface-font-size").selectOption(String(scale)),
          );
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect
            .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
            .toBe(`${14 * scale}px`);
          await page.locator('[data-action="leave-settings"]').click();
          await page.locator('[data-i18n="nav.welcome"]').click();
          await expect(page.locator(".metadata")).toHaveCount(0);
          await page.locator('[data-toggle="sidebar"]').click();
          await expect(page.locator("#sidebar")).toHaveAttribute("data-collapsed", "true");
          for (const selector of [
            '[data-i18n="nav.welcome"]',
            '[data-action="show-projects"]',
            '[data-i18n="nav.settings"]',
          ]) {
            const button = page.locator(selector);
            await expect(button).toBeVisible();
            const box = await button.boundingBox();
            expect(box).not.toBeNull();
            expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
            expect(box?.width).toBeGreaterThanOrEqual(30);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
            true,
          );
          await page.locator('[data-action="show-projects"]').focus();
          await page.keyboard.press("Enter");
          await expect(page.locator("#sidebar")).toHaveAttribute("data-collapsed", "false");
        }
      }
    }
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
  } finally {
    server.kill();
    if (server.exitCode === null) await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  }
});
