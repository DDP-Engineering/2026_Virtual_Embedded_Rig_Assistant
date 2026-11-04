// PLG-12: real sandboxed Electron, replay draft tools, user review and native process execution.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "../../src/apps/desktop");
const cli = join(here, "../fixtures/plugin-builder/cli.mjs");
const invoke = <T>(page: Page, channel: string, payload: unknown) =>
  page.evaluate(
    async ({ channel, payload }) => {
      try {
        return await (window as unknown as { vera: VeraBridge }).vera.invoke(
          channel as never,
          payload as never,
        );
      } catch (error) {
        throw Error(JSON.stringify(error));
      }
    },
    { channel, payload },
  ) as Promise<T>;

test("authors from help, reviews trial in bypass and promotes with the user button", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-builder-native-"));
  const folder = join(root, "Board"),
    scripts = join(root, "replay");
  await mkdir(folder);
  await mkdir(scripts);
  await writeFile(
    join(folder, "manual.txt"),
    (await promisify(execFile)(process.execPath, [cli, "--help"])).stdout,
  );
  const manifest = {
    format: 1,
    id: "fixture-cli",
    version: "1.0.0",
    name: "Fixture CLI",
    description: "Inspect a virtual device.",
    ecosystem: "general",
    platforms: ["windows-x64", "linux-x64"],
    programs: {
      "fixture-cli": {
        install: { find: { windows: ["%PATH%"], linux: ["$PATH"] }, hint: "Install the fixture CLI." },
        version: { args: ["--help"], match: "fixture-cli (\\d+\\.\\d+\\.\\d+)" },
      },
    },
    rules: [
      { match: "fixture-cli inspect", risk: "safe" },
      { match: "fixture-cli burn", risk: "irreversible", note: "Virtual only." },
    ],
  };
  const draft = "plugins/fixture-cli";
  const script = async (name: string, steps: unknown[]) =>
    writeFile(join(scripts, `${name}.jsonl`), steps.map((s) => JSON.stringify(s)).join("\n"));
  await script("builder", [
    {
      match: "build",
      toolCalls: [
        { name: "load_skill", args: { name: "create-plugin" } },
        { name: "read", args: { path: "manual.txt" } },
      ],
    },
    {
      toolCalls: [
        { name: "write", args: { path: `${draft}/plugin.yaml`, content: JSON.stringify(manifest) } },
      ],
    },
    { toolCalls: [{ name: "plugin_validate", args: { path: draft } }] },
    { toolCalls: [{ name: "plugin_install", args: { path: draft } }] },
    { text: "Enable it on the Plugins page." },
  ]);
  for (const command of ["inspect", "burn"])
    await script(command, [
      {
        match: command,
        toolCalls: [{ name: "run_program", args: { program: "fixture-cli", args: [command] } }],
      },
      { text: "Done." },
    ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_TEST_DIALOG_PATH = folder;
  env.VERA_TEST_PROGRAMS = JSON.stringify({
    "fixture-cli/fixture-cli": { executable: process.execPath, prefix: [cli] },
  });
  const app = await _electron.launch({
    executablePath: join(
      desktop,
      "../../../node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${join(root, "data")}`],
    env,
  });
  await installNetworkGuard(app);
  const page = await app.firstWindow();
  try {
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Board");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});
    await page.locator('[data-action="new-session"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    const sessionId = (await page
      .locator('[data-session][aria-current="page"]')
      .getAttribute("data-session")) as string;
    await invoke(page, "session.mode.set", { sessionId, mode: "bypass" });
    const send = async (model: string) => {
      await expect
        .poll(
          async () =>
            (await invoke<{ snapshot: { status: string } }>(page, "session.get", { sessionId })).snapshot
              .status,
        )
        .toBe("idle");
      await invoke(page, "session.model.set", { sessionId, modelRef: `replay/${model}` });
      await input.fill(model === "builder" ? "build from manual" : model);
      await input.press("Enter");
    };
    await send("builder");
    const install = page
      .locator("[data-approval-card]")
      .filter({ has: page.locator("[data-plugin-install-review]") });
    await expect(install).toContainText("irreversible");
    await expect(install.getByRole("button", { name: "Approve and switch to auto-edit" })).toHaveCount(0);
    expect(await invoke(page, "plugins.list", {})).toEqual([]);
    await install.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(input).toBeEnabled();
    await page.locator('[data-action="plugins-nav"]').click();
    const card = page.locator('[data-plugin="fixture-cli"]');
    await expect(card).toContainText("Trial");
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    await page.locator("[data-workbench-entry] .workbench-group-name").first().click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="plugins"]').click();
    await page.locator('[data-workbench-plugin="fixture-cli"] input').check();
    await page.locator("[data-project-save]").click();
    await page.locator('[data-action="plugins-nav"]').click();
    await page.locator(`[data-session="${sessionId}"]`).click();
    await send("inspect");
    const run = page.locator('[data-approval-card][data-risk="safe"]');
    await expect(run).toBeVisible();
    await expect(run).toContainText("Trial");
    await run.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(input).toBeEnabled();
    await send("burn");
    const burn = page.locator('[data-approval-card][data-risk="irreversible"]');
    await expect(burn).toBeVisible();
    await burn.locator("[data-approval-confirmation]").fill("wrong");
    await burn.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(burn.getByRole("alert")).toBeVisible();
    await burn.locator("[data-approval-confirmation]").fill("burn");
    await burn.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(input).toBeEnabled();
    await page.locator('[data-action="plugins-nav"]').click();
    page.once("dialog", (dialog) => void dialog.accept());
    await card.locator('[data-action="plugin-promote"]').click();
    await expect(card).toContainText("Local");
    await expect(card.locator('[data-action="plugin-promote"]')).toHaveCount(0);
    await page.locator(`[data-session="${sessionId}"]`).click();
    const before = (await invoke<{ snapshot: { approvals: unknown[] } }>(page, "session.get", { sessionId }))
      .snapshot.approvals.length;
    await send("inspect");
    await expect
      .poll(
        async () =>
          (await invoke<{ runs: unknown[] }>(page, "runs.list", { workbenchId: config.id })).runs.length,
      )
      .toBe(3);
    await expect(input).toBeEnabled();
    await expect(page.locator("[data-approval-card]")).toHaveCount(before);
    const record = JSON.parse(
      await readFile(join(root, "data/plugins/installed/fixture-cli/install.json"), "utf8"),
    );
    expect(record.tier).toBe("local");
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
