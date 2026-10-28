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
import { changeSetting } from "./settings-navigation.js";

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
    target = join(process.env.VERA_E2E_EVIDENCE_DIR, `wp19-${randomUUID()}`);
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

// REQ-FUNC-bf809842 REQ-DATA-e3d4d5ba REQ-FUNC-b3d37df6 REQ-SEC-86010eb5 REQ-FUNC-5ece91b7 REQ-FUNC-8c00fdea REQ-UX-76d958ce REQ-REL-da260a86
test("artifact appears live, opens/exports, survives restart and deletion removes folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp19-ui-")),
    folder = join(root, "Board ă");
  await mkdir(folder);
  let rig = await launch(root, folder),
    closed = false;
  try {
    let page = await rig.app.firstWindow();
    await page.locator("#workbench-name").fill("Board");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("session missing");
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
          sessionId: id,
          modelRef: "replay/save-artifact",
        }),
      id,
    );
    await rig.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900));
    await page.locator('[data-toggle="right"]').click();
    await page.getByRole("tab", { name: "Artifacts", exact: true }).click();
    const panel = page.locator("#panel-artifacts");
    await expect(panel).toContainText("No artifacts in this session.");
    await input.fill("Save summary");
    await input.press("Enter");
    await expect(panel.locator("[data-artifact]")).toHaveCount(1);
    await expect(panel).toContainText("37 B");
    await expect(panel.locator(".artifact-viewer h1")).toHaveText("Session summary");
    const validCitation = page.locator('[data-citation="valid"]');
    await expect(validCitation).toHaveText("summary.md");
    await expect(validCitation).toHaveAttribute("title", "artifact:summary.md");
    await expect(validCitation).toHaveAttribute("aria-label", "artifact:summary.md");
    const invalidCitation = page.locator('[data-citation="invalid"]');
    await expect(invalidCitation).toHaveText("missing.md");
    await expect(invalidCitation).toHaveAttribute("title", /^artifact:missing\.md: /);
    await expect(invalidCitation).toHaveAttribute("aria-label", /^artifact:missing\.md: /);
    await expect(invalidCitation).toHaveAttribute("aria-disabled", "true");
    await expect(invalidCitation).toHaveClass(/\binvalid\b/);
    await invalidCitation.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".document-dialog")).toHaveCount(0);
    await expect(panel.locator(".artifact-viewer h1")).toHaveText("Session summary");
    await expect(page.locator("[data-approval-card]")).toHaveCount(0);
    const exportPath = join(root, "export ă.md");
    await rig.app.evaluate((_electron, path) => {
      process.env.VERA_TEST_DIALOG_PATH = path;
    }, exportPath);
    await panel.getByRole("button", { name: "Export", exact: true }).click();
    await expect(panel).toContainText("Artifact exported.");
    expect(await readFile(exportPath, "utf8")).toBe("# Session summary\n\nBoard uses 3.3 V.\n");
    const a = await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("artifacts.list", { sessionId: id }),
      id,
    );
    expect(a[0]?.sessionId).toBe(id);
    const reveal = await page.evaluate(
      async (artifactId) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("artifacts.reveal", { artifactId }),
      a[0]?.artifactId ?? "",
    );
    expect(reveal).toEqual({});
    expect(await outboundAttempts(rig.app)).toEqual([]);
    if (process.env.VERA_E2E_EVIDENCE_DIR)
      await page.screenshot({
        path: join(process.env.VERA_E2E_EVIDENCE_DIR, `artifacts-before-${randomUUID()}.png`),
      });
    await rig.close();
    closed = true;
    rig = await launch(root, folder);
    closed = false;
    page = await rig.app.firstWindow();
    await page.locator('[data-action="open-recent"]').click();
    await page.getByRole("tab", { name: "Artifacts", exact: true }).click();
    await expect(page.locator(".artifact-viewer h1")).toHaveText("Session summary");
    expect(
      await page.evaluate(
        async (id) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("artifacts.list", { sessionId: id }),
        id,
      ),
    ).toEqual(a);
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.delete", { sessionId: id }),
      id,
    );
    await expect(readFile(join(folder, ".vera/artifacts", id, "summary.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const { stat } = await import("node:fs/promises");
    await expect(stat(join(folder, ".vera/artifacts", id))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await outboundAttempts(rig.app)).toEqual([]);
  } finally {
    if (!closed) await rig.close();
    await rm(root, { recursive: true, force: true });
  }
});
test.describe("browser artifacts", () => {
  test.use({ viewport: { width: 1024, height: 640 } });
  test("translated live artifact viewer, keyboard and actions fit minimum geometry", async ({
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
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(() => fail(Error(output)), 20000);
        const ready = () => {
          if (output.includes("VERA_RENDERER_READY")) {
            clearTimeout(timer);
            done();
          }
        };
        server.stdout.on("data", ready);
        server.stderr.on("data", ready);
        server.once("error", fail);
      });
      for (const lang of ["en", "ro", "de"]) {
        await page.goto("http://127.0.0.1:5173/?mock=chat");
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.locator('[data-i18n="nav.settings"]').click();
        await changeSetting(page, "language", () => page.locator("#language").selectOption(lang));
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await page.locator('[data-i18n="nav.welcome"]').click();
        await page.locator('[data-action="open-recent"]').click();
        await page.locator('[data-action="new-session"]').click();
        const input = page.locator("textarea");
        await expect(input).toBeEnabled();
        await input.fill("Save artifact");
        await input.press("Enter");
        await expect(input).toBeEnabled();
        await page.locator('[data-toggle="right"]').click();
        await page.locator('[role="tab"]').nth(3).click();
        const panel = page.locator("#panel-artifacts");
        await expect(panel.locator("[data-artifact]")).toHaveCount(1);
        await panel.locator("[data-artifact]").focus();
        await page.keyboard.press("Enter");
        await expect(panel.locator(".artifact-viewer h1")).toHaveText("Mock artifact");
        await panel.locator(".artifact-actions button").first().click();
        await expect(panel.locator('[role="status"]')).toHaveCount(1);
        await panel.locator(".artifact-actions button").last().click();
        await expect(panel.locator('[role="alert"]')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const theme of ["light", "dark"])
          for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
            await page.evaluate(
              async ([theme, scale]) => {
                const module = "/api/index.ts";
                const { api } = await import(/* @vite-ignore */ module);
                await api.updateSettings({ theme, textScale: scale });
              },
              [theme, scale] as const,
            );
            await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
            await expect
              .poll(() => page.locator("html").evaluate((e) => getComputedStyle(e).fontSize))
              .toBe(`${14 * scale}px`);
            expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          }
        await page.locator('[data-toggle="right"]').click();
      }
      expect(attempts).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath("artifacts-browser-minimum.png") });
    } finally {
      if (server.exitCode === null) {
        const stopped = once(server, "exit");
        server.kill("SIGTERM");
        await stopped;
      }
    }
  });
});
