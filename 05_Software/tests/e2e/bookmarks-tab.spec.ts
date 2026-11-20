// REQ-UX-effec625 REQ-UX-53130782 REQ-REL-2b8d452f
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

const users = (page: Page) => page.locator('[data-message-kind="user"]');
const rows = (page: Page) => page.locator("[data-bookmark-row]");

test("opt-in Bookmarks tab jumps to messages and stays in sync with message buttons", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Bookmark list");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator('[data-action="new-session"]').click();
  const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
  await page.locator('[data-toggle="right"]').click();
  // Off by default: the seven earlier tabs only.
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(7);
  await expect(page.locator("#tab-bookmarks")).toHaveCount(0);

  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("seed 60 messages");
  await input.press("Enter");
  await expect(users(page)).toHaveCount(61, { timeout: 60_000 });
  for (const index of [1, 50]) {
    const message = users(page).nth(index);
    await message.scrollIntoViewIfNeeded();
    await message.hover();
    await message.locator("[data-bookmark]").click();
    await expect(message.locator("[data-bookmark]")).toHaveAttribute("aria-pressed", "true");
  }

  const editor = page.locator(".workbench-editor");
  const edit = async () => {
    await page
      .locator("[data-workbench-entry]")
      .filter({ hasText: "Bookmark list" })
      .locator(".workbench-group-name")
      .click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await editor.locator('[data-project-section="interface"]').click();
  };
  await edit();
  await expect(editor.locator('[data-panel-tab-toggle="bookmarks"]')).not.toBeChecked();
  await editor.locator('[data-panel-tab-toggle="bookmarks"]').check();
  await editor.locator("[data-project-save]").click();
  await page.locator(`[data-session="${sessionId}"]`).click();
  const ids = await page.locator('.panel-tabs [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.id));
  expect(ids.indexOf("tab-bookmarks")).toBe(ids.indexOf("tab-plan") + 1);
  await page.locator("#tab-bookmarks").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Seeded question 1.");

  // Jump from the end of the conversation to the first bookmark; the tab keeps focus and stays open.
  await page.locator("[data-transcript]").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(users(page).nth(1)).toHaveAttribute("data-nav-highlight", "");
  await expect(users(page).nth(1)).toBeInViewport();
  await expect(page.locator("#tab-bookmarks")).toHaveAttribute("aria-selected", "true");
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toBeFocused();

  // One state: removing in the tab clears the message button, bookmarking a message adds a row.
  await page.locator(`[data-bookmark-remove]`).nth(1).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(users(page).nth(50).locator("[data-bookmark]")).toHaveAttribute("aria-pressed", "false");
  const third = users(page).nth(10);
  await third.scrollIntoViewIfNeeded();
  await third.hover();
  await third.locator("[data-bookmark]").click();
  await expect(rows(page)).toHaveCount(2);

  // Hiding the tab keeps the bookmarks.
  await edit();
  await editor.locator('[data-panel-tab-toggle="bookmarks"]').uncheck();
  await editor.locator("[data-project-save]").click();
  await page.locator(`[data-session="${sessionId}"]`).click();
  await expect(page.locator("#tab-bookmarks")).toHaveCount(0);
  await expect(users(page).nth(1).locator("[data-bookmark]")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});
