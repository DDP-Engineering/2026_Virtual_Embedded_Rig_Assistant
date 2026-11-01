// REQ-FUNC-a7ad5920 REQ-UX-33b9d601 REQ-UX-bb147586

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("marked Bypass selectors display dismissible warning and remember its suppression", async ({ page }) => {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("Missing renderer config");
  const server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  try {
    await server.listen();
    const addr = server.httpServer?.address();
    if (!addr || typeof addr === "string") throw Error("Missing renderer address");
    await page.goto(`http://127.0.0.1:${addr.port}/?mock=chat`);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Bypass bench");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!sessionId) throw Error("Missing browser session");
    const picker = page.locator(".composer [data-permission-picker]");
    await expect(page.locator('.composer option[value="bypass"]')).toHaveCount(1);
    for (const [language, phrase] of [
      ["ro", "în afara workbenchului"],
      ["de", "außerhalb der Workbench"],
      ["en", "outside the workbench"],
    ]) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="language"]').click();
      await page.locator("#language").selectOption(language as string);
      if (language === "de") {
        await page.setViewportSize({ width: 1024, height: 640 });
        await page.locator('[data-section="appearance"]').click();
        await page.locator('[data-theme-option="dark"]').click();
        await page.locator("#interface-font-size").selectOption("1.5");
      }
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator(`[data-session="${sessionId}"]`).click();
      await picker.selectOption("bypass");
      await expect(page.locator(".bypass-warning")).toContainText(phrase as string);
      const bounds = await page.locator(".bypass-warning").boundingBox();
      const viewport = page.viewportSize();
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
      await page.keyboard.press("Escape");
      await picker.selectOption("ask");
    }
    await picker.selectOption("bypass");
    const warning = page.locator(".bypass-warning");
    await expect(warning).toBeVisible();
    await expect(warning.getByRole("button")).toHaveCount(1);
    await expect(warning).toContainText("outside the workbench");
    await expect(picker).toHaveClass(/bypass-selected/);
    await page.locator('[data-action="close-bypass-warning"]').click();
    await expect(picker).toBeFocused();
    await picker.selectOption("ask");
    await picker.selectOption("bypass");
    await expect(warning).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(warning).toBeHidden();
    await picker.selectOption("ask");
    await picker.selectOption("bypass");
    await page.locator('[data-action="close-bypass-warning"]').click();
    await expect(warning).toBeHidden();
    await picker.selectOption("ask");
    await picker.selectOption("bypass");
    await page.locator("[data-hide-bypass-warning]").check();
    await page.locator('[data-action="close-bypass-warning"]').click();
    await picker.selectOption("ask");
    await picker.selectOption("bypass");
    await expect(picker).toHaveValue("bypass");
    await expect(warning).toBeHidden();
  } finally {
    await server.close();
  }
});

test("native full filesystem Bypass executes outside tools and remembers mode and warning preference across restart", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-bypass-ui-"));
  const folder = join(root, "bench"),
    outside = join(root, "outside"),
    scripts = join(root, "scripts");
  await mkdir(folder);
  await mkdir(outside);
  await mkdir(scripts);
  const path = join(outside, "notes.txt");
  await writeFile(path, "old external FIND_ME\n");
  await writeFile(
    join(scripts, "bypass.jsonl"),
    [
      {
        match: "Access external",
        toolCalls: [
          { name: "read", args: { path } },
          { name: "list", args: { path: outside } },
          { name: "glob", args: { path: outside, pattern: "**/*.txt" } },
          { name: "grep", args: { path: outside, pattern: "FIND_ME" } },
        ],
      },
      { toolCalls: [{ name: "edit", args: { path, oldString: "old", newString: "new" } }] },
      {
        toolCalls: [
          { name: "write", args: { path: join(outside, "created.txt"), content: "created by Bypass" } },
        ],
      },
      { toolCalls: [{ name: "write", args: { path: ".vera/bypass-owned.txt", content: "owned metadata" } }] },
      { text: "External operations completed" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_TEST_DIALOG_PATH = folder;
  env.VERA_REPLAY_DIR = scripts;
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
      env,
    });
  let app = await launch();
  try {
    await installNetworkGuard(app);
    let page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Bypass bench");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="agent"]').click();
    await page.locator(".workbench-editor [data-permission-picker]").selectOption("bypass");
    await expect(page.locator(".bypass-warning")).toContainText("outside the workbench");
    if (process.env.VERA_BYPASS_SCREENSHOT)
      await page.screenshot({ path: process.env.VERA_BYPASS_SCREENSHOT });
    await page.locator('[data-action="close-bypass-warning"]').click();
    await expect(page.locator(".workbench-editor [data-permission-picker]")).toBeFocused();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).toHaveCount(0);
    await page.locator('[data-action="new-session"]').click();
    let picker = page.locator(".composer [data-permission-picker]");
    await expect(picker).toHaveValue("bypass");
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session id");
    await picker.selectOption("ask");
    await picker.selectOption("bypass");
    await page.locator("[data-hide-bypass-warning]").check();
    await page.locator('[data-action="close-bypass-warning"]').click();
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
          sessionId: id,
          modelRef: "replay/bypass",
        }),
      id,
    );
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("Access external files using the enabled tools");
    await message.press("Enter");
    await expect(page.locator("[data-transcript]")).toContainText("External operations completed");
    const view = await page.evaluate(
      async (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      id,
    );
    expect(view.snapshot.mode).toBe("bypass");
    const toolRows = view.snapshot.items.filter((item) => item.kind === "tool");
    expect(toolRows).toHaveLength(7);
    for (const row of toolRows) expect(row).toMatchObject({ status: "ok" });
    for (const approval of view.snapshot.approvals) expect(approval.decision).toBe("approved");
    expect(await readFile(path, "utf8")).toBe("new external FIND_ME\n");
    expect(await readFile(join(outside, "created.txt"), "utf8")).toBe("created by Bypass");
    expect(await readFile(join(folder, ".vera/bypass-owned.txt"), "utf8")).toBe("owned metadata");
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator(`[data-session="${id}"]`).click();
    picker = page.locator(".composer [data-permission-picker]");
    await expect(picker).toHaveValue("bypass");
    await picker.selectOption("ask");
    await picker.selectOption("bypass");
    await expect(page.locator(".bypass-warning")).toBeHidden();
    await expect(picker).toHaveClass(/bypass-selected/);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
