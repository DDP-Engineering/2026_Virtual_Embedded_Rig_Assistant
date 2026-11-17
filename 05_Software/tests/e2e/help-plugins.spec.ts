// REQ-UX-0d64586a, REQ-FUNC-559bba00, REQ-UX-2eb10026
import { expect } from "@playwright/test";
import { test } from "./fixtures.js";

test("plugin rows open their help, Help lists them, and links between app pages work", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${rendererUrl}/`);
  // Installing esptool from the catalog installs serial-monitor, which it requires.
  await page.locator('[data-action="plugins-nav"]').click();
  await page.locator('[data-library-status="all"]').click();
  await page.locator('[data-catalog-plugin="esp32-esptool"] [data-action="catalog-install"]').click();
  const review = page.locator("[data-plugin-review]");
  await review.locator('[data-action="plugin-install"]').click();
  await expect(review).toContainText("esp32-esptool");
  await review.locator('[data-action="plugin-install"]').click();
  await page.locator('[data-library-status="installed"]').click();
  await page.locator('[data-plugin="serial-monitor"] [data-action="plugin-help"]').click();
  await expect(page.locator('[data-help-current="plugin/serial-monitor"] h1')).toHaveText("Serial monitor");
  await expect(page.locator('[data-help-plugins] [data-help-page="plugin/esp32-esptool"]')).toBeVisible();
  // The plugin page follows the interface language.
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  await page.locator("#language").selectOption("fr");
  await page.locator('[data-action="show-help"]').click();
  await page.locator('[data-help-page="plugin/serial-monitor"]').click();
  await expect(page.locator('[data-help-current="plugin/serial-monitor"]')).toHaveAttribute("lang", "fr");
  // A link between app pages opens the linked page in Help.
  await page.locator('[data-help-page="index"]').click();
  await page.locator('[data-help-current="index"] [data-help-link="permissions"]').first().click();
  await expect(page.locator('[data-help-current="permissions"] h1')).toBeVisible();
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  await page.locator("#language").selectOption("en");
  expect(errors).toEqual([]);
});
