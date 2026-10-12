import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, type Locator, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop");
async function launch(root: string, folder: string) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERA_TEST_ALLOW_WRITES;
  env.VERA_REPLAY_DIR = join(desktop, "../../fixtures/llm-scripts");
  env.VERA_TEST_DIALOG_PATH = folder;
  env.VERA_REPLAY_DELAY_MS = "500";
  const started = new Date().toISOString();
  const executable = join(
    desktop,
    "../../node_modules/electron/dist",
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
    target = join(process.env.VERA_E2E_EVIDENCE_DIR, `wp20-${randomUUID()}`);
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

async function expectPlan(panel: Locator, expected: readonly (readonly string[])[]) {
  // Observe each complete replacement in one DOM read, including its accessible icons.
  await expect
    .poll(
      () =>
        panel
          .locator(".plan-list > li")
          .evaluateAll((items) =>
            items.map((item) => [
              item.querySelector(".plan-text")?.textContent,
              ...Array.from(item.querySelectorAll('[role="img"]'), (icon) => icon.getAttribute("aria-label")),
            ]),
          ),
      { intervals: [25, 50, 100] },
    )
    .toEqual(expected);
}

// REQ-FUNC-2e8a54c7 REQ-DATA-d968385c REQ-UX-8d3039aa
test("Plan follows every replacement live and restores the final list after native restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp20-ui-")),
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
          modelRef: "replay/plan-updates",
        }),
      id,
    );
    await rig.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900));
    await page.locator('[data-toggle="right"]').click();
    await page.getByRole("tab", { name: "Plan", exact: true }).click();
    const panel = page.locator("#panel-plan");
    await expect(panel).toContainText("No tasks in this session.");
    await input.fill("Update the plan");
    await input.press("Enter");
    await expectPlan(panel, [
      ["Inspect the board", "In progress"],
      ["Verify the pins", "Pending"],
    ]);
    await expectPlan(panel, [
      ["Verify the pins", "In progress"],
      ["Inspect the board", "Done"],
    ]);
    await expectPlan(panel, [["Board verification complete", "Done"]]);
    await expect(input).toBeEnabled();
    const before = await page.evaluate(
      async (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      id,
    );
    expect(before.snapshot.todos).toEqual([
      { id: "summary", text: "Board verification complete", status: "done" },
    ]);
    expect(before.snapshot.items.filter((i) => i.kind === "tool").map((i) => i.status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
    expect(before.snapshot.approvals).toEqual([]);
    expect(await outboundAttempts(rig.app)).toEqual([]);
    if (process.env.VERA_E2E_EVIDENCE_DIR)
      await page.screenshot({
        path: join(process.env.VERA_E2E_EVIDENCE_DIR, `plan-before-${randomUUID()}.png`),
      });
    await rig.close();
    closed = true;
    rig = await launch(root, folder);
    closed = false;
    page = await rig.app.firstWindow();
    await page.locator('[data-action="open-recent"]').click();
    await expect(page.locator('[data-session][aria-current="page"]')).toHaveAttribute("data-session", id);
    await page.getByRole("tab", { name: "Plan", exact: true }).click();
    await expect(page.locator("#panel-plan .plan-text")).toHaveText(["Board verification complete"]);
    await expect(page.locator("#panel-plan").getByRole("img", { name: "Done", exact: true })).toHaveCount(1);
    const after = await page.evaluate(
      async (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      id,
    );
    expect(after.snapshot.todos).toEqual(before.snapshot.todos);
    expect(after.seq).toBe(before.seq);
    expect(await outboundAttempts(rig.app)).toEqual([]);
  } finally {
    if (!closed) await rig.close();
    await rm(root, { recursive: true, force: true });
  }
});
test.describe("browser Plan", () => {
  test.use({ viewport: { width: 1024, height: 640 } });
  test("translated live Plan statuses fit minimum geometry", async ({ page, context }) => {
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
        await page.locator("#language").selectOption(lang);
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await page.locator('[data-i18n="nav.welcome"]').click();
        await page.locator('[data-action="open-recent"]').click();
        await page.locator('[data-action="new-session"]').click();
        const input = page.locator("textarea");
        await expect(input).toBeEnabled();
        await page.locator('[data-toggle="right"]').click();
        await page.locator('[role="tab"]').nth(4).focus();
        await page.keyboard.press("Enter");
        await input.fill("Update the plan");
        await input.press("Enter");
        const panel = page.locator("#panel-plan");
        const statusLabels = {
          en: ["In progress", "Pending", "Done"] as const,
          ro: ["În curs", "În așteptare", "Finalizat"] as const,
          de: ["In Bearbeitung", "Ausstehend", "Erledigt"] as const,
        }[lang as "en" | "ro" | "de"];
        await expectPlan(panel, [
          ["Inspect the board", statusLabels[0]],
          ["Verify the pins", statusLabels[1]],
        ]);
        await expectPlan(panel, [
          ["Verify the pins", statusLabels[0]],
          ["Inspect the board", statusLabels[2]],
        ]);
        await expectPlan(panel, [["Board verification complete", statusLabels[2]]]);
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
      await page.screenshot({ path: test.info().outputPath("plan-browser-minimum.png") });
    } finally {
      if (server.exitCode === null) {
        const stopped = once(server, "exit");
        server.kill("SIGTERM");
        await stopped;
      }
    }
  });
});
