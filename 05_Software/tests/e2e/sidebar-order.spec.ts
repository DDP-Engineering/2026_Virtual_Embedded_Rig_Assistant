// REQ-UX-ab0d5e61 REQ-FUNC-df70c1c8 REQ-FUNC-2b3ff3a8 REQ-FUNC-7871b582
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const executable = join(
  desktop,
  "../../../node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
async function launch(userData: string): Promise<ElectronApplication> {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${userData}`],
    env,
  });
  await installNetworkGuard(app);
  return app;
}
const benches = (page: Page) =>
  page.locator(".workbench-group-name").evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
const sessions = (page: Page) =>
  page
    .locator(".session-list > .session-entry [data-session] strong")
    .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
const group = (page: Page, name: string) =>
  page
    .locator("[data-workbench-entry]")
    .filter({ has: page.locator(".workbench-group-name", { hasText: name }) });

test("native sidebar reorders workbenches and sessions by menu and keyboard and keeps both orders after restart", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-sidebar-order-"));
  const folders = ["Alpha", "Beta", "Gamma"].map((name) => join(root, name));
  for (const folder of folders) await mkdir(folder);
  let app = await launch(join(root, "data"));
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Gamma is created last, so it is active and first; its sessions are listed newest first.
    await page.evaluate(async (folders) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      for (const [index, folder] of folders.entries())
        await api.invoke("workbench.create", { folder, name: ["Alpha", "Beta", "Gamma"][index] as string });
      for (const title of ["First", "Second", "Third"]) {
        const session = await api.invoke("session.create", {});
        await api.invoke("session.rename", { sessionId: session.id, title });
      }
    }, folders);
    await page.reload();
    await expect.poll(() => benches(page)).toEqual(["Gamma", "Beta", "Alpha"]);
    await expect.poll(() => sessions(page)).toEqual(["Third", "Second", "First"]);

    // Menu: Alpha up one place; the first entry cannot move up.
    await group(page, "Gamma").locator(".workbench-menu > summary").click();
    await expect(group(page, "Gamma").locator('[data-action="move-workbench-up"]')).toBeDisabled();
    await page.keyboard.press("Escape");
    await group(page, "Alpha").locator(".workbench-menu > summary").click();
    await group(page, "Alpha").locator('[data-action="move-workbench-up"]').click();
    await expect.poll(() => benches(page)).toEqual(["Gamma", "Alpha", "Beta"]);
    await expect(group(page, "Alpha").locator(".workbench-menu > summary")).toBeFocused();
    // Keyboard: Gamma down one place, focus stays on its row.
    const gamma = group(page, "Gamma").locator(".workbench-group-name");
    await gamma.focus();
    await page.keyboard.press("Alt+Shift+ArrowDown");
    await expect.poll(() => benches(page)).toEqual(["Alpha", "Gamma", "Beta"]);
    await expect(gamma).toBeFocused();

    // Sessions of the active workbench: First up by menu, then up again by keyboard.
    const first = page
      .locator(".session-entry")
      .filter({ has: page.locator("[data-session] strong", { hasText: "First" }) });
    await first.locator(".session-options > summary").click();
    await first.locator('[data-action="move-session-up"]').click();
    await expect.poll(() => sessions(page)).toEqual(["Third", "First", "Second"]);
    await expect(first.locator(".session-options > summary")).toBeFocused();
    await first.locator("[data-session]").focus();
    await page.keyboard.press("Alt+Shift+ArrowUp");
    await expect.poll(() => sessions(page)).toEqual(["First", "Third", "Second"]);
    await expect(first.locator("[data-session]")).toBeFocused();

    // Opening workbenches keeps their places.
    await group(page, "Beta").locator(".workbench-group-name").click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("Beta");
    await group(page, "Gamma").locator(".workbench-group-name").click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("Gamma");
    await expect.poll(() => benches(page)).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(errors).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);

    await app.close();
    app = await launch(join(root, "data"));
    page = await app.firstWindow();
    await expect.poll(() => benches(page)).toEqual(["Alpha", "Gamma", "Beta"]);
    await group(page, "Gamma").locator(".workbench-group-name").click();
    await expect.poll(() => sessions(page)).toEqual(["First", "Third", "Second"]);
    await page.screenshot({ path: test.info().outputPath("sidebar-order.png") });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
