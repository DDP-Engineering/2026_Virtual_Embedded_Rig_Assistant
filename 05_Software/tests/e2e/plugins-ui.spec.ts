// REQ-UX-e6056763 REQ-UX-8904f319 REQ-UX-acc04fbc REQ-UX-fd6bc95d REQ-UX-41c19e62 REQ-UX-e0e51891
// REQ-UX-25921e97 REQ-UX-93fd56dc REQ-FUNC-6c76f25a: the Plugins page and the Runs tab in native Electron.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { parse } from "yaml";
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

async function editPlugins(page: Page, id = "echo-tools") {
  const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});
  await page.locator(`[data-workbench-entry="${config.id}"] .workbench-group-name`).click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="plugins"]').click();
  return page.locator(`[data-workbench-plugin="${id}"] input`);
}

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
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    const selected = await editPlugins(page);
    await expect(selected).not.toBeChecked();
    await selected.check();
    await page.locator("[data-project-save]").click();
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

// REQ-UX-13ab0006: real native review/trust, refresh, stale snapshot and reopen.
test("scoped workbench plugin clone stays untrusted until review and a changed helper needs another review", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vera-scoped-ui-")),
    source = join(root, "source"),
    folder = join(root, "clone");
  await cp(join(here, "../fixtures/workbenches/demo-board"), source, { recursive: true });
  await mkdir(join(source, ".vera/plugins"), { recursive: true });
  await cp(fixture, join(source, ".vera/plugins/echo-tools"), { recursive: true });
  const git = async (cwd: string, ...args: string[]) =>
    promisify(execFile)("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], { cwd });
  await git(source, "init");
  await git(source, "add", ".");
  await git(
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@invalid",
    "commit",
    "-m",
    "scoped fixture",
  );
  await git(root, "clone", "--local", source, folder);
  let app = await launch(root, folder);
  try {
    let page = await app.firstWindow();
    await page.locator('[data-action="open-workbench-nav"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    await page.locator('[data-action="plugins-nav"]').click();
    let card = page.locator('[data-plugin="echo-tools"]');
    await expect(card.locator('[data-issue="untrusted"]')).toBeVisible();
    await expect(card.locator('[data-action="plugin-provision"]')).toHaveCount(0);
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    await expect(await editPlugins(page)).toBeDisabled();
    await page.locator(".workbench-editor footer button").first().click();
    await page.locator('[data-action="plugins-nav"]').click();
    await card.locator('[data-action="plugin-scoped-review"]').click();
    const review = page.locator("[data-plugin-review]");
    await expect(review).toContainText("SHA-256");
    await expect(review.locator('[data-rule="irreversible"]')).toContainText("Burns a fuse");
    await review.getByRole("button", { name: "Trust this package", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(card.locator("[data-plugin-issues]")).toHaveCount(0);
    await (await editPlugins(page)).check();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toHaveCount(0);
    await page.locator('[data-action="plugins-nav"]').click();
    const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});
    const helper = join(folder, ".vera/plugins/echo-tools/echo.mjs");
    await writeFile(helper, `${await readFile(helper, "utf8")}\n// changed helper\n`);
    await page.locator('[data-action="plugin-refresh"]').click();
    await expect(card.locator('[data-issue="changed"]')).toBeVisible();
    await card.locator('[data-action="plugin-scoped-review"]').click();
    const stale = await invoke<{ sha256: string }>(page, "plugins.scopedReview", {
      workbenchId: config.id,
      id: "echo-tools",
    });
    await writeFile(helper, `${await readFile(helper, "utf8")}\n// changed while reviewing\n`);
    await review.getByRole("button", { name: "Trust this package", exact: true }).click();
    await expect(review.getByRole("alert")).toBeVisible();
    await expect(review).toBeVisible();
    const rejected = await page.evaluate(
      async ({ id, hash }) => {
        try {
          await (window as unknown as { vera: VeraBridge }).vera.invoke("plugins.scopedTrust", {
            workbenchId: id,
            id: "echo-tools",
            sha256: hash,
          });
          return "accepted";
        } catch (error) {
          return (error as { code: string }).code;
        }
      },
      { id: config.id, hash: stale.sha256 },
    );
    expect(rejected).toBe("CONFLICT");
    await review.locator('[data-action="plugin-review-cancel"]').click();
    await card.locator('[data-action="plugin-scoped-review"]').click();
    await review.getByRole("button", { name: "Trust this package", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(card.locator("[data-plugin-issues]")).toHaveCount(0);
    await app.close();
    app = await launch(root, folder);
    page = await app.firstWindow();
    await page.locator('[data-action="open-workbench-nav"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    await page.locator('[data-action="plugins-nav"]').click();
    card = page.locator('[data-plugin="echo-tools"]');
    await expect(await editPlugins(page)).toBeChecked();
    await page.locator(".workbench-editor footer button").first().click();
    await page.locator('[data-action="plugins-nav"]').click();
    await writeFile(join(folder, ".vera/plugins/echo-tools/skills/echo-guide/SKILL.md"), "changed skill");
    await page.locator('[data-action="plugin-refresh"]').click();
    await expect(card.locator('[data-issue="changed"]')).toBeVisible();
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-FUNC-86daf060: real request-scoped probe lifetime must end with the application.
test("scoped program status probes are cancelled when the app quits", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-scoped-shutdown-")),
    folder = join(root, "bench"),
    pkg = join(root, "packages/probe-tools"),
    marker = join(root, "probe.json");
  await cp(join(here, "../fixtures/workbenches/demo-board"), folder, { recursive: true });
  await mkdir(pkg, { recursive: true });
  const code = `const fs=require('node:fs');let n=0;setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,n:++n})),30);`;
  await writeFile(
    join(pkg, "plugin.yaml"),
    JSON.stringify({
      format: 1,
      id: "probe-tools",
      name: "Probe tools",
      version: "1.0.0",
      description: "Fixture probe lifetime.",
      ecosystem: "general",
      platforms: ["windows-x64", "linux-x64"],
      programs: {
        node: {
          install: {
            find: { windows: [process.execPath], linux: [process.execPath] },
            hint: "Use the fixture Node.",
          },
          version: { args: ["-e", code], match: "(\\d+)" },
        },
      },
      rules: [],
    }),
  );
  let app: ElectronApplication | undefined = await launch(root, folder);
  let pid: number | undefined;
  try {
    const page = await app.firstWindow();
    await page.locator('[data-action="open-workbench-nav"]').click();
    const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});
    const reviewed = await invoke<{ sha256: string }>(page, "plugins.review", { path: pkg });
    await invoke(page, "plugins.install", { path: pkg, sha256: reviewed.sha256 });
    await page.evaluate(
      ({ id }) => {
        void (window as unknown as { vera: VeraBridge }).vera
          .invoke("plugins.programs", { id: "probe-tools", workbenchId: id })
          .catch(() => {});
      },
      { id: config.id },
    );
    await expect
      .poll(async () => {
        try {
          const state = JSON.parse(await readFile(marker, "utf8"));
          pid = state.pid;
          return state.n;
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(0);
    const closing = app.close();
    await expect
      .poll(
        async () => {
          const first = await readFile(marker, "utf8");
          await new Promise((done) => setTimeout(done, 200));
          return first === (await readFile(marker, "utf8"));
        },
        { timeout: 3000 },
      )
      .toBe(true);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closing,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(Error("Application quit did not finish")), 15000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
    app = undefined;
    await expect
      .poll(
        () => {
          if (!pid) return false;
          try {
            process.kill(pid, 0);
            return false;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ESRCH";
          }
        },
        { timeout: 3000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          const first = await readFile(marker, "utf8");
          await new Promise((done) => setTimeout(done, 200));
          return first === (await readFile(marker, "utf8"));
        },
        { timeout: 3000 },
      )
      .toBe(true);
  } finally {
    if (pid) {
      if (process.platform === "win32")
        await promisify(execFile)("taskkill.exe", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
      else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
    }
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-UX-e07790cb REQ-FUNC-41f5c03b
test("workbench plugin draft save and cancel persist independently with empty new defaults", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-workbench-plugins-"));
  const a = join(root, "A"),
    b = join(root, "B");
  await mkdir(a);
  await mkdir(b);
  let app = await launch(root, a);
  const config = async (folder: string) =>
    parse(await readFile(join(folder, ".vera/workbench.yaml"), "utf8"));
  try {
    let page = await app.firstWindow();
    const review = await invoke<{ sha256: string }>(page, "plugins.review", { path: fixture });
    await invoke(page, "plugins.install", { path: fixture, sha256: review.sha256 });
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator("#workbench-name").fill("A");
    await page.locator('[data-project-section="plugins"]').click();
    await expect(page.locator('[data-workbench-plugin="echo-tools"] input')).not.toBeChecked();
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("A");
    expect((await config(a)).plugins.enabled).toEqual([]);
    const selected = await editPlugins(page);
    await selected.check();
    expect((await config(a)).plugins.enabled).toEqual([]);
    await page.locator(".workbench-editor footer button").first().click();
    await expect(await editPlugins(page)).not.toBeChecked();
    await page.locator('[data-workbench-plugin="echo-tools"] input').check();
    await page.locator("[data-project-save]").click();
    await expect.poll(async () => (await config(a)).plugins.enabled).toEqual(["echo-tools"]);
    await app.evaluate((_electron, folder) => {
      process.env.VERA_TEST_DIALOG_PATH = folder;
    }, b);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator("#workbench-name").fill("B");
    await page.locator('[data-project-section="plugins"]').click();
    await expect(page.locator('[data-workbench-plugin="echo-tools"] input')).not.toBeChecked();
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("B");
    expect((await config(b)).plugins.enabled).toEqual([]);
    expect((await config(a)).plugins.enabled).toEqual(["echo-tools"]);
    await app.close();
    app = await launch(root, a);
    page = await app.firstWindow();
    await page.locator('[data-action="open-workbench-nav"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("A");
    await expect(await editPlugins(page)).toBeChecked();
    await page.locator('[data-workbench-plugin="echo-tools"] input').uncheck();
    await page.locator("[data-project-save]").click();
    await expect.poll(async () => (await config(a)).plugins.enabled).toEqual([]);
    expect((await config(b)).plugins.enabled).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
