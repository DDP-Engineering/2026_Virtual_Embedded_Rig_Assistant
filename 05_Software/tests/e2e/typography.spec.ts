import { expect, test } from "@playwright/test";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";

test("Appearance keeps interface, conversation and code sizes independent and restores defaults", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const resolved = await resolveConfig({ root: "src/apps/desktop" }, "serve", "development");
  const renderer = resolved.config?.renderer;
  if (!renderer) throw Error("Missing renderer config");
  const server = await createServer({
    ...renderer,
    define: { ...renderer.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...renderer.server, port: 0, strictPort: false, hmr: false },
  });
  const errors: string[] = [],
    outbound: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      outbound.push(route.request().url());
      await route.abort();
    }
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("Missing local server address");
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    for (const id of ["interface-font-size", "chat-font-size", "code-font-size"]) {
      const labels = await page.locator(`#${id} option`).allTextContents();
      expect(labels.every((label) => label.trim().endsWith("px") && !label.includes("%"))).toBe(true);
    }
    await page.locator("#chat-font-size").selectOption("12");
    await expect(page.locator("#chat-font-size")).toBeEnabled();
    await page.locator("#code-font-size").selectOption("22");
    for (const scale of ["0.875", "1.5"]) {
      await expect(page.locator("#interface-font-size")).toBeEnabled();
      await page.locator("#interface-font-size").selectOption(String(scale));
      await expect
        .poll(() =>
          page.locator(".typography-interface-preview").evaluate((el) => getComputedStyle(el).fontSize),
        )
        .toBe(`${14 * Number(scale)}px`);
      await expect
        .poll(() => page.locator(".typography-chat-preview").evaluate((el) => getComputedStyle(el).fontSize))
        .toBe("12px");
      await expect
        .poll(() =>
          page.locator(".typography-code-preview code").evaluate((el) => getComputedStyle(el).fontSize),
        )
        .toBe("22px");
    }
    await page.locator('[data-section="language"]').click();
    await page.locator("#language").selectOption("ro");
    await page.locator('[data-section="appearance"]').click();
    await expect(page.locator("#chat-font-size")).toHaveValue("12");
    await expect(page.locator("#code-font-size")).toHaveValue("22");
    await expect(page.locator('[data-action="reset-typography"]')).toBeEnabled();
    await page.locator('[data-action="reset-typography"]').click();
    await expect(page.locator("#chat-font-size")).toHaveValue("14");
    await expect(page.locator("#code-font-size")).toHaveValue("14");
    await expect(page.locator("#interface-font-size")).toHaveValue("1");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
  } finally {
    await server.close();
  }
});
