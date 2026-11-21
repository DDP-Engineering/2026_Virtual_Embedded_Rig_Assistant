// REQ-UX-a388f93c, REQ-UX-3de89feb, REQ-UX-d753f9fb, REQ-UX-5e8e2eba
import { expect, type Page, test } from "@playwright/test";
import { resolveConfig } from "electron-vite";
import { createServer, type ViteDevServer } from "vite";
import { saveSettings } from "./settings-navigation.js";

let server: ViteDevServer;
let url: string;
test.beforeAll(async () => {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("renderer config");
  server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw Error("server address");
  url = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
  await server?.close();
});

async function language(page: Page, code: string) {
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  await page.locator("#language").selectOption(code);
  await saveSettings(page);
}

test("the ? button opens Help in each interface language beside the right-panel toggle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const help = page.locator('[data-action="show-help"]');
  await expect(help).toBeVisible();
  // The button sits immediately before the right-panel toggle.
  expect(await help.evaluate((button) => button.nextElementSibling?.getAttribute("data-toggle"))).toBe(
    "right",
  );
  for (const [code, title] of [
    ["en", "Help"],
    ["ro", "Ajutor"],
    ["de", "Hilfe"],
    ["fr", "Aide"],
  ] as const) {
    await language(page, code);
    await help.click();
    await expect(page.locator(".page-title")).toHaveText(title);
    await expect(page.locator('[data-help-view] [data-help-current="index"] h1')).toBeVisible();
    await expect(page.locator('.help-pages [data-help-page="index"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await language(page, "en");
  expect(errors).toEqual([]);
});

test("F1 opens the page of the current screen and About stays in Settings", async ({ page }) => {
  await page.goto(url);
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="providers"]').click();
  await page.keyboard.press("F1");
  await expect(page.locator('[data-help-current="providers"]')).toBeVisible();
  await page.locator('[data-action="plugins-nav"]').click();
  await expect(page.locator("[data-help-view]")).toHaveCount(0);
  await page.keyboard.press("F1");
  await expect(page.locator('[data-help-current="plugins"]')).toBeVisible();
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="about"]').click();
  await page.keyboard.press("Control+F1");
  await expect(page.locator("[data-help-view]")).toHaveCount(0);
  await expect(page.locator('[data-settings-section="about"] [data-about]')).toHaveCount(1);
  await expect(page.locator('[data-settings-section="about"]')).toContainText("Version");
});

test("the page list stays in place while a long help page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto(url);
  await page.locator('[data-action="show-help"]').click();
  await page.locator('.help-pages [data-help-page="troubleshooting"]').click();
  await expect(page.locator('[data-help-current="troubleshooting"] h1')).toBeVisible();
  const list = page.locator(".help-pages");
  const before = await list.boundingBox();
  await page.locator('[data-help-current="troubleshooting"]').hover();
  await page.mouse.wheel(0, 600);
  await expect(page.locator('[data-help-current="troubleshooting"] h1')).not.toBeInViewport();
  expect(await page.locator(".help-page").evaluate((article) => article.scrollTop)).toBeGreaterThan(0);
  expect((await list.boundingBox())?.y).toBe(before?.y);
  await expect(page.locator(".page-title")).toBeInViewport();
  await expect(page.locator('.help-pages [data-help-page="index"]')).toBeInViewport();
});
