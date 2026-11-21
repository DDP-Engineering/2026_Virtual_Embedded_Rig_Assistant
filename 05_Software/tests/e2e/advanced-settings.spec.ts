// REQ-UX-fcd1ad10 REQ-UX-9ea9184f REQ-DATA-96ef3dd6 REQ-UX-8663749f REQ-UX-91d7a481 REQ-UX-692b8471
import { expect, test } from "./fixtures.js";

const toolCalls = '[data-advanced-field="toolCallsPerTurn"] input';

test("Show advanced settings reveals the Advanced sections and a session value is stored", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Advanced bench");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator('[data-action="new-session"]').click();
  const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
  const row = page.locator(`[data-session="${sessionId}"]`).locator("..");
  const menu = row.locator("summary");

  // Off: the session menu has no Advanced item.
  await menu.click();
  await expect(page.locator('[data-action="session-advanced"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Settings > Advanced shows only the switch until it is on.
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="advanced"]').click();
  await expect(page.locator("[data-advanced-field]")).toHaveCount(0);
  await page.locator("[data-show-advanced]").click();
  await expect(page.locator("[data-show-advanced]")).toBeChecked();
  const appField = page.locator(`[data-settings-section="advanced"] ${toolCalls}`);
  await expect(appField).toHaveAttribute("placeholder", "50 (default)");
  // ADV-03 application settings show their defaults (REQ-UX-9ea9184f).
  await expect(
    page.locator('[data-settings-section="advanced"] [data-advanced-field="downloadMB"] input'),
  ).toHaveAttribute("placeholder", "100 (default)");
  await appField.fill("90");
  // Nothing is written until the page header Save (REQ-UX-032aab57).
  await page.locator("[data-settings-save]").click();
  await expect(page.locator("[data-settings-save]")).toBeDisabled();
  await page.locator('[data-action="leave-settings"]').click();

  // The session dialog inherits 90 from the application and stores its own value.
  await page.locator(`[data-session="${sessionId}"]`).click();
  await menu.click();
  await row.locator('[data-action="session-advanced"]').click();
  const sessionField = page.locator(`[data-session-advanced] ${toolCalls}`);
  await expect(sessionField).toHaveAttribute("placeholder", "90 (application)");
  await sessionField.fill("501");
  await expect(page.locator("[data-session-advanced] [role=alert]")).toHaveText(
    "Use a whole number from 10 to 500.",
  );
  await expect(page.locator('[data-action="save-session-advanced"]')).toBeDisabled();
  await sessionField.fill("300");
  // A switch inherits On from the default and is stored as Off (REQ-UX-91d7a481).
  const automatic = page.locator('[data-session-advanced] [data-advanced-field="autoCompaction"] select');
  await expect(automatic.locator("option").first()).toHaveText("Inherit: On (default)");
  await automatic.selectOption("off");
  await page.locator('[data-action="save-session-advanced"]').click();
  await expect(page.locator("[data-session-advanced]")).toHaveCount(0);
  await menu.click();
  await row.locator('[data-action="session-advanced"]').click();
  await expect(page.locator(`[data-session-advanced] ${toolCalls}`)).toHaveValue("300");
  await expect(automatic).toHaveValue("off");

  // Compact now runs at once, outside the draft, and reports the outcome (REQ-UX-692b8471).
  await page.locator('[data-action="compact-session"]').click();
  await expect(page.locator("[data-compact-status]")).toHaveText("Not enough history to summarize yet.");
  await expect(page.locator('[data-action="save-session-advanced"]')).toBeDisabled();
  expect(errors).toEqual([]);
});
