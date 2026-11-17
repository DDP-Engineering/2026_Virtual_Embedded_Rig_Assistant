import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

async function launch(data: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [resolve("src/apps/desktop"), `--user-data-dir=${data}`],
    env,
  });
  await installNetworkGuard(app);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  return app;
}

async function editTabs(page: Page) {
  const group = page
    .locator("[data-workbench-entry]")
    .filter({ has: page.locator('.workbench-group-name[aria-current="page"]') });
  // Overview is available even when no content tabs are visible.
  await group.locator(".workbench-group-name").click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="interface"]').click();
  await expect(page.locator('[data-panel-tab-toggle="terminal"]')).toBeEnabled();
}

const visibleIds = (page: Page) =>
  page.locator('.panel-tabs [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.id));

test("right-panel visibility saves per workbench, preserves running terminals and survives restart", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vera-right-tabs-"));
  const firstFolder = join(root, "first"),
    secondFolder = join(root, "second"),
    data = join(root, "data");
  await mkdir(firstFolder);
  await mkdir(secondFolder);
  await writeFile(
    join(firstFolder, "keep-running.cjs"),
    "setInterval(() => console.log('PANEL_TICK'), 300);\n",
  );
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data);
    let page = await app.firstWindow();
    const first = await invoke(page, "workbench.create", { folder: firstFolder, name: "First tabs bench" });
    const firstGroup = () => page.locator("[data-workbench-entry]").filter({ hasText: "First tabs bench" });
    await firstGroup().locator(".workbench-group-name").click();
    const one = await invoke(page, "session.create", { workbenchId: first.config.id });
    const two = await invoke(page, "session.create", { workbenchId: first.config.id });
    await firstGroup().locator(`[data-session="${one.id}"]`).click();
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => (await invoke(page, "terminal.list", { workbenchId: first.config.id })).length)
      .toBe(1);
    const terminal = (await invoke(page, "terminal.list", { workbenchId: first.config.id }))[0];
    if (!terminal) throw Error("Terminal missing");
    const quote = (value: string) =>
      process.platform === "win32"
        ? `'${value.replaceAll("'", "''")}'`
        : `'${value.replaceAll("'", "'\"'\"'")}'`;
    await invoke(page, "terminal.input", {
      workbenchId: first.config.id,
      id: terminal.id,
      data: `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} keep-running.cjs\r`,
    });
    const output = () => invoke(page, "terminal.output", { workbenchId: first.config.id, id: terminal.id });
    await expect.poll(async () => (await output()).output).toContain("PANEL_TICK");
    await editTabs(page);
    await page.locator('[data-panel-tab-toggle="terminal"]').uncheck();
    await page.locator('[data-panel-tab-toggle="context"]').uncheck();
    await page.locator('[data-panel-tab-toggle="runs"]').uncheck();
    // The saved selection, not the settings draft, controls the shell.
    await expect(page.locator("#tab-terminal")).toHaveCount(1);
    await page.locator("[data-project-cancel]").click();
    await expect(page.locator("#tab-terminal")).toHaveCount(1);
    await editTabs(page);
    for (const id of ["terminal", "context", "runs"])
      await page.locator(`[data-panel-tab-toggle="${id}"]`).uncheck();
    await page.locator("[data-project-save]").click();
    await expect(page.locator('[data-panel="right"]')).toHaveAttribute("data-tab", "docs");
    expect(await visibleIds(page)).toEqual(["tab-docs", "tab-changes", "tab-artifacts", "tab-plan"]);
    const before = (await output()).output.length;
    await expect.poll(async () => (await output()).output.length).toBeGreaterThan(before);
    expect((await invoke(page, "terminal.list", { workbenchId: first.config.id }))[0]?.running).toBe(true);
    for (const session of [one, two]) {
      await firstGroup().locator(`[data-session="${session.id}"]`).click();
      expect(await visibleIds(page)).toEqual(["tab-docs", "tab-changes", "tab-artifacts", "tab-plan"]);
    }
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator("#tab-terminal")).toHaveCount(0);
    await page.locator("[data-configure-panel-tabs]").click();
    await expect(page.locator('[data-project-section="interface"]')).toHaveAttribute("aria-current", "page");
    for (const id of ["docs", "changes", "artifacts", "plan"])
      await page.locator(`[data-panel-tab-toggle="${id}"]`).uncheck();
    await page.locator("[data-project-save]").click();
    await expect(page.locator('[data-panel="right"]')).toHaveCount(0);
    await expect(page.locator('[data-toggle="right"]')).toHaveCount(0);
    await expect(page.locator("[data-configure-panel-tabs]")).toBeVisible();
    expect((await invoke(page, "terminal.list", { workbenchId: first.config.id }))[0]?.running).toBe(true);

    await invoke(page, "workbench.create", {
      folder: secondFolder,
      name: "Second tabs bench",
      config: { interface: { right_panel_tabs: ["plan", "changes"] } },
    });
    await page
      .locator("[data-workbench-entry]")
      .filter({ hasText: "Second tabs bench" })
      .locator(".workbench-group-name")
      .click();
    await expect(page.locator('[data-panel="right"]')).toHaveAttribute("data-tab", "changes");
    expect(await visibleIds(page)).toEqual(["tab-changes", "tab-plan"]);
    await firstGroup().locator(".workbench-group-name").click();
    await expect(page.locator('[data-panel="right"]')).toHaveCount(0);
    expect((await invoke(page, "workbench.config.get", {})).config.interface.right_panel_tabs).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch(data);
    page = await app.firstWindow();
    await firstGroup().locator(".workbench-group-name").click();
    await expect(page.locator("[data-configure-panel-tabs]")).toBeVisible();
    await expect(page.locator('[data-panel="right"]')).toHaveCount(0);
    await page.locator("[data-configure-panel-tabs]").click();
    await page.locator("[data-restore-panel-tabs]").click();
    await expect(page.locator('[data-panel-tab-toggle="terminal"]')).toBeChecked();
    await expect(page.locator('[data-toggle="right"]')).toHaveCount(0);
    await page.locator("[data-project-save]").click();
    await expect(page.locator('[data-toggle="right"]')).toBeVisible();
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
    expect(
      (await invoke(page, "session.list", { workbenchId: first.config.id })).map((session) => session.id),
    ).toEqual(expect.arrayContaining([one.id, two.id]));
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
