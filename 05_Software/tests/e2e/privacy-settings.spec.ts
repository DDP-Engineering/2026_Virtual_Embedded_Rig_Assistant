import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { parse } from "yaml";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";
import { saveSettings } from "./settings-navigation.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

test("browser privacy drafts and localized controls fit the compact layout in all four languages", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl, context }) => {
  test.setTimeout(90000);
  const errors: string[] = [],
    outbound: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      outbound.push(route.request().url());
      await route.abort();
    }
  });

  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Browser privacy");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  for (const language of ["en", "ro", "de", "fr"]) {
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#language").selectOption(language);
    await saveSettings(page);
    await page.locator('[data-section="data"]').click();
    const agent = page.locator('[data-mask-area="agent"] input');
    if (!(await agent.isChecked())) {
      await agent.click();
      await page.locator("[data-settings-save]").click();
      await expect(page.locator("[data-settings-save]")).toBeDisabled();
    }
    await agent.click();
    await page.locator('[data-action="cancel-mask-off"]').click();
    await expect(agent).toBeChecked();
    await expect(agent).toBeFocused();
    await agent.click();
    await page.locator('[data-action="confirm-mask-off"]').click();
    await page.locator("[data-settings-save]").click();
    await expect(page.locator("[data-settings-save]")).toBeDisabled();
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="privacy"]').click();
    const choice = page.locator('[data-mask-area="agent"] select');
    await expect(choice).toHaveValue("default");
    await choice.selectOption("on");
    await choice.selectOption("default");
    await page.locator('[data-action="confirm-mask-off"]').click();
    await expect(page.locator("[data-project-save]")).toBeDisabled();
    const bounds = await page.locator("[data-privacy-controls]").boundingBox();
    expect(bounds).toBeTruthy();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(1025);
    await page.screenshot({
      path: resolve(`evaluation-outputs/mask05/native/${language}-browser-compact.png`),
    });
    await page.locator("[data-project-cancel]").click();
  }
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});

