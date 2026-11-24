import { test } from "./fixtures.js";
// REQ-FUNC-a7ad5920 REQ-UX-33b9d601 REQ-UX-bb147586

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect } from "@playwright/test";
import { builtinToolNames, type VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";
import { saveSettings } from "./settings-navigation.js";

test("marked Bypass selectors confirm each change and cancellation retains the previous mode", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  test.setTimeout(60000);
  await page.goto(`${rendererUrl}/?mock=chat`);
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
    ["ro", "în afara workbench-ului"],
    ["de", "außerhalb des Workbenchs"],
    ["en", "outside the workbench"],
    ["fr", "hors du banc de travail"],
  ]) {
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#language").selectOption(language as string);
    await saveSettings(page);
    if (language === "de") {
      await page.setViewportSize({ width: 1024, height: 640 });
      await page.locator('[data-section="appearance"]').click();
      await page.locator('[data-theme-option="dark"]').click();
      await page.locator("#interface-font-size").selectOption("1.5");
      await saveSettings(page);
    }
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator(`[data-session="${sessionId}"]`).click();
    await picker.selectOption("bypass");
    await expect(page.locator(".bypass-warning")).toContainText(phrase as string);
    const bounds = await page.locator(".bypass-warning").boundingBox();
    const viewport = page.viewportSize();
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
    await expect(picker).toHaveValue("ask");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveValue("ask");
    await expect(picker).toBeFocused();
  }
  await picker.selectOption("bypass");
  const warning = page.locator(".bypass-warning");
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("button")).toHaveCount(2);
  await expect(picker).toHaveValue("ask");
  await page.locator('[data-action="cancel-bypass"]').click();
  await expect(picker).toHaveValue("ask");
  await expect(picker).toBeFocused();
  for (const prior of ["ask", "auto-edit"]) {
    await picker.selectOption(prior);
    await picker.selectOption("bypass");
    await expect(warning).toHaveCount(1);
    await expect(picker).toHaveValue(prior);
    await page.locator('[data-action="confirm-bypass"]').click();
    await expect(picker).toHaveValue("bypass");
    await expect(warning).toBeHidden();
    await expect(picker).toHaveClass(/bypass-selected/);
    await expect(picker).toBeFocused();
  }

  await page.setViewportSize({ width: 1536, height: 900 });
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  await page.locator("#interface-font-size").selectOption("1");
  await saveSettings(page);
  await page.locator('[data-action="leave-settings"]').click();
  await page.locator(".workbench-group-name", { hasText: "Bypass bench" }).click();
  const files = page.locator("#tab-docs");
  if (!(await files.isVisible())) await page.locator('[data-toggle="right"]').click();
  await files.click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="agent"]').click();
  await expect(page.locator("#panel-docs")).toBeVisible();
  const form = page.locator(".workbench-agent-settings");
  await expect(form.locator("[data-session-launch] > button")).toBeVisible();
  const rows = await form.locator(":scope > label, :scope > [data-session-launch]").evaluateAll((elements) =>
    elements.map((element) => {
      const label = element.querySelector("span")?.getBoundingClientRect();
      const control = element.querySelector("input, select, button")?.getBoundingClientRect();
      if (!label || !control) throw Error("Missing settings label or control");
      return { labelRight: label.right, controlLeft: control.left, top: control.top };
    }),
  );
  await expect(form.locator(".workbench-question-toggle input")).toBeVisible();
  expect(rows).toHaveLength(5);
  expect(
    rows.every(({ labelRight, controlLeft }) => labelRight < controlLeft),
    JSON.stringify(rows),
  ).toBe(true);
  expect(rows.map(({ controlLeft }) => controlLeft)).toEqual(Array(5).fill(rows[0]?.controlLeft));
  expect(rows.every(({ top }, index) => index === 0 || top > (rows[index - 1]?.top ?? 0))).toBe(true);
});

test("native Bypass refuses application-data reads and writes and confirms each mode change across restart", async () => {
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
      { toolCalls: [{ name: "read", args: { path: join(root, "profile/settings.json") } }] },
      {
        toolCalls: [
          { name: "write", args: { path: join(root, "profile/forbidden.txt"), content: "forbidden" } },
        ],
      },
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
    await page.locator('[data-action="confirm-bypass"]').click();
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
    await page.locator('[data-action="confirm-bypass"]').click();
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
          sessionId: id,
          modelRef: "replay/bypass",
        }),
      id,
    );
    // Keep the replay's context focused on the file operations exercised by this scenario.
    await page.evaluate(
      async (disabled) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.config.update", {
          patch: { tools: { disabled } },
        }),
      builtinToolNames.filter((name) => !["read", "list", "glob", "grep", "edit", "write"].includes(name)),
    );
    const settingsBefore = await readFile(join(root, "profile/settings.json"), "utf8");
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
    expect(toolRows).toHaveLength(9);
    for (const row of toolRows.slice(0, 7)) expect(row).toMatchObject({ status: "ok" });
    for (const row of toolRows.slice(7)) {
      expect(row).toMatchObject({ status: "error" });
      expect(JSON.stringify(row)).toContain("VERA application data");
    }
    expect(await readFile(join(root, "profile/settings.json"), "utf8")).toBe(settingsBefore);
    await expect(stat(join(root, "profile/forbidden.txt"))).rejects.toMatchObject({ code: "ENOENT" });
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
    await expect(page.locator(".bypass-warning")).toHaveCount(1);
    await expect(picker).toHaveValue("ask");
    await page.locator('[data-action="cancel-bypass"]').click();
    await expect(picker).toHaveValue("ask");
    await picker.selectOption("bypass");
    await page.locator('[data-action="confirm-bypass"]').click();
    await expect(picker).toHaveClass(/bypass-selected/);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
