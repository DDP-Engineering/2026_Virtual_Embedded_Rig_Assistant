import { expect, test } from "./fixtures.js";

test("workbench tab drafts, saved navigation and all-hidden recovery", { tag: "@parallel-browser" }, async ({
  page,
  rendererUrl,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Tab preferences");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  const first = page.locator("[data-workbench-entry]").filter({ hasText: "Tab preferences" });
  const other = page.locator("[data-workbench-entry]").filter({ hasText: "VERA-DEMO-01" });
  const editor = page.locator(".workbench-editor");
  const edit = async () => {
    await first.locator(".workbench-group-name").click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await editor.locator('[data-project-section="interface"]').click();
  };
  const ids = () => page.locator('.panel-tabs [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.id));
  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
  await edit();
  await editor.getByRole("checkbox", { name: "Terminal", exact: true }).uncheck();
  await expect(page.locator("#tab-terminal")).toBeVisible();
  await editor.locator("[data-project-cancel]").click();
  await edit();
  await expect(editor.getByRole("checkbox", { name: "Terminal", exact: true })).toBeChecked();
  for (const id of ["context", "changes", "artifacts", "runs", "terminal"])
    await editor.locator(`[data-panel-tab-toggle="${id}"]`).uncheck();
  await editor.locator("[data-project-save]").click();
  await expect(page.locator('[data-panel="right"]')).toHaveAttribute("data-tab", "docs");
  expect(await ids()).toEqual(["tab-docs", "tab-plan"]);
  await page.locator("#tab-docs").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-plan")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-docs")).toBeFocused();
  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator("#tab-terminal")).toHaveCount(0);
  await expect(page.locator('[role="status"]').filter({ hasText: "This tab is hidden" })).toBeVisible();
  await page.locator("[data-configure-panel-tabs]").click();
  await expect(editor.locator('[data-project-section="interface"]')).toHaveAttribute("aria-current", "page");
  await editor.locator("[data-project-cancel]").click();
  await other.locator(".workbench-group-name").click();
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(7);
  await expect(page.locator("#tab-context")).toHaveAttribute("aria-selected", "true");
  await first.locator(".workbench-group-name").click();
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(2);
  await expect(page.locator("#tab-docs")).toHaveAttribute("aria-selected", "true");
  await edit();
  await editor.locator('[data-panel-tab-toggle="docs"]').uncheck();
  await editor.locator('[data-panel-tab-toggle="plan"]').uncheck();
  await editor.locator("[data-project-save]").click();
  await expect(page.locator('[data-panel="right"]')).toHaveCount(0);
  await expect(page.locator('[data-toggle="right"]')).toHaveCount(0);
  await page.keyboard.press("Control+Shift+B");
  await expect(page.locator('[data-panel="right"]')).toHaveCount(0);
  await page.locator("[data-configure-panel-tabs]").click();
  await editor.locator("[data-restore-panel-tabs]").click();
  await expect(editor.getByRole("checkbox", { name: "Terminal", exact: true })).toBeChecked();
  await editor.locator("[data-project-cancel]").click();
  await expect(page.locator('[data-toggle="right"]')).toHaveCount(0);
  await page.locator("[data-configure-panel-tabs]").click();
  await expect(editor.getByRole("checkbox", { name: "Terminal", exact: true })).not.toBeChecked();
  await editor.locator("[data-restore-panel-tabs]").click();
  await editor.locator("[data-project-save]").click();
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveCount(7);
  await expect(page.locator(".panel-close")).toBeVisible();
  expect(errors).toEqual([]);
});
