// REQ-UX-0f1a32c4 REQ-FUNC-37261edc
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import { builtinToolNames, type VeraBridge } from "@vera/shared";
import { parse } from "yaml";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

async function openTools(page: Page) {
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="tools"]').click();
  await expect(page.locator('[data-tool-toggle="read"]')).toBeEnabled();
}

test("native tool checkbox configuration persists, cancels drafts and translates descriptions", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-tools-"));
  const folder = join(root, "board");
  await mkdir(folder);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_TEST_DIALOG_PATH = folder;
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
      env,
    });
  let app = await launch();
  try {
    await installNetworkGuard(app);
    let page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Tool selection");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await openTools(page);
    await expect(page.locator("[data-tool-toggle]")).toHaveCount(builtinToolNames.length);
    await page.locator('[data-tool-toggle="grep"]').uncheck();
    await page.locator('[data-tool-toggle="write"]').uncheck();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    const saved = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.config.get", {}),
    );
    expect(saved.config.tools.disabled).toEqual(["grep", "write"]);
    expect(saved.warnings.filter((warning) => warning.code === "UNKNOWN_NAME")).toEqual([]);
    const yaml = await readFile(join(folder, ".vera/workbench.yaml"), "utf8");
    expect(parse(yaml).tools.disabled).toEqual(["grep", "write"]);
    await openTools(page);
    await expect(page.locator('[data-tool-toggle="grep"]')).not.toBeChecked();
    await page.locator('[data-tool-toggle="grep"]').check();
    await page.locator(".workbench-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).toBe(yaml);
    for (const [language, description] of [
      ["ro", "Caută în conținutul"],
      ["de", "Dateiinhalte durchsuchen"],
      ["en", "Search file contents"],
    ]) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="language"]').click();
      await page.locator("#language").selectOption(language as string);
      await page.locator('[data-action="leave-settings"]').click();
      await openTools(page);
      await expect(page.locator('[data-tool-description="grep"]')).toContainText(description as string);
      await expect(page.locator('[data-tool-toggle="grep"]')).not.toBeChecked();
      if (language === "de") {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1024, 640));
        await page.locator('[data-tool-toggle="load_skill"]').scrollIntoViewIfNeeded();
        const bounds = await page.locator(".workbench-editor").boundingBox();
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        expect(bounds).toBeTruthy();
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
        expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 1);
        await expect(page.locator("[data-project-save]")).toBeVisible();
      }
      if (process.env.VERA_TOOLS_SCREENSHOT && language === "ro")
        await page.screenshot({ path: process.env.VERA_TOOLS_SCREENSHOT });
      await page.keyboard.press("Escape");
    }
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await openTools(page);
    await expect(page.locator('[data-tool-toggle="grep"]')).not.toBeChecked();
    await expect(page.locator('[data-tool-toggle="write"]')).not.toBeChecked();
    await expect(page.locator('[data-tool-toggle="read"]')).toBeChecked();
    await page.locator('[data-tool-toggle="grep"]').check();
    await page.locator('[data-tool-toggle="write"]').check();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    const enabled = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.config.get", {}),
    );
    expect(enabled.config.tools.disabled).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
