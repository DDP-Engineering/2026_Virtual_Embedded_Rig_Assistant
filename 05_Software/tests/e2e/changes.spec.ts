import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
async function launch(root: string, folder: string) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERA_TEST_ALLOW_WRITES;
  env.VERA_REPLAY_DIR = join(desktop, "../../../tests/fixtures/llm-scripts");
  env.VERA_TEST_DIALOG_PATH = folder;
  const started = new Date().toISOString();
  const executable = join(
    desktop,
    "../../../node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  const out: Buffer[] = [],
    err: Buffer[] = [];
  let captured: ChildProcess | undefined;
  const observedLaunches: string[] = [];
  let launchArgv: string[] = [],
    launchCwd: string | undefined;
  let launchShell: boolean | string | undefined;
  const childProcess = createRequire(import.meta.url)(
    "node:child_process",
  ) as typeof import("node:child_process");
  const originalSpawn = childProcess.spawn;
  // Capture at the real spawn boundary, before Playwright waits for Electron debugging.
  childProcess.spawn = ((...args: Parameters<typeof spawn>) => {
    observedLaunches.push(args[0]);
    const child = originalSpawn(...args);
    if (args[0] === executable || args[0].startsWith(`"${executable}" `)) {
      captured = child;
      launchArgv = [args[0], ...args[1]];
      launchCwd = args[2]?.cwd?.toString();
      launchShell = args[2]?.shell;
      child.stdout?.on("data", (b) => out.push(Buffer.from(b)));
      child.stderr?.on("data", (b) => err.push(Buffer.from(b)));
    }
    return child;
  }) as typeof spawn;
  const app = await _electron
    .launch({
      executablePath: executable,
      chromiumSandbox: true,
      args: [desktop, `--user-data-dir=${join(root, "data")}`],
      env,
    })
    .finally(() => {
      childProcess.spawn = originalSpawn;
    });
  const processHandle = app.process();
  expect(
    captured === processHandle,
    `actual spawn capture: ${JSON.stringify({ executable, observedLaunches })}`,
  ).toBe(true);
  await installNetworkGuard(app);
  await app.firstWindow();
  const loaded = await app.evaluate(({ app, BrowserWindow }) => ({
    entry: app.getAppPath(),
    preload: (
      BrowserWindow.getAllWindows()[0]?.webContents as unknown as {
        _getPreloadScript(): { filePath: string } | null;
      }
    )?._getPreloadScript()?.filePath,
    argv: process.argv,
    execPath: process.execPath,
    cwd: process.cwd(),
  }));
  expect(loaded.execPath).toBe(executable);
  let target: string | undefined;
  const hashes: Record<string, string> = {};
  if (process.env.VERA_E2E_EVIDENCE_DIR) {
    target = join(process.env.VERA_E2E_EVIDENCE_DIR, `wp18-${randomUUID()}`);
    await mkdir(target, { recursive: true });
    const manifest = JSON.parse(await readFile(join(loaded.entry, "package.json"), "utf8")) as {
      main: string;
    };
    for (const [name, file] of Object.entries({
      executable: loaded.execPath,
      main: join(loaded.entry, manifest.main),
      preload: loaded.preload ?? "",
    })) {
      const bytes = await readFile(file);
      hashes[name] = createHash("sha256").update(bytes).digest("hex");
      if (name !== "executable") await writeFile(join(target, `${name}.js`), bytes, { flag: "wx" });
    }
  }
  return {
    app,
    async close() {
      await app.close();
      if (target) {
        const stdout = Buffer.concat(out),
          stderr = Buffer.concat(err);
        await writeFile(join(target, "stdout"), stdout, { flag: "wx" });
        await writeFile(join(target, "stderr"), stderr, { flag: "wx" });
        await writeFile(
          join(target, "execution.json"),
          JSON.stringify(
            {
              ...loaded,
              started,
              ended: new Date().toISOString(),
              exit: processHandle.exitCode,
              hashes,
              stdoutSHA256: createHash("sha256").update(stdout).digest("hex"),
              stderrSHA256: createHash("sha256").update(stderr).digest("hex"),
              launchArgv,
              launchCwd,
              launchShell,
              outputCaptureScope: "original native process bytes from spawn through close",
              actualMainPackageEntrypoint: true,
              actualWebContentsPreload: true,
              platform: process.platform,
              sandbox: true,
              permissionInjection: false,
            },
            null,
            2,
          ),
          { flag: "wx" },
        );
      }
    },
  };
}

