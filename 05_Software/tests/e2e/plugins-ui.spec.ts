// REQ-UX-e6056763 REQ-UX-8904f319 REQ-UX-acc04fbc REQ-UX-fd6bc95d REQ-UX-41c19e62 REQ-UX-e0e51891
// REQ-UX-25921e97 REQ-UX-93fd56dc REQ-FUNC-6c76f25a: the Plugins page and the Runs tab in native Electron.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "../../src/apps/desktop");
const fixture = join(here, "../fixtures/plugins/echo-tools");

async function launch(root: string, folder: string) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERA_TEST_ALLOW_WRITES;
  env.VERA_REPLAY_DIR = join(here, "../fixtures/llm-scripts");
  env.VERA_TEST_DIALOG_PATH = folder;
  // The instrumented build runs the fixture program with this Node instead of provisioning it.
  env.VERA_TEST_PROGRAMS = JSON.stringify({ "echo-tools/echo": { executable: process.execPath } });
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
  return app;
}
/** What the instrumented plugin picker returns next. */
const pick = (app: ElectronApplication, path: string) =>
  app.evaluate((_electron, chosen) => {
    process.env.VERA_TEST_PLUGIN_PATH = chosen;
  }, path);
const invoke = <T>(page: Page, channel: string, payload: unknown) =>
  page.evaluate(
    async ({ channel, payload }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, payload as never),
    { channel, payload },
  ) as Promise<T>;

test("installs a plugin through the review screen, enables it, and stops its background run from the Runs tab", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "vera-plugins-ui-")),
    folder = join(root, "Board");
  await mkdir(folder, { recursive: true });
  // A package whose manifest rates a command with an unknown risk.
  const broken = join(root, "packages", "broken-tools");
  await cp(fixture, broken, { recursive: true });
  const manifest = await readFile(join(fixture, "plugin.yaml"), "utf8");
  await writeFile(
    join(broken, "plugin.yaml"),
    manifest.replace("id: echo-tools", "id: broken-tools").replace("risk: safe", "risk: dangerous"),
  );
  const app = await launch(root, folder),
    page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Board");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});

    await page.locator('[data-action="plugins-nav"]').click();
    await expect(page.locator("[data-plugins]")).toContainText("No plugins are installed.");

    // A broken package shows its manifest error and cannot be installed.
    await pick(app, broken);
    await page.locator('[data-action="plugin-install-folder"]').click();
    const review = page.locator("[data-plugin-review]");
    await expect(review.locator('[data-issue="field"]')).toContainText("rules.0.risk");
    await expect(review.locator('[data-action="plugin-install"]')).toBeDisabled();
    await review.locator('[data-action="plugin-review-cancel"]').click();

    // The fixture plugin installs through the review screen.
    await pick(app, fixture);
    await page.locator('[data-action="plugin-install-folder"]').click();
    await expect(review).toContainText("Review Echo tools");
    await expect(review.locator('[data-program="echo"]')).toContainText("%VERA_TEST_NODE%");
    await expect(review.locator('[data-program="echo"]')).toContainText("Install Node.js.");
    await expect(review.locator("[data-rule]")).toHaveCount(5);
    await expect(review.locator("[data-rule] .risk-badge")).toHaveText([
      "Safe",
      "Safe",
      "Device write",
      "Irreversible",
      "Blocked",
    ]);
    await expect(review).toContainText("Writes the device.");
    await expect(review).toContainText("Burns a fuse.");
    await review.locator('[data-action="plugin-install"]').click();
    const card = page.locator('[data-plugin="echo-tools"]');
    await expect(card).toContainText("Echo tools");
    await expect(card).toContainText("Local");

    // Enabled for this workbench only.
    await card.getByRole("checkbox", { name: "Enabled in Board" }).click();
    await expect(card.getByRole("checkbox", { name: "Enabled in Board" })).toBeChecked();
    await expect
      .poll(async () => readFile(join(folder, ".vera/workbench.yaml"), "utf8"))
      .toMatch(/plugins:\s*\n\s*enabled:\s*\n\s*- echo-tools/);
    expect(await invoke(page, "plugins.list", { workbenchId: config.id })).toMatchObject([
      { id: "echo-tools", enabled: true },
    ]);

    // The agent starts a background run; the Runs tab opens its log and stops it.
    await page.locator('[data-action="new-session"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    const sessionId = (await page
      .locator('[data-session][aria-current="page"]')
      .getAttribute("data-session")) as string;
    await invoke(page, "session.model.set", { sessionId, modelRef: "replay/program-serve" });
    await input.fill("Start the echo serve program");
    await input.press("Enter");
    await expect
      .poll(
        async () => (await invoke<{ runs: unknown[] }>(page, "runs.list", { workbenchId: config.id })).runs,
      )
      .toHaveLength(1);
    if ((await page.locator('[data-panel="right"]').count()) === 0)
      await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-runs").click();
    const row = page.locator("[data-run]");
    await expect(row).toContainText("echo serve");
    await expect(row).toContainText("Running");
    await row.locator('[data-action="run-log"]').click();
    await expect(page.locator("[data-run-log]")).toContainText("READY");
    await expect(page.locator("[data-run-log]")).toContainText("boot");
    await page.locator('[data-action="run-log-close"]').click();
    await expect(page.locator("[data-run-log]")).toHaveCount(0);
    await expect(row.locator('[data-action="run-log"]')).toBeFocused();
    await row.locator('[data-action="run-stop"]').click();
    await expect(row).toContainText("Stopped");
    await expect(row.locator('[data-action="run-stop"]')).toHaveCount(0);
    const id = (await row.getAttribute("data-run")) as string;
    expect(JSON.parse(await readFile(join(folder, ".vera/runs", `${id}.json`), "utf8"))).toMatchObject({
      plugin: "echo-tools",
      program: "echo",
      args: ["serve"],
      background: true,
      end: "stopped",
    });

    // An installed plugin edited after its review shows why it no longer loads.
    const installed = join(root, "data/plugins/installed/echo-tools/plugin.yaml");
    await writeFile(installed, (await readFile(installed, "utf8")).replace("risk: safe", "risk: dangerous"));
    await page.locator('[data-action="plugins-nav"]').click();
    await expect(card.locator('[data-issue="changed"]')).toBeVisible();
    await expect(card.locator('[data-issue="field"]')).toContainText("rules.0.risk");
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
