import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import { changeSetting } from "./settings-navigation.js";

test("Updates controls/notes/banner are usable in en/ro/de at minimum size", async ({ page, context }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1024, height: 640 });
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
  let output = "";
  try {
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => reject(Error(output)), 20000);
      const read = (bytes: Buffer) => {
        output += bytes.toString();
        if (output.includes("VERA_RENDERER_READY")) {
          clearTimeout(timer);
          accept();
        }
      };
      server.stdout.on("data", read);
      server.stderr.on("data", read);
      server.once("error", reject);
    });
    await page.goto("http://127.0.0.1:5173/");
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="updates"]').click();
    const panel = page.locator("#section-updates");
    for (const language of ["en", "ro", "de"]) {
      await changeSetting(page, "language", () => page.locator("#language").selectOption(language));
      for (const theme of ["light", "dark"]) {
        await changeSetting(page, "appearance", () => page.locator(`[data-theme-option="${theme}"]`).click());
        for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
          await changeSetting(page, "appearance", () => page.locator(`[data-scale="${scale}"]`).click());
          await panel.locator("#update-mode").selectOption("off");
          await panel.locator("#update-channel").selectOption("beta");
          await panel.locator('[data-i18n="updates.check"]').click();
          await expect(panel).toContainText("Update release notes");
          await expect(panel).toContainText("0.0.1");
          await panel.locator("#update-mode").focus();
          await page.keyboard.press("Tab");
          await expect(panel.locator("#update-channel")).toBeFocused();
          expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        }
      }
      await page.screenshot({ path: test.info().outputPath(`updates-${language}.png`) });
    }
    await panel.locator('[data-i18n="updates.download"]').click();
    await expect(page.locator("[data-update-banner]")).toBeVisible();
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
  } finally {
    const exited = new Promise((accept) => server.once("exit", accept));
    server.kill();
    await exited;
  }
});
