// REQ-UX-28503c97 REQ-UX-e6056763 REQ-UX-acc04fbc REQ-UX-fd6bc95d REQ-UX-e0e51891 REQ-UX-25921e97 REQ-UX-93fd56dc
// REQ-UX-72a349a1 REQ-UX-c55a0fe1 REQ-UX-9207423e
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures.js";
import { changeSetting } from "./settings-navigation.js";

/** The Plugins page and the Runs tab in browser mock mode, in every language, theme and text size. */
/** Elements wider than their box or the window; none may overflow. */
const overflow = (page: Page) =>
  page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    elements: [...document.querySelectorAll("main, aside, section, button, select, li, dialog")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          (box.right > innerWidth + 1 || box.left < -1 || element.scrollWidth > element.clientWidth + 1)
        );
      })
      .map((element) => element.outerHTML.slice(0, 160)),
  }));

test("empty Plugins actions share a row and keep their filter behavior", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${rendererUrl}/`);
  await page.locator('[data-action="plugins-nav"]').click();
  const installed = page.locator('[data-library-status="installed"]');
  const search = page.locator("[data-library-search]");
  await installed.click();
  await search.fill("esp32");
  const empty = page.locator(".plugin-library-empty");
  const browse = empty.getByRole("button", { name: "Browse available plugins" });
  const clear = empty.locator('[data-action="library-clear"]');
  await expect(browse).toBeVisible();
  expect((await clear.boundingBox())?.y).toBe((await browse.boundingBox())?.y);
  await browse.click();
  await expect(search).toHaveValue("esp32");
  await expect(page.locator('[data-library-status="all"]')).toHaveAttribute("aria-pressed", "true");
  await installed.click();
  await clear.click();
  await expect(search).toHaveValue("");
});

test("installs through the review screen, enables the plugin and stops a run, without overflow in any language, theme or size", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  test.setTimeout(180_000);
  const url = rendererUrl + "/";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Bench");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator('[data-action="plugins-nav"]').click();
  await expect(page.locator("[data-library-tabs]")).toHaveCount(0);
  const refresh = await page.locator('[data-action="plugin-refresh"]').boundingBox();
  const updates = await page.locator('[data-action="catalog-check"]').boundingBox();
  expect(refresh).not.toBeNull();
  expect(updates).not.toBeNull();
  expect(refresh?.y).toBe(updates?.y);

  await page.locator('[data-library-status="installed"]').click();
  await page.locator('[data-action="plugin-install-folder"]').click();
  const review = page.locator("[data-plugin-review]");
  await expect(review.locator("[data-rule]")).toHaveCount(5);
  await review.locator('[data-action="plugin-install"]').click();
  const card = page.locator('[data-plugin="echo-tools"]');
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await page.locator("[data-workbench-entry] .workbench-group-name").first().click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="plugins"]').click();
  // The state buttons form one aligned column in the library's left column.
  const statusLefts = await page
    .locator("[data-workbench-plugins] [data-library-status]")
    .evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().left)));
  expect(statusLefts).toHaveLength(3);
  expect(new Set(statusLefts).size).toBe(1);

  await page.locator('[data-workbench-plugin="echo-tools"] input').check();
  await page.locator("[data-project-save]").click();
  await page.locator('[data-action="plugins-nav"]').click();
  await page.locator('[data-library-status="installed"]').click();
  await card.locator('[data-action="plugin-expand"]').focus();
  await page.keyboard.press("Enter");
  await card.locator('[data-action="plugin-check"]').click();
  await expect(card.locator('[data-action="plugin-provision"]')).toBeDisabled();
  await expect(card.locator('[data-program="echo"]')).toHaveAttribute("data-state", "ready");

  await page.setViewportSize({ width: 1024, height: 640 });
  for (const language of ["en", "ro", "de"]) {
    await page.locator('[data-i18n="nav.settings"]').click();
    await changeSetting(page, "appearance", () => page.locator("#language").selectOption(language));
    for (const theme of ["light", "dark"]) {
      await changeSetting(page, "appearance", () => page.locator(`[data-theme-option="${theme}"]`).click());
      for (const scale of [0.75, 0.875, 1, 1.125, 1.25, 1.5]) {
        if (!(await page.locator("#interface-font-size").isVisible()))
          await page.locator('[data-i18n="nav.settings"]').click();
        await changeSetting(page, "appearance", () =>
          page.locator("#interface-font-size").selectOption(String(scale)),
        );
        await page.locator('[data-action="leave-settings"]').click();
        await page.locator('[data-action="plugins-nav"]').click();
        await page.locator('[data-library-status="installed"]').click();
        await card.locator('[data-action="plugin-expand"]').focus();
        await page.keyboard.press("Enter");
        await expect(card.locator('[data-program="echo"]')).toBeVisible();
        await page.locator('[data-library-status="all"]').click();
        await expect(page.locator("[data-pack]")).toHaveCount(0);
        await expect(page.locator("[data-catalog-plugin]")).toHaveCount(4);
        expect(await overflow(page), `list ${language}/${theme}/${scale}`).toEqual({
          page: false,
          elements: [],
        });
        await page.locator('[data-action="plugin-install-folder"]').click();
        await expect(review.locator("[data-rule]")).toHaveCount(5);
        expect(await overflow(page), `review ${language}/${theme}/${scale}`).toEqual({
          page: false,
          elements: [],
        });
        await review.locator('[data-action="plugin-review-cancel"]').click();
        await page.locator('[data-catalog-plugin="esp32-esptool"] [data-action="catalog-install"]').click();
        await expect(review.locator("[data-catalog-review]")).toBeVisible();
        expect(await overflow(page), `catalog review ${language}/${theme}/${scale}`).toEqual({
          page: false,
          elements: [],
        });
        await review.locator('[data-action="plugin-review-cancel"]').click();
        if ((await page.locator('[data-panel="right"]').count()) === 0)
          await page.locator('[data-toggle="right"]').click();
        await page.locator('[data-resize="right"]').focus();
        await page.keyboard.press("Home");
        await page.locator("#tab-runs").click();
        await expect(page.locator("[data-run]").first()).toBeVisible();
        expect(await overflow(page), `runs ${language}/${theme}/${scale}`).toEqual({
          page: false,
          elements: [],
        });
        await page.locator('[data-toggle="right"]').click();
        await page.locator('[data-i18n="nav.settings"]').click();
        await page.locator('[data-action="leave-settings"]').click();
        await page.locator("[data-workbench-entry] .workbench-group-name").first().click();
        await page.locator('[data-action="edit-workbench-overview"]').click();
        await page.locator('[data-project-section="plugins"]').click();
        await expect(page.locator("[data-project-save]")).toBeDisabled();
        await expect(page.locator('[data-workbench-plugin="echo-tools"] input')).toBeChecked();
        const pluginDetails = page.locator(
          '[data-workbench-plugin="echo-tools"] [data-action="workbench-plugin-details"]',
        );
        await expect(page.locator("[data-workbench-configuration]")).toBeHidden();
        await pluginDetails.press("Enter");
        await expect(page.locator("[data-workbench-configuration]")).toBeVisible();
        expect(await overflow(page), `workbench plugins ${language}/${theme}/${scale}`).toEqual({
          page: false,
          elements: [],
        });
        await page.locator("[data-project-cancel]").click();
        await page.locator('[data-i18n="nav.settings"]').click();
      }
    }
  }
  await changeSetting(page, "appearance", () => page.locator("#language").selectOption("en"));
  await page.locator('[data-action="leave-settings"]').click();
  await page.locator('[data-toggle="right"]').click();
  await page.locator("#tab-runs").click();
  const running = page.locator('[data-run][data-state="running"]');
  await expect(running).toContainText("echo serve");
  await running.locator('[data-action="run-log"]').click();
  await expect(page.locator("[data-run-log]")).toContainText("READY");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-run-log]")).toHaveCount(0);
  const id = (await running.getAttribute("data-run")) as string;
  await running.locator('[data-action="run-stop"]').click();
  await expect(page.locator(`[data-run="${id}"]`)).toContainText("Stopped");

  // Finish the Runs task before returning to global package management.
  if (await page.locator('[data-panel="right"]').count()) await page.locator('[data-toggle="right"]').click();
  // Install selected reviews the Core group's plugins in order and installs them as official plugins.
  await page.locator('[data-action="plugins-nav"]').click();
  await page.locator('[data-library-status="installed"]').click();
  await page.locator('[data-library-status="all"]').click();
  await page.locator('[data-catalog-plugin="esp32-esptool"] [data-action="catalog-install"]').click();
  await expect(review.locator("[data-catalog-review]")).toContainText("Official");
  await review.locator('[data-action="plugin-install"]').click();
  await expect(review).toContainText("esp32-esptool");
  await review.locator('[data-action="plugin-install"]').click();
  await page.locator('[data-library-status="installed"]').click();
  await expect(page.locator('[data-plugin="serial-monitor"]')).toContainText("Official");
  await expect(page.locator('[data-plugin="esp32-esptool"]')).toContainText("Official");
  await page.locator('[data-library-status="all"]').click();
  await expect(page.locator('[data-plugin="serial-monitor"]')).toContainText("1.0.0");
  await page.locator('[data-library-status="installed"]').click();
  const serial = page.locator('[data-plugin="serial-monitor"]');
  await serial.locator('[data-action="plugin-expand"]').click();
  await serial.locator('[data-action="plugin-check"]').click();
  await serial.locator('[data-action="plugin-provision"]').click();
  await expect(serial.locator('[data-action="plugin-provision"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test("empty workbench opens the unfiltered catalog and returns to its editor", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(rendererUrl);
  await page.locator('[data-action="plugins-nav"]').click();
  const installed = page.locator('[data-library-status="installed"]');
  await installed.click();
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Plugin catalog bench");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await expect(page.locator('[data-session][aria-current="page"]')).toBeVisible();
  await page.locator('.workbench-group-name[aria-current="page"]').click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="plugins"]').click();
  const workbenchPlugins = page.locator("[data-workbench-plugins]");
  await expect(workbenchPlugins).toContainText("No plugins are installed.");
  await expect(workbenchPlugins.locator("[data-library-search], [data-tool-toggle]")).toHaveCount(0);
  await workbenchPlugins.getByRole("button", { name: "Browse available plugins" }).click();
  await expect(page.locator('[data-library-status="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-catalog-plugin]").first()).toBeVisible();
  await page.locator(".workbench-group-name", { hasText: "Plugin catalog bench" }).click();
  await expect(page.locator('[data-project-section="plugins"]')).toHaveAttribute("aria-current", "page");
  await expect(workbenchPlugins).toContainText("No plugins are installed.");
});
