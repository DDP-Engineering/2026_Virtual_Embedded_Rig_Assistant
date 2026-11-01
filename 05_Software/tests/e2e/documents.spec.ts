// REQ-UX-28ad0002 REQ-UX-28ad0003
import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";
import { changeSetting } from "./settings-navigation.js";

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
      await changeSetting(page, "language", () => page.locator("#language").selectOption(lang));
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      // Settings replaces the primary navigation; leave it to reach the workbenches.
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator("[data-workbench-entry] .workbench-group-name").click();
      await page.locator('[data-toggle="right"]').click();
      await page.locator("#tab-docs").click();
      const docs = page.locator("#panel-docs"),
        dialog = page.locator("[data-source-current]");
      // Docs shows the workbench as a folder tree (TASK-66b7d4aa); its expansion persists.
      const folder = docs.locator('[role="treeitem"][data-tree-path="docs"]');
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
      await expect(docs.locator("[data-document]")).toHaveCount(10);
      await expect(docs.locator('[data-document="docs/pending.pdf"]')).toHaveAttribute(
        "data-status",
        "pending",
      );
      // REQ-UX-d455531b: one search box; Reindex and Collapse all share a row.
      await expect(docs.locator("input")).toHaveCount(1);
      const reindexTop = (await docs.locator('[data-action="reindex"]').boundingBox())?.y;
      const collapseTop = (await docs.locator('[data-action="collapse-all"]').boundingBox())?.y;
      expect(reindexTop).toBeDefined();
      expect(Math.abs((reindexTop ?? 0) - (collapseTop ?? Number.NaN))).toBeLessThan(2);
      // REQ-UX-2504362b: document hits are listed under the filtered tree.
      await docs.locator("[data-docs-search]").fill("power");
      await expect(docs.locator("[data-docs-hits] .documents-list li")).toHaveCount(1);
      // No file is named after the query: the tree stays, empty, and says so.
      await expect(docs.locator('[role="tree"]')).toHaveCount(1);
      await expect(docs.locator('.docs-tree [role="status"]')).toBeVisible();
      await expect(docs).toContainText("docs/a.md#h=power");
      await docs.locator(".documents-list button").click();
      await expect(dialog.locator('[data-heading="power"]')).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      // REQ-UX-b3231a55: the Source tab widens to at most 60% of the window; Docs keeps its cap.
      const right = page.locator("#right-panel");
      const viewport = await page.evaluate(() => innerWidth);
      await page.locator("#tab-source").click();
      await page.locator('[data-resize="right"]').focus();
      await page.keyboard.press("End");
      const sourceWidth = (await right.boundingBox())?.width ?? 0;
      expect(sourceWidth).toBeGreaterThan(viewport * 0.45);
      expect(sourceWidth).toBeLessThanOrEqual(viewport * 0.6 + 1);
      await page.locator("#tab-docs").click();
      expect((await right.boundingBox())?.width ?? 0).toBeLessThanOrEqual(viewport * 0.45 + 1);
      await docs.locator("[data-docs-search]").fill("");
      await expect(docs.locator("[data-document]")).toHaveCount(10);
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
          if (scale === 1) {
            // REQ-UX-ed65cbbc with REQ-UX-4a040007: ignored rows stand out without losing AA contrast.
            const ignored = await docs
              .locator('.tree-row[data-ignored="true"] .tree-name')
              .evaluateAll((names) =>
                names.map((name) => {
                  const luminance = (color: string) => {
                    const values = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
                      const value = Number(part) / 255;
                      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                    });
                    return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
                  };
                  let opacity = 1;
                  let background = "rgba(0, 0, 0, 0)";
                  for (let element: Element | null = name; element; element = element.parentElement) {
                    const style = getComputedStyle(element);
                    opacity *= Number(style.opacity);
                    if (background === "rgba(0, 0, 0, 0)") background = style.backgroundColor;
                  }
                  const text = luminance(getComputedStyle(name).color);
                  const back = luminance(background);
                  return {
                    opacity,
                    italic: getComputedStyle(name).fontStyle === "italic",
                    ratio: (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05),
                  };
                }),
              );
            expect(ignored.length).toBeGreaterThan(0);
            for (const row of ignored) {
              expect(row.opacity).toBe(1);
              expect(row.italic).toBe(true);
              expect(row.ratio, `${theme} ignored row contrast`).toBeGreaterThanOrEqual(4.5);
            }
          }
          for (const path of [
            "docs/a.pdf",
            "docs/a.md",
            "board.txt",
            "docs/bringup.pptx",
            "docs/review.docx",
          ]) {
            await docs.locator(`[data-document="${path}"]`).focus();
            await page.keyboard.press("Enter");
            await expect(dialog).toBeVisible();
            if (path.endsWith(".pdf")) {
              await expect(dialog.locator(".pdf-viewer")).toHaveAttribute("data-ready", "true");
              await page.keyboard.press("Control+f");
              await expect(dialog.locator("[data-document-search]")).toBeFocused();
            }
            if (path.endsWith(".pptx")) await expect(dialog.locator("[data-slide]")).toHaveCount(2);
            expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.keyboard.press("Escape");
            await expect(dialog).toHaveCount(0);
            await expect(docs.locator(`[data-document="${path}"]`)).toBeFocused();
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
