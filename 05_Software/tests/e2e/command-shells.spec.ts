import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { _electron, type Page } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { expect, test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

test("shell selector localizes installed variants, Custom and Automatic", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.evaluate(async () => {
    const modulePath = "/api/index.ts";
    const { api } = await import(modulePath);
    const original = api.invoke.bind(api);
    api.invoke = (channel: string, input: unknown) =>
      channel === "commands.shells"
        ? Promise.resolve([
            { id: "pwsh", executable: "C:/PowerShell/pwsh.exe" },
            { id: "powershell", executable: null },
            { id: "cmd", executable: "C:/Windows/System32/cmd.exe" },
            { id: "bash", executable: "C:/Git/bin/bash.exe" },
          ])
        : original(channel, input);
  });
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="commands"]').click();
  for (const language of ["en", "ro", "de", "fr"]) {
    const labels = await page.evaluate(async (language) => {
      const modulePath = "/i18n.ts";
      const { default: i18n } = await import(modulePath);
      await i18n.changeLanguage(language);
      return {
        save: i18n.t("workbench.save"),
        cancel: i18n.t("workbench.cancel"),
        missing: i18n.t("settings.shellNotInstalled"),
      };
    }, language);
    const panel = page.locator('[data-settings-section="commands"]');
    const select = panel.locator("#command-shell");
    await expect(select).toBeEnabled();
    await expect(select.locator("option")).toHaveCount(6);
    await expect(select.locator('[value="powershell"]')).toBeDisabled();
    await expect(select.locator('[value="powershell"]')).toContainText(labels.missing);
    await select.selectOption("cmd");
    await panel.getByRole("button", { name: labels.save, exact: true }).click();
    await expect(panel.getByRole("button", { name: labels.save, exact: true })).toBeDisabled();
    await select.selectOption("custom");
    await panel.locator("#command-shell-path").fill("C:/Portable/bash.exe");
    await panel.getByRole("button", { name: labels.cancel, exact: true }).click();
    await expect(select).toHaveValue("cmd");
    await select.selectOption("custom");
    await panel.locator("#command-shell-path").fill("C:/Portable/bash.exe");
    await panel.getByRole("button", { name: labels.save, exact: true }).click();
    await expect(panel.getByRole("button", { name: labels.save, exact: true })).toBeDisabled();
    await expect(select).toHaveValue("custom");
    await select.selectOption("");
    await panel.getByRole("button", { name: labels.save, exact: true }).click();
    await expect(panel.getByRole("button", { name: labels.save, exact: true })).toBeDisabled();
    await expect(select).toHaveValue("");
  }
});

test("native detected shell choices start compatible terminals and preserve existing ones", async () => {
  test.setTimeout(120000);
  const entry = process.env.VERA_BUILD_ROOT
    ? resolve(process.env.VERA_BUILD_ROOT, "main/index.js")
    : resolve("src/apps/desktop/out/main/index.js");
  // Development resources are relative to the desktop build. Reject a misplaced test build before Electron opens.
  await access(
    resolve(dirname(entry), "../../../../../src/models/Xenova/bge-small-en-v1.5/model-manifest.json"),
  );
  const evidence = resolve("test-outputs/shell-selector");
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(join(evidence, "native-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await _electron.launch({
    timeout: 15000,
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [
      process.env.VERA_BUILD_ROOT
        ? join(process.env.VERA_BUILD_ROOT, "main/index.js")
        : resolve("src/apps/desktop"),
      `--user-data-dir=${join(root, "profile")}`,
    ],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: VeraBridge }).vera);
    const bench = await invoke(page, "workbench.create", { folder, name: "Shell choices" });
    await page.reload();
    const choices = await invoke(page, "commands.shells", {});
    expect(choices.map((choice) => choice.id)).toEqual(["pwsh", "powershell", "cmd", "bash"]);
    const installed = choices.filter((choice) => choice.executable !== null);
    expect(installed.length).toBeGreaterThan(0);
    if (process.platform === "win32") expect(installed.some((choice) => choice.id === "cmd")).toBe(true);
    for (const choice of installed) {
      if ((await page.locator('[data-toggle="right"]').getAttribute("aria-expanded")) === "true")
        await page.locator('[data-toggle="right"]').click();
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="commands"]').click();
      const select = page.locator("#command-shell");
      await expect(select).toBeEnabled();
      await expect(select.locator(`[value="${choice.id}"]`)).toBeEnabled();
      await select.selectOption(choice.id);
      const save = page
        .locator('[data-settings-section="commands"]')
        .getByRole("button", { name: "Save", exact: true });
      await save.click();
      await expect(save).toBeDisabled();
      expect((await invoke(page, "app.settings.get", {})).settings.shell).toBe(choice.executable);
      await page.locator('[data-action="leave-settings"]').click();
      if (!(await page.locator("#tab-terminal").isVisible()))
        await page.locator('[data-toggle="right"]').click();
      await page.locator("#tab-terminal").click();
      await expect(page.locator(".terminal-surface textarea")).toBeAttached();
      const previous = await invoke(page, "terminal.list", { workbenchId: bench.config.id });
      if (previous.length > 0 && choice !== installed[0]) {
        await page.getByRole("button", { name: "New terminal", exact: true }).click();
        await expect
          .poll(async () => (await invoke(page, "terminal.list", { workbenchId: bench.config.id })).length)
          .toBe(previous.length + 1);
      }
      const terminals = await invoke(page, "terminal.list", { workbenchId: bench.config.id });
      const terminal = terminals.at(-1);
      if (!terminal) throw Error("Missing created terminal");
      await expect(page.locator(".terminal-surface")).toHaveAttribute("data-terminal-id", terminal.id);
      const command =
        choice.id === "cmd"
          ? "echo VERA_CMD_PROOF:%COMSPEC%"
          : choice.id === "bash"
            ? `printf 'VERA_BASH_PROOF:%s\\n' "$BASH_VERSION"`
            : 'Write-Output "VERA_PS_PROOF:$($PSVersionTable.PSVersion.Major)"';
      const expected =
        choice.id === "cmd"
          ? /VERA_CMD_PROOF:.*cmd\.exe/i
          : choice.id === "bash"
            ? /VERA_BASH_PROOF:[0-9]/
            : new RegExp(`VERA_PS_PROOF:${choice.id === "pwsh" ? 7 : 5}`);
      await invoke(page, "terminal.input", {
        workbenchId: bench.config.id,
        id: terminal.id,
        data: `${command}\r`,
      });
      await expect
        .poll(
          async () =>
            (await invoke(page, "terminal.output", { workbenchId: bench.config.id, id: terminal.id })).output,
          { timeout: 20000 },
        )
        .toMatch(expected);
      expect(terminals.every((terminal) => terminal.running)).toBe(true);
    }
    expect(await outboundAttempts(app)).toEqual([]);
    await page.screenshot({ path: join(evidence, "native-shells.png") });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
