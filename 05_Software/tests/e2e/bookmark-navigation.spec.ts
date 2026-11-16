// REQ-UX-f62a82bc REQ-UX-5722a63f REQ-UX-17662553
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const users = (page: Page) => page.locator('[data-message-kind="user"]');
const marked = (page: Page) =>
  page.locator('[data-message-kind="user"] [data-bookmark][aria-pressed="true"]');
const languages = [
  ["en", "Next bookmark", "Previous bookmark"],
  ["ro", "Marcajul următor", "Marcajul anterior"],
  ["de", "Nächstes Lesezeichen", "Vorheriges Lesezeichen"],
  ["fr", "Signet suivant", "Signet précédent"],
] as const;

async function mark(page: Page, index: number) {
  const action = users(page).nth(index).locator("[data-bookmark]");
  await action.focus();
  await action.press("Enter");
  await expect(action).toHaveAttribute("aria-pressed", "true");
}

async function navigate(page: Page, index: number, key: string) {
  await page.keyboard.press(key);
  await expect(users(page).nth(index)).toHaveAttribute("data-nav-highlight", "");
  await expect(page.locator("[data-nav-marker]:focus")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate((index) => {
        const view = document.querySelector<HTMLElement>("[data-transcript]");
        const article = document.querySelectorAll('[data-message-kind="user"]')[index];
        if (!view || !article) throw Error("Missing jump target");
        const y =
          article.getBoundingClientRect().top -
          view.getBoundingClientRect().top -
          view.clientTop +
          view.scrollTop;
        return Math.abs(
          view.scrollTop - Math.max(0, Math.min(y - 16, view.scrollHeight - view.clientHeight)),
        );
      }, index),
    )
    .toBeLessThan(2);
}

async function localizedNavigation(page: Page, id: string, indices: number[]) {
  for (const [language, next, previous] of languages) {
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#language").selectOption(language);
    await page.locator('[data-section="shortcuts"]').click();
    for (const [command, name, binding] of [
      ["nextBookmark", next, "Ctrl+Alt+N"],
      ["previousBookmark", previous, "Ctrl+Alt+P"],
    ]) {
      const row = page.locator(`[data-shortcut="${command}"]`);
      await expect(row.getByRole("heading")).toHaveText(name as string);
      await expect(row.locator("kbd")).toHaveText(binding as string);
      await expect(row.locator(".shortcut-binding button").first()).toBeEnabled();
    }
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator(`[data-session="${id}"]`).click();
    await expect(marked(page)).toHaveCount(3);
    await expect(page.locator("[data-nav-bookmarked]").first()).toBeVisible();
    await page.locator("[data-transcript]").evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event("scroll"));
    });
    await page.locator(".composer textarea").focus();
    for (const index of indices) await navigate(page, index, "Control+Alt+n");
    for (const index of indices.slice(0, -1).reverse()) await navigate(page, index, "Control+Alt+p");
  }
}

