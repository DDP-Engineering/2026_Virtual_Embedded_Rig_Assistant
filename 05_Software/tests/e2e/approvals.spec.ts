import type { ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
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
    cwd: process.cwd(),
  }));
  let target: string | undefined;
  const hashes: Record<string, string> = {};
  if (process.env.VERA_E2E_EVIDENCE_DIR) {
    target = join(process.env.VERA_E2E_EVIDENCE_DIR, `wp17-${randomUUID()}`);
    await mkdir(target, { recursive: true });
    const manifest = JSON.parse(await readFile(join(loaded.entry, "package.json"), "utf8")) as {
      main: string;
    };
    for (const [name, file] of Object.entries({
      main: join(loaded.entry, manifest.main),
      preload: loaded.preload ?? "",
    })) {
      const bytes = await readFile(file);
      hashes[name] = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(target, `${name}.js`), bytes, { flag: "wx" });
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

for (const action of ["Approve", "Deny", "A", "D"] as const)
  test(`native approval ${action} decides exact bytes through inline card`, async () => {
    const root = await mkdtemp(join(tmpdir(), "vera-wp17-ui-")),
      folder = join(root, "Board Äƒ");
    await mkdir(folder);
    await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond line.\n");
    const rig = await launch(root, folder),
      page = await rig.app.firstWindow();
    try {
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
        async ({ id, action }) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
            sessionId: id,
            modelRef: `replay/${action === "Deny" || action === "D" ? "edit-deny" : "edit-approve"}`,
          }),
        { id, action },
      );
      await input.fill("Edit the board");
      await input.press("Enter");
      const card = page.locator("[data-approval-card]");
      await expect(card).toBeVisible();
      await expect(input).toBeDisabled();
      await expect(
        page.locator('[aria-current="page"] [data-session-status="awaiting_approval"]'),
      ).toBeVisible();
      await expect(card.locator(".diff-added")).toContainText("5 V");
      await expect(card.locator(".diff-removed")).toContainText("3.3 V");
      if (action === "A" || action === "D") {
        await card.focus();
        await card.press(action);
      } else await card.getByRole("button", { name: action, exact: true }).click();
      await expect(input).toBeEnabled();
      await expect
        .poll(async () => {
          const current = await page.evaluate(
            async (id) =>
              (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
            id,
          );
          return current.snapshot.turns.at(-1)?.stopReason;
        })
        .toBe("end");
      const result = await page.evaluate(
        async (id) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
        id,
      );
      const approved = action === "Approve" || action === "A";
      expect(result.snapshot.approvals[0]).toMatchObject({
        decision: approved ? "approved" : "denied",
        by: "user",
      });
      expect(result.snapshot.turns.at(-1)?.stopReason).toBe("end");
      expect(await readFile(join(folder, "board.txt"), "utf8")).toBe(
        approved ? "Board uses 5 V.\nSecond line.\n" : "Board uses 3.3 V.\nSecond line.\n",
      );
      expect(await outboundAttempts(rig.app)).toEqual([]);
      if (process.env.VERA_E2E_EVIDENCE_DIR)
        await page.screenshot({
          path: join(process.env.VERA_E2E_EVIDENCE_DIR, `approval-${action}-${randomUUID()}.png`),
        });
    } finally {
      await rig.close();
      await rm(root, { recursive: true, force: true });
    }
  });

test("native approval switches session mode and read-only aborts the next wait", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp17-protected-")),
    folder = join(root, "Board");
  await mkdir(folder);
  const rig = await launch(root, folder),
    page = await rig.app.firstWindow();
  try {
    await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("workbench.create", { folder, name: "Board" });
      await api.invoke("workbench.config.update", { patch: { agent: { permission_mode: "ask" } } });
    }, folder);
    await writeFile(join(folder, "board-notes.md"), "Device under test\n");
    const session = await page.evaluate(async () =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("session.create", {
        modelRef: "replay/edit-protected",
      }),
    );
    expect(session.mode).toBe("ask");
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.send", {
          sessionId: id,
          text: "Edit the board",
        }),
      session.id,
    );
    const get = () =>
      page.evaluate(
        async (id) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
        session.id,
      );
    await expect.poll(async () => (await get()).snapshot.status).toBe("awaiting_approval");
    const a = (await get()).snapshot.approvals.at(-1);
    expect(a).toBeDefined();
    if (!a) throw Error("Approval is missing.");
    const conflict = await page.evaluate(
      async ({ id, a }) => {
        try {
          await (window as unknown as { vera: VeraBridge }).vera.invoke("session.approval.decide", {
            sessionId: id,
            approvalId: a.approvalId,
            requestSha256: "0".repeat(64),
            decision: "approved",
          });
          return null;
        } catch (e) {
          return e;
        }
      },
      { id: session.id, a },
    );
    expect(conflict).toMatchObject({ code: "CONFLICT" });
    await page.evaluate(
      async ({ id, a }) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.approval.decide", {
          sessionId: id,
          approvalId: a.approvalId,
          requestSha256: a.requestSha256,
          decision: "approved",
          switchToAutoEdit: true,
        }),
      { id: session.id, a },
    );
    await expect.poll(async () => (await get()).snapshot.activeTurnId).toBeNull();
    expect((await get()).snapshot.mode).toBe("auto-edit");
    expect(await readFile(join(folder, "board-notes.md"), "utf8")).toContain("Device under test (reviewed)");
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.mode.set", {
          sessionId: id,
          mode: "ask",
        }),
      session.id,
    );
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.send", {
          sessionId: id,
          text: "Edit the board",
        }),
      session.id,
    );
    await expect.poll(async () => (await get()).snapshot.status).toBe("awaiting_approval");
    const before = await readFile(join(folder, "board-notes.md"));
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.mode.set", {
          sessionId: id,
          mode: "read-only",
        }),
      session.id,
    );
    await expect.poll(async () => (await get()).snapshot.activeTurnId).toBeNull();
    expect((await get()).snapshot.approvals.at(-1)?.decision).toBe("aborted");
    expect(await readFile(join(folder, "board-notes.md"))).toEqual(before);
    expect(await outboundAttempts(rig.app)).toEqual([]);
  } finally {
    await rig.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser approval keys and mode picker remain accessible at minimum size", async ({ page, context }) => {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("Missing renderer configuration");
  const server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  const attempts: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      attempts.push(route.request().url());
      await route.abort();
    }
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("Missing renderer address");
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto(`http://127.0.0.1:${address.port}/?mock=chat`);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="open-recent"]').click();
    await page.locator('[data-action="new-session"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    await page.getByRole("combobox", { name: "Permission mode" }).selectOption("ask");
    await input.fill("Edit notes");
    await input.press("Enter");
    const card = page.locator("[data-approval-card]");
    await expect(card).toBeVisible();
    await expect(input).toBeDisabled();
    await card.focus();
    await card.press("D");
    await expect(input).toBeEnabled();
    await input.fill("Edit notes again");
    await input.press("Enter");
    const latest = page.locator("[data-approval-card]").last();
    await latest.getByRole("button", { name: "Approve and switch to auto-edit", exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(page.getByRole("combobox", { name: "Permission mode" })).toHaveValue("auto-edit");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(attempts).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("approval-browser-minimum.png") });
  } finally {
    await server.close();
  }
});
