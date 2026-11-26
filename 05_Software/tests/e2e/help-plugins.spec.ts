// REQ-UX-0d64586a, REQ-FUNC-559bba00, REQ-UX-2eb10026
import { expect } from "@playwright/test";
import { test } from "./fixtures.js";
import { saveSettings } from "./settings-navigation.js";

test("plugin details open their help inline and the help index links between app pages", {
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
  await expect(review).toBeVisible();
  await expect(page.locator("[data-library-results]")).toBeAttached();
  await expect(review.locator("details.plugin-review-facts")).not.toHaveAttribute("open", "");
  await review.locator('[data-action="plugin-install"]').click();
  await expect(review).toContainText("esp32-esptool");
  await review.locator('[data-action="plugin-install"]').click();
  await page.locator('[data-library-status="installed"]').click();
  const card = page.locator('[data-plugin="serial-monitor"]');
  await card.locator('[data-action="plugin-expand"]').click();
  const help = card.locator('details[data-plugin-section="help"]');
  await expect(help.locator(".plugin-help")).toBeHidden();
  await help.locator("summary").press("Enter");
  await expect(help.locator("h1")).toHaveText("Serial monitor");
  await expect(help.locator("h1")).toBeVisible();
  await page.locator('[data-action="show-help"]').click();
  await expect(page.locator('[data-help-plugins] [data-help-page="plugin/esp32-esptool"]')).toBeVisible();
  // The plugin page follows the interface language.
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  await page.locator("#language").selectOption("fr");
  await saveSettings(page);
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
  await saveSettings(page);
  expect(errors).toEqual([]);
});
