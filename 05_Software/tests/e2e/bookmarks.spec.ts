// REQ-UX-94b2ef16 REQ-UX-88f317e2 REQ-REL-16690ed0
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const users = (page: Page) => page.locator('[data-message-kind="user"]');
const card = (page: Page) => page.locator("[data-nav-preview]");

async function preview(page: Page, index = 0) {
  const marker = page.locator('[data-nav-marker][data-nav-members="1"]').nth(index);
  await marker.focus();
  await expect(card(page)).toBeVisible();
  return marker;
}

test("browser bookmark controls reveal on hover/focus and localize the title/reply card", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  test.setTimeout(60000);

  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator('[data-action="new-session"]').click();
  const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
  for (let index = 0; index < 3; index++) {
    const input = page.locator(".composer textarea");
    await input.fill(`Question ${index + 1}\n${"Additional prompt line\n".repeat(18)}`);
    await input.press("Enter");
    await expect(users(page)).toHaveCount(index + 1);
    await expect(page.locator('[data-message-kind="assistant"]')).toHaveCount(index + 1);
    await expect(page.locator("[data-message-kind=assistant] [role=status]")).toHaveCount(0);
  }
  for (const [language, add, remove] of [
    ["en", "Bookmark", "Remove bookmark"],
    ["ro", "Marchează", "Elimină marcajul"],
    ["de", "Lesezeichen setzen", "Lesezeichen entfernen"],
    ["fr", "Ajouter un signet", "Retirer le signet"],
  ]) {
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#language").selectOption(language as string);
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator(`[data-session="${sessionId}"]`).click();
    const action = users(page).first().locator("[data-bookmark]");
    await action.scrollIntoViewIfNeeded();
    await page.locator(".composer textarea").focus();
    await page.mouse.move(1000, 10);
    await expect(action).toHaveCSS("opacity", "0");
    await users(page).first().hover();
    await expect(action).toHaveCSS("opacity", "1");
    await action.focus();
    await page.mouse.move(1000, 10);
    await expect(action).toHaveCSS("opacity", "1");
    await expect(action).toHaveAccessibleName(add as string);
    await action.press("Enter");
    await expect(action).toHaveAttribute("aria-pressed", "true");
    const marker = await preview(page);
    await expect(card(page).locator("strong")).toHaveText("Question 1");
    await expect(card(page)).not.toContainText("Additional prompt line");
    await expect(card(page)).not.toContainText("Message 1");
    await expect(card(page).locator("p")).not.toBeEmpty();
    await expect(card(page).getByRole("button")).toHaveCount(1);
    await expect(card(page).getByRole("button")).toHaveAccessibleName(remove as string);
    await marker.press("Tab");
    await expect(card(page).getByRole("button")).toBeFocused();
    await card(page).getByRole("button").press("Enter");
    await expect(action).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await expect(marker).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("native bookmarks persist after restart and archived sessions lock both controls", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-bkm02-"));
  const folder = join(root, "board");
  const replay = join(root, "replay");
  await mkdir(folder);
  await mkdir(replay);
  await writeFile(
    join(replay, "bookmarks.jsonl"),
    `${JSON.stringify({ text: "Agent reply starts here.\n\n".repeat(25) })}\n`,
  );
  const launch = async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.VERA_REPLAY_DIR = replay;
    const app = await _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
      chromiumSandbox: true,
      env,
    });
    await installNetworkGuard(app);
    return app;
  };
  let app = await launch();
  const invoke = <T>(page: Page, channel: string, payload: unknown) =>
    page.evaluate(
      async ({ channel, payload }) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke(
          channel as never,
          payload as never,
        ) as Promise<T>,
      { channel, payload },
    );
  try {
    let page = await app.firstWindow();
    await expect(page.locator('[data-i18n="nav.welcome"]')).toBeVisible();
    await invoke(page, "workbench.create", { folder, name: "Bookmarks" });
    await page.reload();
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    await invoke(page, "session.model.set", { sessionId: id, modelRef: "replay/bookmarks" });
    for (let index = 0; index < 3; index++) {
      await page.locator(".composer textarea").fill(`Native question ${index + 1}\nSecond line`);
      await page.locator(".composer textarea").press("Enter");
      await expect(users(page)).toHaveCount(index + 1);
      await expect
        .poll(
          async () =>
            (
              await invoke<{ snapshot: { activeTurnId: string | null } }>(page, "session.get", {
                sessionId: id,
              })
            ).snapshot.activeTurnId,
        )
        .toBeNull();
      const action = users(page).nth(index).locator("[data-bookmark]");
      await action.focus();
      await action.press("Enter");
      await expect(action).toHaveAttribute("aria-pressed", "true");
    }
    const marker = await preview(page);
    await expect(card(page).locator("strong")).toHaveText("Native question 1");
    await expect(card(page).locator("p")).toContainText("Agent reply starts here.");
    await marker.press("Tab");
    await card(page).getByRole("button").press("Enter");
    await expect(users(page).first().locator("[data-bookmark]")).toHaveAttribute("aria-pressed", "false");
    // The optimistic state changes at once; the control stays disabled until the request settles.
    await expect(card(page).getByRole("button")).toBeEnabled();
    await card(page).getByRole("button").press("Enter");
    await expect
      .poll(
        async () =>
          (
            await invoke<{ snapshot: { bookmarkedMessageIds: string[] } }>(page, "session.get", {
              sessionId: id,
            })
          ).snapshot.bookmarkedMessageIds.length,
      )
      .toBe(3);
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('[data-i18n="nav.welcome"]')).toBeVisible();
    await invoke(page, "workbench.open", { folder });
    await page.reload();
    await page.locator(`[data-session="${id}"]`).click();
    await expect(page.locator('[data-message-kind="user"] [data-bookmark][aria-pressed="true"]')).toHaveCount(
      3,
    );
    await invoke(page, "session.archive.set", { sessionId: id, archived: true });
    await expect(users(page).first().locator("[data-bookmark]")).toBeDisabled();
    await preview(page);
    await expect(card(page).getByRole("button")).toBeDisabled();
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