test("browser mock restart retains three long-session marks and localized bookmark navigation", async ({
  page: host,
  context,
}) => {
  test.setTimeout(120000);
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("Missing renderer config");
  const server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("Missing address");
    const url = `http://127.0.0.1:${address.port}/?mock=chat`;
    await host.goto(url);
    // Keep the mock backend alive in its own window while the tested renderer restarts.
    const moduleUrl = await host.evaluate(() =>
      [...performance.getEntriesByType("resource")]
        .map((entry) => entry.name)
        .find((name) => /mocks\/mockApi\.ts/.test(name)),
    );
    if (!moduleUrl) throw Error("Missing mock module");
    await host.evaluate(async (url) => {
      const module = await import(/* @vite-ignore */ url);
      (window as unknown as { bookmarkBackend: unknown }).bookmarkBackend = module.createMockApi().api;
    }, moduleUrl);
    await context.route(/\/api\/index\.ts(?:\?|$)/, async (route) => {
      if (route.request().frame().page() === host) return route.continue();
      await route.fulfill({
        contentType: "text/javascript",
        body: "export const usingMocks = true; export const api = window.opener.bookmarkBackend;",
      });
    });
    const popup = context.waitForEvent("page");
    await host.evaluate((url) => {
      window.open(url);
    }, url);
    const page = await popup;
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    for (let index = 0; index < 4; index++) {
      await page.locator(".composer textarea").fill(`Question ${index}\n${"Long prompt line\n".repeat(20)}`);
      await page.locator(".composer textarea").press("Enter");
      await expect(users(page)).toHaveCount(index + 1);
      await expect(page.locator("[data-message-kind=assistant] [role=status]")).toHaveCount(0);
    }
    await mark(page, 1);
    const sparse = await page.locator('[data-nav-bookmarked][data-nav-members="1"]').evaluate((node) => {
      const style = getComputedStyle(node, "::before");
      const ordinary = document.querySelector("[data-nav-marker]:not([data-nav-bookmarked])");
      if (!ordinary) throw Error("Missing ordinary marker");
      return {
        width: parseFloat(style.width),
        normal: parseFloat(getComputedStyle(ordinary, "::before").width),
        fill: style.backgroundColor,
        color: getComputedStyle(node).color,
      };
    });
    expect(sparse.width).toBeGreaterThan(sparse.normal);
    expect(sparse.fill).toBe(sparse.color);
    await page.locator(".composer textarea").fill("seed 80 messages");
    await page.locator(".composer textarea").press("Enter");
    await expect(users(page)).toHaveCount(85);
    await mark(page, 35);
    await mark(page, 65);
    await expect(marked(page)).toHaveCount(3);
    const group = page.locator('[data-nav-bookmarked]:not([data-nav-members="1"])').first();
    await expect(group).toBeVisible();
    const groupStyle = await group.evaluate((node) => {
      const style = getComputedStyle(node);
      const lane = node.parentElement?.getBoundingClientRect();
      return {
        fill: style.backgroundColor,
        color: style.color,
        width: node.getBoundingClientRect().width,
        lane: lane?.width ?? 0,
      };
    });
    expect(groupStyle.fill).not.toBe("rgba(0, 0, 0, 0)");
    expect(groupStyle.fill).not.toBe(groupStyle.color);
    expect(groupStyle.width).toBeGreaterThan(groupStyle.lane);
    await page.reload();
    await page.locator(`[data-session="${id}"]`).click();
    await localizedNavigation(page, id, [1, 35, 65]);
    await page.close();
  } finally {
    await server.close();
  }
});

test("native restart retains long-session marked groups and navigates in every language", async () => {
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), "vera-bkm03-"));
  const folder = join(root, "board");
  const replay = join(root, "replay");
  await mkdir(folder);
  await mkdir(replay);
  await writeFile(
    join(replay, "bookmarks.jsonl"),
    `${JSON.stringify({ text: "Agent reply.\n\n".repeat(12) })}\n`,
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
  const invoke = <T>(page: Page, channel: string, payload: unknown) =>
    page.evaluate(
      async ({ channel, payload }) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke(
          channel as never,
          payload as never,
        ) as Promise<T>,
      { channel, payload },
    );
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.locator('[data-i18n="nav.welcome"]')).toBeVisible();
    await invoke(page, "workbench.create", { folder, name: "Bookmark navigation" });
    await page.reload();
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    await invoke(page, "session.model.set", { sessionId: id, modelRef: "replay/bookmarks" });
    for (let index = 0; index < 34; index++) {
      await invoke(page, "session.send", { sessionId: id, text: `Native question ${index}` });
      await expect
        .poll(
          async () =>
            (
              await invoke<{ snapshot: { activeTurnId: string | null } }>(page, "session.get", {
                sessionId: id,
              })
            ).snapshot.activeTurnId,
          { intervals: [30, 80] },
        )
        .toBeNull();
    }
    await expect(users(page)).toHaveCount(34);
    for (const index of [4, 16, 28]) await mark(page, index);
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
    await expect(marked(page)).toHaveCount(3);
    await expect(page.locator('[data-nav-bookmarked]:not([data-nav-members="1"])').first()).toBeVisible();
    await localizedNavigation(page, id, [4, 16, 28]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
