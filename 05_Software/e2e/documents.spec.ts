// REQ-UX-28ad0002 REQ-UX-28ad0003
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1024, height: 640 } });
test("browser Docs and offline PDF/Markdown/text viewer fit all languages, themes and type scales", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const server = spawn(process.execPath, ["scripts/dev-renderer.mjs"], {
    env: { ...process.env, VITE_API: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const errors: string[] = [],
    attempts: string[] = [];
  server.stdout.on("data", (b) => {
    output += b.toString();
  });
  server.stderr.on("data", (b) => {
    output += b.toString();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      attempts.push(route.request().url());
      await route.abort();
    }
  });
  try {
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(Error(output)), 20000);
      const ready = () => {
        if (output.includes("VERA_RENDERER_READY")) {
          clearTimeout(timer);
          done();
        }
      };
      server.stdout.on("data", ready);
      server.stderr.on("data", ready);
      server.once("error", fail);
    });
    for (const lang of ["en", "ro", "de"]) {
      await page.goto("http://127.0.0.1:5173/?mock=chat");
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator("#language").selectOption(lang);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await page.locator('[data-i18n="nav.welcome"]').click();
      await page.locator('[data-action="open-recent"]').click();
      await page.locator('[data-toggle="right"]').click();
      await page.locator("#tab-docs").click();
      const docs = page.locator("#panel-docs"),
        dialog = page.locator(".document-dialog");
      await expect(docs.locator("[data-document]")).toHaveCount(8);
      await expect(docs.locator('[data-document="docs/pending.pdf"] button')).toBeDisabled();
      await docs.locator("input").fill("power");
      await expect(docs.locator(".documents-list li")).toHaveCount(1);
      await expect(docs).toContainText("docs/a.md#h=power");
      await docs.locator(".documents-list button").click();
      await expect(dialog.locator('[data-heading="power"]')).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await docs.locator("input").fill("");
      await expect(docs.locator("[data-document]")).toHaveCount(8);
      for (const theme of ["light", "dark"])
        for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
          await page.evaluate(
            async ([theme, scale]) => {
              const module = "/api/index.ts";
              const { api } = await import(/* @vite-ignore */ module);
              await api.updateSettings({ theme, textScale: scale });
            },
            [theme, scale] as const,
          );
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect
            .poll(() => page.locator("html").evaluate((el) => getComputedStyle(el).fontSize))
            .toBe(`${14 * scale}px`);
          expect(await docs.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          for (const path of ["docs/a.pdf", "docs/a.md", "board.txt"]) {
            await docs.locator(`[data-document="${path}"] button`).focus();
            await page.keyboard.press("Enter");
            await expect(dialog).toBeVisible();
            if (path.endsWith(".pdf")) {
              await expect(dialog.locator(".pdf-viewer")).toHaveAttribute("data-ready", "true");
              await page.keyboard.press("Control+f");
              await expect(dialog.locator("[data-document-search]")).toBeFocused();
            }
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.keyboard.press("Escape");
            await expect(dialog).toHaveCount(0);
            await expect(docs.locator(`[data-document="${path}"] button`)).toBeFocused();
          }
        }
      await docs.locator("button").first().click();
      await expect(docs.locator('[role="status"]')).not.toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`documents-${lang}.png`) });
      await page.locator('[data-toggle="right"]').click();
    }
    expect(errors).toEqual([]);
    expect(attempts).toEqual([]);
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill("SIGTERM");
      await stopped;
    }
  }
});
