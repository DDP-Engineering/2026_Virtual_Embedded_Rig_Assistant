import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop");
const executable = join(
  desktop,
  "../../node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
async function launch(userData: string, folder: string) {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.VERA_TEST_DIALOG_PATH = folder;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${userData}`],
    env,
  });
  await installNetworkGuard(app);
  return app;
}
test("Welcome creates, restarts, reopens recent, edits pinned and closes with validated IPC", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp06-"));
  const folder = join(root, "Banc ă");
  await mkdir(folder);
  let app = await launch(join(root, "data"), folder);
  try {
    let page = await app.firstWindow();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator("#workbench-name").fill("VERA-DEMO-01");
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    expect(existsSync(join(folder, ".vera/lock"))).toBe(true);
    expect(existsSync(join(folder, ".vera/vera.db"))).toBe(true);
    expect(existsSync(join(folder, ".vera/backups/vera.db.v0.bak"))).toBe(true);
    await page.locator('[data-action="edit-pinned"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator("#pinned-content").fill("# VERA-DEMO-01\nFictional board context");
    await page.locator('[data-action="save-pinned"]').click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(await readFile(join(folder, "WORKBENCH.md"), "utf8")).toContain("Fictional board context");
    const ipc = await page.evaluate(async () => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const config = await api.invoke("workbench.config.get", {});
      const events: unknown[] = [];
      const stop = api.subscribe("workbench", config.config.id, (e) => events.push(e));
      await api.invoke("workbench.config.update", { patch: { description: "Demo" } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      stop();
      return {
        config: await api.invoke("workbench.config.get", {}),
        files: await api.invoke("workbench.files", { query: "WORKBENCH" }),
        events,
      };
    });
    expect(ipc.config.config.description).toBe("Demo");
    expect(ipc.files).toContain("WORKBENCH.md");
    expect(ipc.events).toContainEqual(expect.objectContaining({ type: "config.changed" }));
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    expect(existsSync(join(folder, ".vera/lock"))).toBe(false);
    app = await launch(join(root, "data"), folder);
    page = await app.firstWindow();
    await page.locator('[data-action="open-recent"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    await page.locator('[data-action="close-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toHaveCount(0);
    expect(existsSync(join(folder, ".vera/lock"))).toBe(false);
    await page.screenshot({ path: test.info().outputPath("welcome-recents.png") });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Welcome deleted recent is missing and can be removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp06-missing-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  let app = await launch(join(root, "data"), folder);
  try {
    let page = await app.firstWindow();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator("#workbench-name").fill("Deleted board");
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toBeVisible();
    await app.close();
    await rm(folder, { recursive: true });
    app = await launch(join(root, "data"), folder);
    page = await app.firstWindow();
    await expect(page.locator('[data-recent="missing"]')).toBeVisible();
    await expect(page.locator('[data-action="open-recent"]')).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath("missing-recent.png") });
    await page.locator('[data-action="remove-recent"]').click();
    await expect(page.locator('[data-recent="missing"]')).toHaveCount(0);
    const settings = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(settings.settings.recentWorkbenches).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Welcome opens copied demo with a live lock read-only and preserves owner bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp06-reader-"));
  const folder = join(root, "demo-board");
  await cp(join(desktop, "../../fixtures/workbenches/demo-board"), folder, { recursive: true });
  await mkdir(join(folder, ".vera"));
  const lock = JSON.stringify({ pid: process.pid, app: "0.0.0", since: "2026-10-11T00:00:00Z" });
  await writeFile(join(folder, ".vera/lock"), lock);
  const app = await launch(join(root, "data"), folder);
  try {
    const page = await app.firstWindow();
    await page.locator('[data-action="open-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("VERA-DEMO-01");
    const config = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.config.get", {}),
    );
    expect(config.config.id).toBe("wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C");
    await page.locator('[data-action="edit-pinned"]').click();
    await expect(page.locator("#pinned-content")).toHaveAttribute("readonly", "");
    await expect(page.locator('[data-action="save-pinned"]')).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.locator('[data-action="close-workbench"]').click();
    expect(await readFile(join(folder, ".vera/lock"), "utf8")).toBe(lock);
    expect(existsSync(join(folder, ".vera/vera.db"))).toBe(false);
    expect(await outboundAttempts(app)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("demo-readonly.png") });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
