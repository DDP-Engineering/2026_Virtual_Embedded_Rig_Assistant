import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const executable = join(
  desktop,
  "../../../node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

async function launch(userData: string): Promise<ElectronApplication> {
  expect(existsSync(join(desktop, "out/main/index.js")), "built desktop entrypoint").toBe(true);
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${userData}`],
    env: { ...environment, VERA_TEST: "1" },
  });
  await installNetworkGuard(app);
  return app;
}
/** Launch to a visible window, and to the rendered home heading. */
async function timedLaunch(userData: string) {
  const start = performance.now();
  const app = await launch(userData);
  const page = await app.firstWindow();
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false), {
      intervals: [5],
    })
    .toBe(true);
  const visible = performance.now() - start;
  await expect(page.getByRole("heading", { name: "VERA" })).toBeVisible();
  return { app, page, visible, home: performance.now() - start };
}

test("a credential file that fails to load still opens the window in the saved dark theme", async () => {
  const userData = await mkdtemp(join(tmpdir(), "vera-startup-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(userData);
    const first = await app.firstWindow();
    await expect(first.getByRole("heading", { name: "VERA" })).toBeVisible();
    const updated = await first.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", { theme: "dark" }),
    );
    expect(updated).toMatchObject({ settings: { theme: "dark" } });
    await app.close();
    const corrupt = "{not json";
    await writeFile(join(userData, "credentials.json"), corrupt);
    const started = await timedLaunch(userData);
    app = started.app;
    const settings = await started.page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(settings).toMatchObject({ settings: { theme: "dark" } });
    const background = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
    );
    expect(background?.toLowerCase()).toBe("#101316");
    await app.close();
    app = undefined;
    expect(readFileSync(join(userData, "credentials.json"), "utf8")).toBe(corrupt);
    const logs = join(userData, "logs");
    const text = readdirSync(logs)
      .map((file) => readFileSync(join(logs, file), "utf8"))
      .join("\n");
    expect(text).toContain("credentials.load.failed");
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});

// Opt-in timing: VERA_STARTUP_TIMING=1 npmw.py run test:e2e -- tests/e2e/startup.spec.ts
test("startup timing", async () => {
  test.skip(process.env.VERA_STARTUP_TIMING !== "1", "opt-in timing");
  test.setTimeout(180_000);
  const userData = await mkdtemp(join(tmpdir(), "vera-startup-timing-"));
  const runs: { run: string; visible: number; home: number }[] = [];
  try {
    for (const run of ["first", "warm-1", "warm-2", "warm-3"]) {
      const { app, visible, home } = await timedLaunch(userData);
      runs.push({ run, visible: Math.round(visible), home: Math.round(home) });
      await app.close();
    }
    console.log(JSON.stringify({ startup: runs }));
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});
