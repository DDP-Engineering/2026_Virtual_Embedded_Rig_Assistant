import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
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
      expect(labels.map((label) => label.trim())).toEqual([
        "Extra small",
        "Small",
        "Normal",
        "Large",
        "Extra large",
        "Largest",
      ]);
    }
    await page.locator("#chat-font-size").selectOption("12");
    await expect(page.locator("#chat-font-size")).toBeEnabled();
    await page.locator("#code-font-size").selectOption("24");
    for (const scale of ["0.75", "1.5"]) {
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
        .toBe("24px");
    }
    await page.locator('[data-section="language"]').click();
    await page.locator("#language").selectOption("ro");
    await page.locator('[data-section="appearance"]').click();
    for (const id of ["interface-font-size", "chat-font-size", "code-font-size"]) {
      expect((await page.locator(`#${id} option`).allTextContents()).map((label) => label.trim())).toEqual([
        "Foarte mic",
        "Mic",
        "Normal",
        "Mare",
        "Foarte mare",
        "Maxim",
      ]);
    }
    await expect(page.locator("#chat-font-size")).toHaveValue("12");
    await expect(page.locator("#code-font-size")).toHaveValue("24");
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

test("native desktop accepts every size through preload and main, and retains it after restart", async () => {
  test.setTimeout(90000);
  const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
  const userData = await mkdtemp(join(tmpdir(), "vera-typography-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
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
    let page = await app.firstWindow();
    // Catch stale native/preload schemas before testing the renderer controls.
    await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", {
        textScale: 0.75,
        chatFontSize: 10,
        codeFontSize: 10,
      }),
    );
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    for (const [scale, size] of [
      [0.75, 10],
      [0.875, 12],
      [1, 14],
      [1.125, 16],
      [1.25, 20],
      [1.5, 24],
    ]) {
      await expect(page.locator("#interface-font-size")).toBeEnabled();
      await page.locator("#interface-font-size").selectOption(String(scale));
      await expect(page.locator("#chat-font-size")).toBeEnabled();
      await page.locator("#chat-font-size").selectOption(String(size));
      await expect(page.locator("#code-font-size")).toBeEnabled();
      await page.locator("#code-font-size").selectOption(String(size));
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const result = await (window as unknown as { vera: VeraBridge }).vera.invoke(
              "app.settings.get",
              {},
            );
            return [result.settings.textScale, result.settings.chatFontSize, result.settings.codeFontSize];
          }),
        )
        .toEqual([scale, size, size]);
      await expect(page.locator("#interface-font-size")).toHaveValue(String(scale));
      await expect(page.locator("#chat-font-size")).toHaveValue(String(size));
      await expect(page.locator("#code-font-size")).toHaveValue(String(size));
    }
    await expect(page.locator("#code-font-size")).toBeEnabled();
    await page.locator("#interface-font-size").selectOption("0.75");
    await expect(page.locator("#chat-font-size")).toBeEnabled();
    await page.locator("#chat-font-size").selectOption("10");
    await expect(page.locator("#code-font-size")).toBeEnabled();
    await page.locator("#code-font-size").selectOption("10");
    await expect(page.locator("#code-font-size")).toBeEnabled();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    await expect(page.locator("#interface-font-size")).toHaveValue("0.75");
    await expect(page.locator("#chat-font-size")).toHaveValue("10");
    await expect(page.locator("#code-font-size")).toHaveValue("10");
    await page.locator('[data-action="reset-typography"]').click();
    await expect(page.locator("#interface-font-size")).toHaveValue("1");
    await expect(page.locator("#chat-font-size")).toHaveValue("14");
    await expect(page.locator("#code-font-size")).toHaveValue("14");
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
