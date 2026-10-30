// REQ-UX-7c3fd9a6 REQ-UX-1676bc64
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

async function contained(page: Page, composer = true) {
  expect(
    await page.evaluate(() => {
      const root = document.scrollingElement as HTMLElement;
      return [root.scrollHeight <= window.innerHeight, root.scrollWidth <= window.innerWidth];
    }),
  ).toEqual([true, true]);
  const mainBounds = await page.locator("main").evaluate((node) => ({
    scroll: node.scrollHeight,
    height: node.clientHeight,
    children: [...node.children]
      .filter((child) => child.getBoundingClientRect().height > 0)
      .map((child) => ({
        class: child.className,
        y: child.getBoundingClientRect().y,
        height: child.getBoundingClientRect().height,
        scroll: child.scrollHeight,
        contents: [...child.children]
          .filter((item) => item.getBoundingClientRect().height > 0)
          .map((item) => ({
            class: item.className,
            top: item.getBoundingClientRect().y,
            height: item.getBoundingClientRect().height,
            scroll: item.scrollHeight,
          })),
      })),
  }));
  expect(mainBounds.scroll <= mainBounds.height, JSON.stringify(mainBounds)).toBe(true);
  for (const selector of [".topbar", ".sidebar-settings", ...(composer ? [".composer"] : [])]) {
    const box = await page.locator(selector).boundingBox();
    const viewport =
      page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    expect(box).toBeTruthy();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 1);
  }
}

test("fixed viewport and independent left conversation rail retain composer and reading position", async ({
  page,
}) => {
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
    if (!address || typeof address === "string") throw Error("Missing renderer address");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${address.port}/?mock=chat`);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Scroll bench");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!sessionId) throw Error("Missing session identity");
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    await expect(page.getByRole("scrollbar")).toBeHidden();
    await input.fill("A long request with enough lines to overflow the conversation.\n".repeat(100));
    await input.press("Enter");
    await expect(page.locator('[data-message-kind="assistant"]')).toHaveCount(1);
    await contained(page);
    const transcript = page.locator("[data-transcript]");
    const rail = page.getByRole("scrollbar", { name: "Scroll conversation" });
    await expect(rail).toBeVisible();
    expect(await transcript.evaluate((node) => getComputedStyle(node).scrollbarWidth)).toBe("none");
    const railBox = await rail.boundingBox();
    const messageBox = await page.locator(".transcript-item").first().boundingBox();
    expect((railBox?.x ?? 0) + (railBox?.width ?? 0)).toBeLessThanOrEqual(messageBox?.x ?? 0);
    await rail.focus();
    await page.keyboard.press("Home");
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBe(0);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const afterArrow = await transcript.evaluate((node) => node.scrollTop);
    await page.keyboard.press("PageDown");
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBeGreaterThan(afterArrow);
    await page.keyboard.press("PageUp");
    await expect
      .poll(() => transcript.evaluate((node) => node.scrollTop))
      .toBeLessThanOrEqual(afterArrow + 1);
    await page.keyboard.press("End");
    await expect(rail).toHaveAttribute("aria-valuenow", "100");
    const track = await rail.boundingBox();
    if (!track) throw Error("Missing rail");
    await rail.click({ position: { x: track.width / 2, y: track.height / 3 } });
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const thumb = await rail.locator("[data-scroll-thumb]").boundingBox();
    if (!thumb) throw Error("Missing thumb");
    const beforeDrag = await transcript.evaluate((node) => node.scrollTop);
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, track.y + track.height - 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeDrag);
    await rail.focus();
    await page.keyboard.press("Home");
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBe(0);
    await transcript.hover();
    await page.mouse.wheel(0, 160);
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const beforeTouch = await transcript.evaluate((node) => node.scrollTop);
    const chatBox = await transcript.boundingBox();
    if (!chatBox) throw Error("Missing transcript bounds");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const touchX = Math.round(chatBox.x + chatBox.width / 2);
    const touchY = Math.round(chatBox.y + chatBox.height / 2);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: touchX, y: touchY }],
    });
    for (let step = 1; step <= 5; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: touchX, y: touchY - step * 25 }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeTouch);
    await cdp.detach();
    const reading = await transcript.evaluate((node) => node.scrollTop);
    await input.fill("Another short question");
    await input.press("Enter");
    await expect(page.locator('[data-message-kind="assistant"]')).toHaveCount(2);
    expect(await transcript.evaluate((node) => node.scrollTop)).toBeCloseTo(reading, 0);
    await rail.focus();
    await page.keyboard.press("End");
    await input.fill("A third question while following the conversation");
    await input.press("Enter");
    await expect(page.locator('[data-message-kind="assistant"]')).toHaveCount(3);
    await expect(rail).toHaveAttribute("aria-valuenow", "100");
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="updates"]').click();
    await page.locator('[data-i18n="updates.check"]').click();
    await page.locator('[data-i18n="updates.download"]').click();
    await expect(page.locator("[data-update-banner]")).toBeVisible();
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator(`[data-session="${sessionId}"]`).click();
    await contained(page);
    if (process.env.VERA_SCROLL_SCREENSHOT)
      await page.screenshot({ path: `${process.env.VERA_SCROLL_SCREENSHOT}.normal.png` });
    for (const [width, scale] of [
      [1280, 1],
      [1024, 1.5],
    ] as const) {
      await page.setViewportSize({ width, height: 640 });
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="appearance"]').click();
      await page.locator("#interface-font-size").selectOption(String(scale));
      await page.locator('[data-action="reset-typography"]').scrollIntoViewIfNeeded();
      await contained(page, false);
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator(`[data-session="${sessionId}"]`).click();
      await input.fill("Multiline composer\n".repeat(80));
      await contained(page);
      await input.fill("");
      await expect(rail).toBeVisible();
    }
    if (process.env.VERA_SCROLL_SCREENSHOT)
      await page.screenshot({ path: process.env.VERA_SCROLL_SCREENSHOT });
    await page.locator('[data-action="new-session"]').click();
    await expect(page.getByRole("scrollbar")).toBeHidden();
  } finally {
    await server.close();
  }
});

test("native Electron confines long conversation scrolling to the session", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-scroll-native-"));
  const folder = join(root, "board");
  await mkdir(folder);
  await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\n");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = resolve("tests/fixtures/llm-scripts");
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: VeraBridge }).vera);
    await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("workbench.create", { folder, name: "Native scroll bench" });
    }, folder);
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session");
    await page.evaluate(async (id) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
        sessionId: id,
        modelRef: "replay/read-then-answer",
      });
    }, id);
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Native conversation question with multiple paragraphs.\n\n".repeat(80));
    await input.press("Enter");
    await expect(page.getByRole("scrollbar")).toBeVisible();
    await page.getByRole("scrollbar").focus();
    await page.keyboard.press("Home");
    await expect.poll(() => page.locator("[data-transcript]").evaluate((node) => node.scrollTop)).toBe(0);
    await input.fill("Native composer request\n".repeat(100));
    await contained(page);
    if (process.env.VERA_SCROLL_SCREENSHOT)
      await page.screenshot({ path: `${process.env.VERA_SCROLL_SCREENSHOT}.native.png` });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1024, 640));
    // Windows rounds the native non-client frame at fractional desktop DPI.
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1030);
    await contained(page);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
