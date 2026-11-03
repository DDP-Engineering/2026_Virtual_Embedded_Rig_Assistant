import { expect, test } from "@playwright/test";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";

test("workbench tree, pinning, project editor and plugin section", async ({ page }) => {
  const resolved = await resolveConfig({ root: "src/apps/desktop" }, "serve", "development");
  const renderer = resolved.config?.renderer;
  if (!renderer) throw Error("renderer");
  const server = await createServer({
    ...renderer,
    define: { ...renderer.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...renderer.server, port: 0, strictPort: false, hmr: false },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await server.listen();
    const addr = server.httpServer?.address();
    if (!addr || typeof addr === "string") throw Error("address");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://127.0.0.1:${addr.port}/?mock=chat`);
    await expect(page.locator("[data-empty-workbench]")).toBeVisible();
    await expect(page.locator('#sidebar input[type="search"]')).toHaveCount(0);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("ESP32 bench");
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    const group = page.locator("[data-workbench-entry]").filter({ hasText: "ESP32 bench" });
    const disclosure = group.locator(".workbench-sessions-toggle");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(disclosure).toHaveAttribute("title", "Hide sessions: ESP32 bench");
    expect(await disclosure.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(
      28,
    );
    await expect(disclosure.locator("svg")).toBeVisible();
    await disclosure.focus();
    await disclosure.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(disclosure).toHaveAttribute("title", "Show sessions: ESP32 bench");
    await disclosure.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");

    await expect(group).toBeVisible();
    await expect(page.locator('[data-workbench="active"] > .workbench-actions > button')).toHaveCount(1);
    await expect(page.locator("[data-workbench-overview]")).toBeVisible();
    await expect(page.locator("[data-workbench-overview]")).toContainText("/mock/new-board");
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await expect(page.locator(".workbench-editor")).toBeVisible();
    await page.locator(".workbench-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    await group.locator(".workbench-menu > summary").click();
    await group.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(group).toHaveAttribute("data-pinned", "true");
    await group.locator(".workbench-menu > summary").click();
    await group.getByRole("button", { name: "Edit workbench", exact: true }).click();
    const dialog = page.locator(".workbench-editor");
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-project-name]").fill("ESP32 revised");
    await dialog.locator('[data-project-section="tools"]').click();
    const tools = dialog.locator("[data-tool-toggle]");
    await expect(tools).toHaveCount(17);
    await expect(dialog.locator("[data-tool-description]")).toHaveCount(17);
    for (const tool of [
      "read",
      "list",
      "glob",
      "grep",
      "write",
      "edit",
      "artifact_save",
      "todo",
      "search_docs",
      "read_doc",
      "load_skill",
      "web_search",
      "web_read",
    ])
      await expect(dialog.locator(`[data-tool-toggle="${tool}"]`)).toBeChecked();
    await expect(dialog.locator('[data-tool-description="grep"]')).toContainText("Search");
    await dialog.locator('[data-tool-toggle="grep"]').uncheck();
    await dialog.locator('[data-tool-toggle="read"]').uncheck();
    await dialog.locator('[data-tool-toggle="read"]').check();
    await dialog.locator('[data-project-section="skills"]').click();
    await dialog.locator('[data-action="skills-settings"]').click();
    const skillDialog = page.locator(".skills-dialog");
    await skillDialog.locator("[data-skill-name]").fill("test-reader");
    await skillDialog.locator('[data-action="create-skill"]').click();
    await expect(skillDialog.locator(".skills-list li")).toHaveCount(1);
    await skillDialog.locator('input[type="checkbox"]').uncheck();
    await expect(skillDialog.locator('input[type="checkbox"]')).not.toBeChecked();
    const skillBounds = await skillDialog.boundingBox();
    expect(Math.abs((skillBounds?.x ?? 0) + (skillBounds?.width ?? 0) / 2 - 640)).toBeLessThan(2);
    await page.keyboard.press("Escape");
    await expect(skillDialog).not.toBeVisible();
    await expect(page.locator(".workbench-editor")).toBeVisible();

    await dialog.locator('[data-project-section="embeddings"]').click();
    await dialog.locator("[data-project-chunk]").fill("800");
    await dialog.locator("[data-project-overlap]").fill("100");
    await dialog.locator("[data-project-save]").click();
    await expect(dialog).not.toBeVisible();
    const revised = page.locator("[data-workbench-entry]").filter({ hasText: "ESP32 revised" });
    await expect(revised).toBeVisible();
    await revised.locator(".workbench-menu > summary").click();
    await revised.getByRole("button", { name: "Edit workbench", exact: true }).click();
    await dialog.locator('[data-project-section="embeddings"]').click();
    await expect(dialog.locator("[data-project-chunk]")).toHaveValue("800");
    await expect(dialog.locator("[data-project-overlap]")).toHaveValue("100");
    await dialog.locator('[data-project-section="tools"]').click();
    await expect(dialog.locator('[data-tool-toggle="grep"]')).not.toBeChecked();
    await expect(dialog.locator('[data-tool-toggle="read"]')).toBeChecked();
    await dialog.locator('[data-project-section="skills"]').click();
    await dialog.locator('[data-action="skills-settings"]').click();
    await expect(skillDialog.locator('input[type="checkbox"]')).not.toBeChecked();
    await page.keyboard.press("Escape");

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await revised.locator('[data-action="new-session"]').click();
    await expect(page.locator(".session-workspace")).toBeVisible();
    const firstSession = await revised.locator("[data-session]").first().getAttribute("data-session");
    const other = page.locator("[data-workbench-entry]").filter({ hasText: "VERA-DEMO-01" });
    await other.locator(".workbench-group-name").click();
    await other.locator('[data-action="new-session"]').click();
    const otherSession = await other.locator("[data-session]").first().getAttribute("data-session");
    expect(otherSession).not.toBe(firstSession);
    await revised.locator(".workbench-group-name").click();
    await expect(page.locator('[data-workbench="active"]')).toBeVisible();
    await expect(revised.locator(`[data-session="${firstSession}"]`)).toBeVisible();
    await expect(page.locator("[data-overview-session] time").first()).toHaveAttribute("datetime", /T/);
    const count = await page.locator("[data-overview-session]").count();
    await expect(page.locator(".workbench-session-summary h3")).toHaveText(`Sessions (${count})`);
    await page.locator(`[data-overview-session="${firstSession}"] button`).click();
    await expect(page.locator(".session-workspace")).toBeVisible();
    await revised.locator(".workbench-group-name").click();
    await expect(revised.locator(`[data-session="${otherSession}"]`)).toHaveCount(0);
    await revised.getByRole("button", { name: "Hide sessions: ESP32 revised" }).click();
    await expect(revised.locator(".session-list")).not.toBeVisible();
    await page.locator('[data-i18n="nav.settings"]').click();
    await expect(page.locator('[data-i18n="nav.welcome"]')).not.toBeVisible();
    await expect(page.locator('[data-action="open-workbench-nav"]')).not.toBeVisible();
    await expect(page.locator(".settings-tabs")).toBeVisible();
    await page.locator('[data-action="leave-settings"]').click();
    await expect(page.locator('[data-action="open-workbench-nav"]')).toBeVisible();
    await page.locator('[data-action="plugins-nav"]').click();
    await expect(page.locator("[data-plugins]")).toBeVisible();
    await expect(page.locator('[data-action="plugin-install-folder"]')).toBeVisible();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await expect(page.locator("#workbench-name")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