for (const language of ["en", "ro", "de", "fr"] as const) {
  test(`native privacy pages save independent choices, inherited labels and confirmed drafts (${language})`, async () => {
    test.setTimeout(120000);
    const evidence = resolve("evaluation-outputs/mask05/native");
    await mkdir(evidence, { recursive: true });
    const scratch = await realpath(await mkdtemp(join(evidence, `${language}-owned-`)));
    const folder = join(scratch, "first"),
      other = join(scratch, "second");
    await mkdir(folder);
    await mkdir(other);
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.VERA_TEST_DIALOG_PATH = folder;
    const launch = () =>
      _electron.launch({
        executablePath: resolve(
          "node_modules/electron/dist",
          process.platform === "win32" ? "electron.exe" : "electron",
        ),
        args: [resolve("src/apps/desktop"), `--user-data-dir=${join(scratch, "profile")}`],
        env,
        chromiumSandbox: true,
      });
    let app = await launch();
    const receipt: Record<string, unknown> = { language };
    try {
      await installNetworkGuard(app);
      let page = await app.firstWindow();
      await invoke(page, "app.settings.update", {
        language,
        privacy: { mask: { display: false, runs: false, agent: true, exports: true } },
      });
      const second = await invoke(page, "workbench.create", {
        folder: other,
        name: "Independent bench",
        config: { privacy: { mask: { display: "off", runs: "on", agent: "on", exports: "off" } } },
      });
      await invoke(page, "workbench.close", {});
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="data"]').click();
      const appInput = (area: string) =>
        page.locator(`[data-settings-section="data"] [data-mask-area="${area}"] input`);
      await expect(appInput("agent")).toBeChecked();
      await appInput("display").check();
      await appInput("runs").check();
      await appInput("exports").uncheck();
      await expect(page.locator("dialog")).toHaveCount(0);
      await appInput("agent").click();
      await expect(appInput("agent")).toBeChecked();
      await page.locator('[data-action="cancel-mask-off"]').click();
      await expect(appInput("agent")).toBeChecked();
      await expect(appInput("agent")).toBeFocused();
      await appInput("agent").click();
      await page.keyboard.press("Escape");
      await expect(appInput("agent")).toBeFocused();
      await appInput("agent").click();
      await page.locator('[data-action="confirm-mask-off"]').click();
      expect((await invoke(page, "app.settings.get", {})).settings.privacy?.mask?.agent).toBe(true);
      await page.locator("[data-settings-save]").click();
      await expect(page.locator("[data-settings-save]")).toBeDisabled();
      expect((await invoke(page, "app.settings.get", {})).settings.privacy?.mask).toEqual({
        display: true,
        runs: true,
        agent: false,
        exports: false,
      });
      await page.screenshot({ path: join(evidence, `${language}-app.png`) });
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator('[data-i18n="nav.welcome"]').click();
      await page.locator("#workbench-name").fill("Privacy bench");
      await page.locator('[data-action="choose-create"]').click();
      await page.locator('[data-project-section="privacy"]').click();
      const choice = (area: string) => page.locator(`[data-mask-area="${area}"] select`);
      for (const area of ["display", "runs", "agent", "exports"])
        await expect(choice(area)).toHaveValue("default");
      await choice("agent").selectOption("on");
      await page.locator('[data-action="create-workbench"]').click();
      const first = await invoke(page, "workbench.config.get", {});
      expect(first.config.privacy?.mask?.agent).toBe("on");
      const openEditor = async () => {
        await page.locator('[data-action="edit-workbench-overview"]').click();
        await page.locator('[data-project-section="privacy"]').click();
      };
      await openEditor();
      // Record the actual localized labels; no separate renderer catalog determines backend policy.
      receipt.labels = await page.locator("[data-privacy-controls]").innerText();
      await expect(choice("agent").locator('option[value="default"]')).toContainText(
        language === "en"
          ? "Off"
          : language === "ro"
            ? "Dezactivat"
            : language === "de"
              ? "Aus"
              : "Désactivé",
      );
      await choice("agent").selectOption("default");
      await expect(choice("agent")).toHaveValue("on");
      await page.locator('[data-action="cancel-mask-off"]').click();
      await expect(choice("agent")).toBeFocused();
      await choice("agent").selectOption("default");
      await page.locator('[data-action="confirm-mask-off"]').click();
      expect((await invoke(page, "workbench.config.get", {})).config.privacy?.mask?.agent).toBe("on");
      await choice("display").selectOption("off");
      await choice("runs").selectOption("off");
      await choice("exports").selectOption("on");
      await expect(page.locator("dialog")).toHaveCount(0);
      await page.screenshot({ path: join(evidence, `${language}-workbench.png`) });
      await page.locator("[data-project-save]").click();
      await expect(page.locator(".workbench-editor")).toBeHidden();
      const yaml = await readFile(join(folder, ".vera/workbench.yaml"), "utf8");
      expect(parse(yaml).privacy.mask).toEqual({
        display: "off",
        runs: "off",
        agent: "default",
        exports: "on",
      });
      await openEditor();
      await choice("agent").selectOption("on");
      await page.locator("[data-project-cancel]").click();
      expect(await readFile(join(folder, ".vera/workbench.yaml"), "utf8")).toBe(yaml);
      await invoke(page, "app.settings.update", { privacy: { mask: { agent: true } } });
      await openEditor();
      await expect(choice("agent").locator('option[value="default"]')).toContainText(
        language === "en" ? "On" : language === "ro" ? "Activat" : language === "de" ? "Ein" : "Activé",
      );
      await expect(page.locator("[data-project-save]")).toBeDisabled();
      await page.locator("[data-project-cancel]").click();
      await invoke(page, "workbench.close", {});
      await invoke(page, "workbench.open", { folder: other });
      await page.locator(`[data-workbench-entry="${second.config.id}"] .workbench-group-name`).click();
      await openEditor();
      for (const [area, value] of Object.entries(second.config.privacy?.mask ?? {}))
        await expect(choice(area)).toHaveValue(value as string);
      await page.locator("[data-project-cancel]").click();
      expect(await outboundAttempts(app)).toEqual([]);
      await app.close();
      app = await launch();
      await installNetworkGuard(app);
      page = await app.firstWindow();
      await invoke(page, "workbench.open", { folder });
      await page.locator(`[data-workbench-entry="${first.config.id}"] .workbench-group-name`).click();
      await openEditor();
      await expect(choice("agent")).toHaveValue("default");
      await expect(choice("exports")).toHaveValue("on");
      receipt.persisted = (await invoke(page, "workbench.config.get", {})).config.privacy;
      receipt.app = (await invoke(page, "app.settings.get", {})).settings.privacy;
      expect(await outboundAttempts(app)).toEqual([]);
      receipt.outboundAttempts = [];
      await writeFile(join(evidence, `${language}-receipt.json`), JSON.stringify(receipt, null, 2));
    } finally {
      await app.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