// REQ-UX-18000003 REQ-REL-18000004 REQ-FUNC-18000001 REQ-FUNC-18000002
test("approved edit appears live with exact counts and recorded diff surviving native restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp18-ui-")),
    folder = join(root, "Board ă");
  await mkdir(folder);
  await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond line.\n");
  let rig = await launch(root, folder);
  let closed = false;
  try {
    let page = await rig.app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Board");
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    const id = (await page
      .locator('[data-session][aria-current="page"]')
      .getAttribute("data-session")) as string;
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
          sessionId: id,
          modelRef: "replay/edit-approve",
        }),
      id,
    );
    await page.locator('[data-toggle="right"]').click();
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    const panel = page.locator("#panel-changes");
    await expect(panel).toContainText("No changes in this session.");
    // Close the overlay to send; tab remount must read the latest durable state as well as live events.
    await page.locator('[data-toggle="right"]').click();
    await input.fill("Edit the board");
    await input.press("Enter");
    const card = page.locator("[data-approval-card]");
    await expect(card).toBeVisible();
    await expect(card.locator(".diff-added")).toContainText("5 V");
    // Keep Changes mounted before approval so the completed edit must arrive through change.recorded.
    await rig.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900));
    await page.locator('[data-toggle="right"]').click();
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(panel.locator("[data-change]")).toHaveCount(1);
    await expect(panel.locator("[data-change]")).toContainText("board.txt");
    await expect(panel.locator(".changes-counts")).toHaveText("+1 −1");
    await expect(panel.locator(".approval-diff .diff-added")).toContainText("+Board uses 5 V.");
    await expect(panel.locator(".approval-diff .diff-removed")).toContainText("-Board uses 3.3 V.");
    const stored = await page.evaluate(async (id) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const list = await api.invoke("changes.list", { sessionId: id });
      const first = list[0];
      if (!first) throw Error("missing change");
      return { list, detail: await api.invoke("changes.get", { changeId: first.changeId }) };
    }, id);
    expect(stored.list[0]).toMatchObject({ sessionId: id, path: "board.txt", added: 1, removed: 1 });
    const state = await page.evaluate(
      async (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      id,
    );
    expect(state.snapshot.approvals[0]).toMatchObject({ decision: "approved", by: "user" });
    expect(await readFile(join(folder, "board.txt"), "utf8")).toBe("Board uses 5 V.\nSecond line.\n");
    expect(await outboundAttempts(rig.app)).toEqual([]);
    if (process.env.VERA_E2E_EVIDENCE_DIR)
      await page.screenshot({
        path: join(process.env.VERA_E2E_EVIDENCE_DIR, `changes-before-${randomUUID()}.png`),
      });
    await rig.close();
    closed = true;
    rig = await launch(root, folder);
    closed = false;
    page = await rig.app.firstWindow();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await expect(page.locator(`[data-session="${id}"][aria-current="page"]`)).toBeVisible();
    // Reopening shows the overview; the engineer opens the restored session from the sidebar.
    await page.locator(`[data-session="${id}"]`).click();
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    const restored = page.locator("#panel-changes");
    await expect(restored.locator("[data-change]")).toHaveCount(1);
    await expect(restored.locator(".changes-counts")).toHaveText("+1 −1");
    await expect(restored.locator(".approval-diff")).toHaveText(`${stored.detail.diff}\n`);
    const reread = await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("changes.list", { sessionId: id }),
      id,
    );
    expect(reread).toEqual(stored.list);
    expect(await outboundAttempts(rig.app)).toEqual([]);
    if (process.env.VERA_E2E_EVIDENCE_DIR)
      await page.screenshot({
        path: join(process.env.VERA_E2E_EVIDENCE_DIR, `changes-after-${randomUUID()}.png`),
      });
  } finally {
    if (!closed) await rig.close();
    await rm(root, { recursive: true, force: true });
  }
});

test.describe("browser changes", () => {
  test.use({ viewport: { width: 1024, height: 640 } });
  test("empty, live multiple edits, keyboard selection and reveal at minimum size", async ({
    page,
    context,
  }) => {
    const server = spawn(process.execPath, ["scripts/dev-renderer.mjs"], {
      env: { ...process.env, VITE_API: "mock" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const attempts: string[] = [],
      errors: string[] = [];
    server.stdout.on("data", (b) => {
      output += b.toString();
    });
    server.stderr.on("data", (b) => {
      output += b.toString();
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
      else {
        attempts.push(route.request().url());
        await route.abort();
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`Renderer startup timeout: ${output}`)), 20000);
        const ready = () => {
          if (output.includes("VERA_RENDERER_READY")) {
            clearTimeout(timer);
            resolve();
          }
        };
        server.stdout.on("data", ready);
        server.stderr.on("data", ready);
        server.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        server.once("exit", (code) => {
          clearTimeout(timer);
          reject(Error(`Renderer exit ${code}: ${output}`));
        });
      });

      await page.goto("http://127.0.0.1:5173/?mock=chat");
      await page.locator("[data-workbench-entry] .workbench-group-name").click();
      await page.locator('[data-action="new-session"]').click();
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(input).toBeEnabled();
      await page.locator('[data-toggle="right"]').click();
      await page.getByRole("tab", { name: "Changes", exact: true }).click();
      await expect(page.locator("#panel-changes")).toContainText("No changes in this session.");
      for (const text of ["Edit notes", "Edit again"]) {
        await page.locator('[data-toggle="right"]').click();
        await input.fill(text);
        await input.press("Enter");
        const card = page.locator("[data-approval-card]").last();
        await expect(card).toBeVisible();
        await card.focus();
        await card.press("A");
        await expect(input).toBeEnabled();
        await page.locator('[data-toggle="right"]').click();
      }
      const panel = page.locator("#panel-changes");
      await expect(panel.locator("[data-change]")).toHaveCount(2);
      await panel.locator("[data-change]").last().focus();
      await page.keyboard.press("Enter");
      await expect(panel.locator("[data-change]").last()).toHaveAttribute("aria-pressed", "true");
      await expect(panel.locator(".approval-diff .diff-added")).toHaveText("+new\n");
      await panel.getByRole("button", { name: "Reveal in folder", exact: true }).click();
      await expect(panel.locator("[role=alert]")).toHaveCount(0);
      expect(attempts).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath("changes-browser-minimum.png") });
    } finally {
      if (server.exitCode === null) {
        const stopped = once(server, "exit");
        server.kill("SIGTERM");
        await stopped;
      }
    }
  });
});
