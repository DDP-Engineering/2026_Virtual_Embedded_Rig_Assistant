import type { Page } from "@playwright/test";

/** Edit a setting through its page, then return to the previously selected category. */
export async function changeSetting(page: Page, section: string, edit: () => Promise<unknown>) {
  const previous = await page.locator('[role="tab"][aria-selected="true"]').getAttribute("data-section");
  await page.locator(`[data-section="${section}"]`).click();
  await edit();
  if (previous && previous !== section) await page.locator(`[data-section="${previous}"]`).click();
}
