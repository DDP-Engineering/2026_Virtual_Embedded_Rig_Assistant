// REQ-UX-1739d053 REQ-FUNC-9a6da7bb
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native sidebar has one action menu and New session atomically reuses unused rows across rapid clicks and restart", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-navigation-actions-"));
  const a = join(root, "a"),
    b = join(root, "b");
  await mkdir(a);
  await mkdir(b);
  await writeFile(join(a, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = resolve("tests/fixtures/llm-scripts");
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
    const initial = await page.evaluate(
      async ({ a, b }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        const first = await api.invoke("workbench.create", { folder: a, name: "Sidebar A" });
        const empty = await api.invoke("session.create", {
          modelRef: "replay/read-then-answer",
          mode: "auto-edit",
        });
        await api.invoke("session.rename", { sessionId: empty.id, title: "Named unused" });
        const used = await api.invoke("session.create", { modelRef: "replay/read-then-answer" });
        const finished = new Promise<void>((resolve) => {
          const off = api.subscribe("session", used.id, 0, (event) => {
            if (event.type === "turn.done") {
              off();
              resolve();
            }
          });
        });
        await api.invoke("session.send", { sessionId: used.id, text: "Read the board" });
        await finished;
        const second = await api.invoke("workbench.create", { folder: b, name: "Sidebar B" });
        const otherEmpty = await api.invoke("session.create", {});
        await api.invoke("workbench.open", { folder: a });
        return {
          first: first.config.id,
          second: second.config.id,
          empty: empty.id,
          used: used.id,
          otherEmpty: otherEmpty.id,
        };
      },
      { a, b },
    );
    await page.reload();
    const menus = page.locator(".session-options");
    const openMenus = page.locator(".workbench-menu[open],.session-options[open]");
    await expect(menus).toHaveCount(2);
    // Open the lower row first so its popup does not cover the next mouse target.
    await menus.nth(1).locator("summary").click();
    await expect(openMenus).toHaveCount(1);
    await menus.nth(0).locator("summary").click();
    await expect(menus.nth(1)).not.toHaveAttribute("open");
    await expect(openMenus).toHaveCount(1);
    const workbenchMenu = page.locator(`[data-workbench-entry="${initial.first}"] .workbench-menu`);
    await workbenchMenu.locator("summary").click();
    await expect(menus.nth(0)).not.toHaveAttribute("open");
    await expect(workbenchMenu).toHaveAttribute("open");
    await workbenchMenu.locator("summary").press("Escape");
    await expect(openMenus).toHaveCount(0);
    await expect(workbenchMenu.locator("summary")).toBeFocused();
    await menus.nth(0).locator("summary").focus();
    await menus.nth(0).locator("summary").press("Enter");
    await expect(menus.nth(0)).toHaveAttribute("open");
    await menus.nth(1).locator("summary").focus();
    await menus.nth(1).locator("summary").press("Space");
    await expect(menus.nth(1)).toHaveAttribute("open");
    await expect(openMenus).toHaveCount(1);
    await page.setViewportSize({ width: 1024, height: 768 });
    if (process.env.VERA_NAV_SCREENSHOT) await page.screenshot({ path: process.env.VERA_NAV_SCREENSHOT });
    await page.locator(".workbench-navigation > strong").click();
    await expect(openMenus).toHaveCount(0);
    const parallel = await page.evaluate(async (bench) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      return Promise.all(
        Array.from({ length: 15 }, () =>
          api.invoke("session.create", { workbenchId: bench, reuseEmpty: true }),
        ),
      );
    }, initial.first);
    expect(new Set(parallel.map((session) => session.id))).toEqual(new Set([initial.empty]));
    expect(parallel[0]).toMatchObject({
      title: "Named unused",
      mode: "auto-edit",
      modelRef: "replay/read-then-answer",
    });
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-action="new-session"]');
      for (let i = 0; i < 15; i++) button?.click();
    });
    await expect(page.locator(`[data-session="${initial.empty}"]`)).toHaveAttribute("aria-current", "page");
    const editor = page.locator("#chat-message");
    await expect(editor).toBeFocused();
    await editor.fill("Unsent draft");
    await page.locator('[data-action="new-session"]').click();
    await expect(editor).toHaveValue("Unsent draft");
    await expect(editor).toBeFocused();
    await page.keyboard.press("Control+n");
    await expect(editor).toHaveValue("Unsent draft");
    await expect(editor).toBeFocused();
    const count = () =>
      page.evaluate(async () => (window as unknown as { vera: VeraBridge }).vera.invoke("session.list", {}));
    expect(await count()).toHaveLength(2);
    await editor.fill("Read the board");
    await editor.press("Enter");
    await expect
      .poll(async () => {
        const { snapshot } = await page.evaluate(
          async (id) =>
            (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
          initial.empty,
        );
        return snapshot.status === "idle" && snapshot.turns.length === 1;
      })
      .toBe(true);
    const newBurst = await page.evaluate(async (bench) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const requests = Array.from({ length: 15 }, () =>
        api.invoke("session.create", { workbenchId: bench, reuseEmpty: true }),
      );
      const button = document.querySelector<HTMLButtonElement>('[data-action="new-session"]');
      for (let i = 0; i < 15; i++) button?.click();
      return Promise.all(requests);
    }, initial.first);
    expect(new Set(newBurst.map((session) => session.id)).size).toBe(1);
    await expect.poll(async () => (await count()).length).toBe(3);
    await expect(page.locator(`[data-session="${initial.empty}"]`)).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    const fresh = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    expect(fresh).toBe(newBurst[0]?.id);
    expect([initial.empty, initial.used, initial.otherEmpty]).not.toContain(fresh);
    await expect(editor).toHaveValue("");
    await expect(editor).toBeFocused();
    const rejected = await page.evaluate(async (id) => {
      try {
        await (window as unknown as { vera: VeraBridge }).vera.invoke("session.create", {
          workbenchId: id,
          reuseEmpty: true,
        });
        return null;
      } catch (error) {
        return (error as { code: string }).code;
      }
    }, initial.second);
    expect(rejected).toBe("CONFLICT");
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    // Opening no longer moves a workbench to the top (TASK-c99ca08c), so choose Sidebar A by name.
    await page.locator(".workbench-group-name", { hasText: "Sidebar A" }).click();
    await page.locator('[data-action="new-session"]').click();
    await expect(page.locator(`[data-session="${fresh}"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#chat-message")).toBeFocused();
    expect(await count()).toHaveLength(3);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
