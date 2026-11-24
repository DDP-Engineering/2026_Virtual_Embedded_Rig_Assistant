// REQ-UX-0f1a32c4 REQ-FUNC-37261edc
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import { coreToolNames, type VeraBridge } from "@vera/shared";
import { parse } from "yaml";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";
import { saveSettings } from "./settings-navigation.js";

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
    await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", {
        advanced: { pageSize: 50 },
      }),
    );
    await page.evaluate(
      async (paths) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        for (const path of paths) {
          const { sha256 } = await api.invoke("plugins.review", { path });
          await api.invoke("plugins.install", { path, sha256 });
        }
      },
      [resolve("plugins/electrical-network"), resolve("plugins/kicad-layout")],
    );
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Tool selection");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await openTools(page);
    await expect(page.locator("[data-tool-toggle]")).toHaveCount(coreToolNames.length - 1);
    const viewImage = page.locator('[data-tool-toggle="view_image"]');
    await expect(viewImage).toHaveCount(0);
    await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("providers.save", {
        provider: "custom",
        config: {
          name: "Workbench model fixture",
          baseUrl: "http://127.0.0.1:1/v1",
          model: "org/manual/model",
          protocol: "lmstudio",
          models: [
            {
              id: "org/manual/model",
              name: "Manual fixture",
              contextWindow: 32768,
              maxOutputTokens: 4096,
              reasoningOptions: [],
            },
          ],
        },
      }),
    );
    await page.locator('[data-project-section="agent"]').click();
    await expect(
      page.locator('datalist option[value="custom:workbench-model-fixture/org/manual/model"]'),
    ).toHaveAttribute("label", /Workbench model fixture.*32,768 tokens.*Tools unverified/);
    await page.locator("[data-project-model]").fill("openai/gpt-4o");
    await page.locator('[data-project-section="tools"]').click();
    await expect(viewImage).toBeChecked();
    await expect(page.locator("[data-tool-toggle]")).toHaveCount(coreToolNames.length);
    await page.locator('[data-project-section="agent"]').click();
    await page.locator("[data-project-model]").clear();
    await page.locator('[data-project-section="tools"]').click();
    await expect(viewImage).toHaveCount(0);
    await page.locator('[data-tool-toggle="grep"]').uncheck();
    await page.locator('[data-tool-toggle="write"]').uncheck();
    await page.locator('[data-tool-toggle="decode_register"]').uncheck();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    const saved = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.config.get", {}),
    );
    expect(saved.config.tools.disabled).toEqual(["grep", "write", "decode_register"]);
    expect(saved.warnings.filter((warning) => warning.code === "UNKNOWN_NAME")).toEqual([]);
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="plugins"]').click();
    await expect(page.locator("[data-shared-capabilities]")).toBeVisible();
    await expect(page.locator("[data-shared-dependency]")).toContainText("Unavailable");
    await page.locator('[data-tool-toggle="electrical_model_change"]').uncheck();
    const candidate = page.locator('[data-tool-toggle="apply_candidate"]');
    await candidate.focus();
    await page.keyboard.press("Space");
    await expect(candidate).not.toBeChecked();
    await expect(page.locator('[data-capability-dependency="kicad-layout"]')).toContainText("Unavailable");
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toBeHidden();
    const yaml = await readFile(join(folder, ".vera/workbench.yaml"), "utf8");
    expect(parse(yaml).tools.disabled).toEqual([
      "grep",
      "write",
      "decode_register",
      "electrical_model_change",
      "apply_candidate",
    ]);
    await openTools(page);
    await expect(page.locator('[data-tool-toggle="grep"]')).not.toBeChecked();
    await page.locator('[data-tool-toggle="grep"]').check();
    await page.locator(".workbench-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).toBe(yaml);
    for (const [language, description] of [
      ["ro", "Caută în conținutul"],
      ["de", "Dateiinhalte durchsuchen"],
      ["fr", "Rechercher dans le contenu"],
      ["en", "Search file contents"],
    ]) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="appearance"]').click();
      await page.locator("#language").selectOption(language as string);
      await saveSettings(page);
      await page.locator('[data-action="leave-settings"]').click();
      await openTools(page);
      await expect(page.locator('[data-tool-description="grep"]')).toContainText(description as string);
      await expect(page.locator('[data-tool-description="decode_register"]')).toContainText(
        language === "ro"
          ? "Decodează o valoare"
          : language === "de"
            ? "Registerwert"
            : language === "fr"
              ? "registre"
              : "Decode a captured register",
      );
      await expect(page.locator('[data-tool-toggle="decode_register"]')).not.toBeChecked();
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
        await page.locator('[data-project-section="plugins"]').click();
        await expect(page.locator('[data-tool-toggle="electrical_model_change"]')).not.toBeChecked();
        const candidate = page.locator('[data-tool-toggle="apply_candidate"]');
        await candidate.scrollIntoViewIfNeeded();
        await candidate.focus();
        await page.keyboard.press("Space");
        await expect(candidate).toBeChecked();
        const overflow = await page
          .locator("[data-workbench-plugins]")
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
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
    await expect(page.locator('[data-tool-toggle="decode_register"]')).not.toBeChecked();
    await expect(page.locator('[data-tool-toggle="read"]')).toBeChecked();
    await page.locator('[data-tool-toggle="grep"]').check();
    await page.locator('[data-tool-toggle="write"]').check();
    await page.locator('[data-tool-toggle="decode_register"]').check();
    await page.locator('[data-project-section="plugins"]').click();
    await expect(page.locator('[data-tool-toggle="electrical_model_change"]')).not.toBeChecked();
    await page.locator('[data-tool-toggle="electrical_model_change"]').check();
    await expect(page.locator('[data-tool-toggle="apply_candidate"]')).not.toBeChecked();
    await page.locator('[data-tool-toggle="apply_candidate"]').check();
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
