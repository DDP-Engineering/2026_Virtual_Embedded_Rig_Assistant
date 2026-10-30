// REQ-DATA-e31bdc18 REQ-UX-bc9adf3a
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native activity retains per-prompt tokens and initial context through tools, later prompts and restart", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-prompt-usage-"));
  const folder = join(root, "bench"),
    scripts = join(root, "scripts");
  await mkdir(folder);
  await mkdir(scripts);
  await writeFile(join(folder, "board.txt"), "Board details for the activity fixture.\n");
  const scenario = async (input: number, output: number) =>
    writeFile(
      join(scripts, "usage.jsonl"),
      [
        { toolCalls: [{ name: "read", args: { path: "board.txt" } }], usage: { input, output } },
        { text: "Usage fixture answer", usage: { input: 200, output: 10 } },
      ]
        .map((step) => JSON.stringify(step))
        .join("\n"),
    );
  await scenario(120, 12);
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
    await page.locator("#workbench-name").fill("Usage bench");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
          sessionId: id,
          modelRef: "replay/usage",
        }),
      id,
    );
    const send = async (text: string, count: number) => {
      const editor = page.getByRole("textbox", { name: "Message", exact: true });
      await editor.fill(text);
      await editor.press("Enter");
      await expect
        .poll(async () => {
          const { snapshot } = await page.evaluate(
            async (id) =>
              (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
            id,
          );
          return (
            snapshot.status === "idle" &&
            snapshot.items.filter((i) => i.kind === "user").length === count &&
            snapshot.turns.length === count
          );
        })
        .toBe(true);
    };
    await send("First prompt", 1);
    const first = await page.evaluate(
      async (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      id,
    );
    expect(first.snapshot.items.find((i) => i.kind === "user")).toMatchObject({
      usage: { inputTokens: 320, outputTokens: 22, estimated: true },
    });
    await scenario(340, 27);
    await send("Second prompt with a little more detail", 2);
    const saved = await page.evaluate(
      async (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      id,
    );
    const users = saved.snapshot.items.filter((i) => i.kind === "user");
    expect(users[0]).toEqual(first.snapshot.items.find((i) => i.kind === "user"));
    expect(users[1]).toMatchObject({ usage: { inputTokens: 540, outputTokens: 37, estimated: true } });
    expect(users[1]?.usage?.contextTokens).toBeGreaterThan(users[0]?.usage?.contextTokens ?? 0);
    await page.locator('[data-action="show-activity"]').click();
    const lines = page.locator("[data-prompt-usage]");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText("320");
    await expect(lines.nth(1)).toContainText("540");
    await expect(lines.nth(0)).toContainText("≈");
    await page.locator('[data-action="close-inspector"]').click();
    for (const [language, label] of [
      ["ro", "Context inițial"],
      ["de", "Anfangskontext"],
    ]) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="language"]').click();
      await page.locator("#language").selectOption(language as string);
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator(`[data-session="${id}"]`).click();
      await page.locator('[data-action="show-activity"]').click();
      await expect(page.locator("[data-prompt-usage]").first()).toContainText(label as string);
      await page.setViewportSize({ width: 1024, height: 640 });
      const bounds = await page.locator("[data-prompt-usage]").first().boundingBox();
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(1024);
      if (language === "ro" && process.env.VERA_USAGE_SCREENSHOT)
        await page.screenshot({ path: process.env.VERA_USAGE_SCREENSHOT });
      await page.locator('[data-action="close-inspector"]').click();
    }
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="open-recent"]').click();
    await page.locator(`[data-session="${id}"]`).click();
    await page.locator('[data-action="show-activity"]').click();
    await expect(page.locator("[data-prompt-usage]").nth(0)).toContainText("320");
    await expect(page.locator("[data-prompt-usage]").nth(1)).toContainText("540");
    const restarted = await page.evaluate(
      async (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      id,
    );
    expect(restarted.snapshot.items.filter((i) => i.kind === "user")).toEqual(users);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
