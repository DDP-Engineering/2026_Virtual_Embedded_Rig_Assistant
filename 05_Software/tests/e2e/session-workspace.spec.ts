import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("compact composer grows, caps, shrinks and keeps context/activity on demand at desktop widths", async ({
  page,
}) => {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("Renderer configuration missing");
  const server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await server.listen();
    const addr = server.httpServer?.address();
    if (!addr || typeof addr === "string") throw Error("Renderer address missing");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${addr.port}/?mock=chat`);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Layout bench");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    const timestamp = page.locator('[data-session][aria-current="page"] time');
    await expect(timestamp).toBeVisible();
    await expect(timestamp).toHaveAttribute("datetime", /T/);
    await expect(timestamp).toHaveAttribute("title", /^Last activity: /);
    await expect(page.locator('[data-session][aria-current="page"] [data-session-status]')).toHaveClass(
      "sr-only",
    );
    await expect(page.locator(".session-workspace").getByRole("button", { name: /Export/ })).toHaveCount(0);
    await expect(page.locator("[data-usage]")).toHaveCount(0);
    const height = () => input.evaluate((node) => node.getBoundingClientRect().height);
    const initial = await height();
    await input.fill("Detailed request\n".repeat(8));
    await expect.poll(height).toBeGreaterThan(initial);
    await input.fill("Detailed request\n".repeat(80));
    expect(await height()).toBeLessThanOrEqual(316);
    expect(await input.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await input.fill("Short");
    await expect.poll(height).toBeLessThan(initial + 5);
    const context = page.locator('[data-action="show-context"]');
    await context.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").locator("[data-usage]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(context).toBeFocused();
    await expect(page.locator("[data-usage]")).toHaveCount(0);
    await page.locator('[data-action="show-activity"]').click();
    await expect(page.getByRole("dialog")).toContainText("No activity yet");
    await page.locator('[data-action="close-inspector"]').click();
    for (const width of [1280, 760]) {
      await page.setViewportSize({ width, height: 720 });
      await expect(input).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const bounds = await page.locator(".composer").boundingBox();
      expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await input.fill("");
    const current = page.locator('[data-session][aria-current="page"]');
    const row = current.locator("..");
    await row.locator("summary").click();
    await expect(row.getByRole("button", { name: "Export Markdown", exact: true })).toBeVisible();
    await row.locator('[data-action="archive-session"]').click();
    const archived = page.locator(".archived-sessions");
    await expect(archived.locator("[data-session]")).toHaveCount(1);
    await archived.locator(".session-options summary").click();
    await archived.locator('[data-action="restore-session"]').click();
    await expect(archived).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});

test("native session exposes live tools/context and durable sidebar archive without replacing history", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-session-workspace-"));
  const folder = join(root, "board");
  await mkdir(folder);
  await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = resolve("tests/fixtures/llm-scripts");
  env.VERA_REPLAY_DELAY_MS = "50";
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
      await (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.create", {
        folder,
        name: "Native layout",
      });
    }, folder);
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!id) throw Error("Missing session identity");
    await page.evaluate(
      async (id) =>
        (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
          sessionId: id,
          modelRef: "replay/read-then-answer",
        }),
      id,
    );
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Read the board");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    await page.locator('[data-action="show-activity"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-activity-kind="tool"]')).toHaveCount(2);
    await dialog.locator('[data-activity-kind="tool"] button').last().click();
    await expect(dialog).toContainText("board.txt");
    await expect(dialog).toContainText("3.3 V");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-action="show-activity"]')).toBeFocused();
    await expect
      .poll(async () =>
        page.evaluate(
          async (id) =>
            (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }))
              .snapshot.activeTurnId,
          id,
        ),
      )
      .toBeNull();
    const history = await page.locator("[data-transcript]").textContent();
    await page.locator('[data-action="show-context"]').click();
    await expect(page.getByRole("dialog").locator("[data-usage]")).toBeVisible();
    await page.locator('[data-action="close-inspector"]').click();
    await page.locator(`[data-session="${id}"]`).locator("..").locator("summary").click();
    await page.locator('[data-action="archive-session"]').click();
    await expect(page.locator(`.archived-sessions [data-session="${id}"]`)).toBeVisible();
    await page.reload();
    const archivedRow = page.locator(`.archived-sessions [data-session="${id}"]`).locator("..");
    await expect(archivedRow).toBeVisible();
    await archivedRow.locator("summary").click();
    await archivedRow.locator('[data-action="restore-session"]').click();
    await expect(page.locator(`.archived-sessions [data-session="${id}"]`)).toHaveCount(0);
    await page.locator(`[data-session="${id}"]`).click();
    await expect(page.locator("[data-transcript]")).toHaveText(history ?? "");
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
