import { expect, type Page } from "@playwright/test";

/**
 * Presses the page header Save when the open Settings page has unsaved changes and waits until the save
 * is confirmed, so leaving the page next does not meet the unsaved-changes prompt (REQ-UX-032aab57).
 */
export async function saveSettings(page: Page) {
  const save = page.locator("[data-settings-save]");
  if (!(await save.count()) || !(await save.isEnabled())) return;
  await save.click();
  // Save is disabled while saving too; only a confirmed save leaves the page clean and not busy.
  await expect
    .poll(() =>
      page
        .locator("[data-settings-header]")
        .evaluate(
          (header) =>
            header.getAttribute("aria-busy") === "false" &&
            (header.querySelector("[data-settings-save]") as HTMLButtonElement).disabled,
        ),
    )
    .toBe(true);
}

/** Edit a setting through its page, save it, then return to the previously selected category. */
export async function changeSetting(page: Page, section: string, edit: () => Promise<unknown>) {
  const previous = await page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-section");
  await page.locator(`[data-section="${section}"]`).click();
  await edit();
  await saveSettings(page);
  if (previous && previous !== section) await page.locator(`[data-section="${previous}"]`).click();
}
