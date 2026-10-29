import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("shortcut UI edits aliases, rejects conflicts, removes and resets, with isolated key capture", async ({
  page,
}) => {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("renderer config");
  const server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("server address");
    await page.goto(`http://127.0.0.1:${address.port}/?mock=chat`);
    await expect(page.locator("[data-empty-workbench]")).toBeVisible();
    await page.keyboard.press("Control+/");
    const section = page.locator('[data-settings-section="shortcuts"]');
    await expect(section).toBeVisible();
    const settings = section.locator('[data-shortcut="settings"]');
    await settings.getByRole("button", { name: "Edit Open settings: Ctrl+,", exact: true }).click();
    const recorder = page.getByRole("dialog");
    await recorder.getByRole("textbox").press("Control+n");
    await recorder.getByRole("button", { name: "Save", exact: true }).click();
    await expect(recorder.getByRole("alert")).toBeVisible();
    await recorder.getByRole("textbox").press("Control+Shift+p");
    await recorder.getByRole("textbox").press("Tab");
    await expect(recorder.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await recorder.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings.locator("kbd")).toHaveText("Ctrl+Shift+P");
    await page.locator('[data-action="leave-settings"]').click();
    await page.keyboard.press("Control+,");
    await expect(section).not.toBeVisible();
    await page.keyboard.press("Control+Shift+p");
    await expect(section).toBeVisible();
    const newSession = section.locator('[data-shortcut="newSession"]');
    await newSession.getByRole("button", { name: "Remove New session: Ctrl+N", exact: true }).click();
    await newSession.getByRole("button", { name: "Remove New session: Ctrl+Shift+O", exact: true }).click();
    await expect(newSession).toContainText("Unassigned");
    const create = section.locator('[data-shortcut="newWorkbench"]');
    await create.getByRole("button", { name: "Add shortcut: New workbench", exact: true }).click();
    await recorder.getByRole("textbox").press("Control+Shift+n");
    await recorder.getByRole("button", { name: "Save", exact: true }).click();
    await expect(create.locator("kbd")).toHaveText("Ctrl+Shift+N");
    await create.getByRole("button", { name: "Edit New workbench: Ctrl+Shift+N", exact: true }).click();
    await recorder.getByRole("textbox").evaluate((input) =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "!",
          code: "Digit1",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await expect(recorder.getByRole("textbox")).toHaveValue("Ctrl+Shift+1");
    await recorder.getByRole("button", { name: "Save", exact: true }).click();
    await expect(create.locator("kbd")).toHaveText("Ctrl+Shift+1");
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "!",
          code: "Digit1",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await expect(page.locator("#workbench-name")).toBeVisible();
    await page.keyboard.press("Control+/");
    await section.getByRole("searchbox").fill("model");
    await expect(section.locator("[data-shortcut]")).toHaveCount(1);
    await section.getByRole("button", { name: "Search by key combination", exact: true }).click();
    await expect(section.getByRole("searchbox")).toBeFocused();
    await page.keyboard.press("Control+Shift+p");
    await expect(section.locator("[data-shortcut]")).toHaveCount(1);
    await section.getByRole("searchbox").press("Escape");
    await section.getByRole("button", { name: "Restore all defaults", exact: true }).click();
    await expect(settings.locator("kbd")).toHaveText("Ctrl+,");
    await expect(newSession.locator("kbd")).toHaveCount(2);
    // Existing workbench editor owns keys, even an app navigation shortcut.
    await page.locator('[data-action="leave-settings"]').click();
    const wb = page.locator("[data-workbench-entry]").first();
    await wb.getByRole("button", { name: "VERA-DEMO-01", exact: true }).click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.keyboard.press("Control+/");
    await expect(page.locator(".workbench-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+b");
    await expect(page.locator('[data-toggle="sidebar"]')).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Control+b");
    await expect(page.locator('[data-toggle="sidebar"]')).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Control+/");
    await page.setViewportSize({ width: 1024, height: 640 });
    await expect(section).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.route("**/api/index.*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'import { createMockApi } from "/mocks/mockApi.ts"; const base = createMockApi().api; export const api = { ...base, getSettings: async () => ({ ...await base.getSettings(), readOnly: true }) };',
      }),
    );
    await page.reload();
    await expect(page.locator("[data-empty-workbench]")).toBeVisible();
    await page.keyboard.press("Control+/");
    await expect(
      section.getByRole("button", { name: "Edit Open settings: Ctrl+,", exact: true }),
    ).toBeDisabled();
    await expect(
      section.getByRole("button", { name: "Remove Open settings: Ctrl+,", exact: true }),
    ).toBeDisabled();
    await expect(section.getByRole("searchbox")).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});

test("native shortcut overrides survive restart and deleted bindings remain disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-shortcuts-"));
  const desktop = resolve("src/apps/desktop");
  const launch = async () => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({
      executablePath: resolve(
        `node_modules/electron/dist/${process.platform === "win32" ? "electron.exe" : "electron"}`,
      ),
      args: [desktop, `--user-data-dir=${root}`],
      env,
    });
    await installNetworkGuard(app);
    return app;
  };
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", { language: "en" }),
    );
    await expect(page.locator("[data-empty-workbench]")).toBeVisible();
    await page.keyboard.press("Control+/");
    const section = page.locator('[data-settings-section="shortcuts"]');
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: "Edit Open settings: Ctrl+,", exact: true }).click();
    await page.getByRole("dialog").getByRole("textbox").press("Control+Shift+p");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(section.locator('[data-shortcut="settings"] kbd')).toHaveText("Ctrl+Shift+P");
    await section.getByRole("button", { name: "Remove New session: Ctrl+N", exact: true }).click();
    await section.getByRole("button", { name: "Remove New session: Ctrl+Shift+O", exact: true }).click();
    await expect(section.locator('[data-shortcut="newSession"]')).toContainText("Unassigned");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator("[data-empty-workbench]")).toBeVisible();
    await page.keyboard.press("Control+,");
    await expect(page.locator(".settings-page")).not.toBeVisible();
    await page.keyboard.press("Control+Shift+p");
    await expect(page.locator(".settings-page")).toBeVisible();
    await page.keyboard.press("Control+/");
    await expect(page.locator('[data-settings-section="shortcuts"]')).toBeVisible();
    const saved = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.get", {}),
    );
    expect(saved.settings.keyboardShortcuts).toEqual({ settings: ["Mod+Shift+P"], newSession: [] });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
