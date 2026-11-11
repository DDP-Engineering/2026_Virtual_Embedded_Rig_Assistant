// REQ-DATA-4a830b9a REQ-UX-b94a613e REQ-UX-0165dafe REQ-UX-84087df1 REQ-UX-91b1b112
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { SessionState, VeraBridge } from "@vera/shared";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
async function rig(delay = 0) {
  const root = await mkdtemp(join(tmpdir(), "vera-chat-detail-")),
    folder = join(root, "Board ă");
  await mkdir(folder);
  await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  await writeFile(join(folder, "00-good.txt"), "ok");
  await writeFile(join(folder, "99-bad.txt"), `${"a".repeat(30000)}!`);
  const launch = async () => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.VERA_REPLAY_DIR = join(desktop, "../../../tests/fixtures/llm-scripts");
    env.VERA_REPLAY_DELAY_MS = String(delay);
    env.VERA_TEST_DIALOG_PATH = folder;
    const app = await _electron.launch({
      executablePath: join(
        desktop,
        "../../../node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      chromiumSandbox: true,
      args: [desktop, `--user-data-dir=${join(root, "data")}`],
      env,
    });
    await installNetworkGuard(app);
    return app;
  };
  return { root, folder, launch };
}
async function create(page: Page, model: string) {
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Board");
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator('[data-action="new-session"]').click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
  const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
  expect(id).toBeTruthy();
  await page.evaluate(
    async ({ id, model }) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
        sessionId: id,
        modelRef: model,
      });
    },
    { id: id as string, model },
  );
  return id as string;
}
async function snapshot(page: Page, id: string): Promise<SessionState> {
  return page.evaluate(
    async (id) =>
      (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }))
        .snapshot,
    id,
  );
}

const invoke = <T>(page: Page, channel: string, payload: unknown) =>
  page.evaluate(
    async ({ channel, payload }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, payload as never),
    { channel, payload },
  ) as Promise<T>;
async function edit(page: Page) {
  const { config } = await invoke<{ config: { id: string } }>(page, "workbench.config.get", {});
  await page.locator(`[data-workbench-entry="${config.id}"] .workbench-group-name`).click();
  await page.locator('[data-action="edit-workbench-overview"]').click();
  await page.locator('[data-project-section="chat"]').click();
}
async function detail(page: Page, id: string, level: string) {
  await edit(page);
  await page.locator("[data-chat-detail] select, select[data-chat-detail]").selectOption(level);
  await page.locator("[data-project-save]").click();
  await expect(page.locator(".workbench-editor")).toHaveCount(0);
  await page.locator(`[data-session="${id}"]`).click();
  await expect(page.locator(".transcript-frame")).toHaveAttribute("data-chat-detail", level);
}
test("native chat detail save, cancel, ordered projection, full Activity and restart isolation", async () => {
  test.setTimeout(90000);
  const host = await rig();
  let app = await host.launch();
  try {
    let page = await app.firstWindow();
    const id = await create(page, "replay/read-then-answer");
    await expect(page.locator(".transcript-frame")).toHaveAttribute("data-chat-detail", "normal");
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Read the board");
    await input.press("Enter");
    await expect.poll(async () => (await snapshot(page, id)).activeTurnId).toBeNull();
    await expect(page.locator("[data-tool-group]")).toHaveCount(1);
    const group = page.locator("[data-tool-group]").locator("button").first();
    await expect(group).toContainText("Operations: 2");
    await expect(page.locator('[data-tool-row="read"]')).toBeHidden();
    await group.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-tool-row="read"]')).toBeVisible();
    const state = await snapshot(page, id);
    await detail(page, id, "minimal");
    await expect(page.locator("[data-tool-row]")).toHaveCount(0);
    await expect(page.locator('[data-message-kind="assistant"]')).toContainText("3.3 V");
    await page.locator('[data-action="show-activity"]').click();
    await expect(page.locator('[data-agent-activity] [data-activity-kind="tool"]')).toHaveCount(2);
    await page.keyboard.press("Escape");
    await edit(page);
    await page.locator("select[data-chat-detail]").selectOption("verbose");
    await page.locator("[data-project-cancel]").first().click();
    await page.locator(`[data-session="${id}"]`).click();
    await expect(page.locator(".transcript-frame")).toHaveAttribute("data-chat-detail", "minimal");
    await detail(page, id, "verbose");
    await expect(page.locator("[data-tool-row]")).toHaveCount(2);
    await expect(page.locator('[data-tool-row="read"]')).toBeVisible();
    expect(await snapshot(page, id)).toEqual(state);
    const yaml = await readFile(join(host.folder, ".vera/workbench.yaml"), "utf8");
    expect(yaml).toContain("detail: verbose");
    // A second current-format workbench has its own default; opening it does not alter the first.
    const other = join(host.root, "Other");
    await mkdir(other);
    const second = await invoke<{ config: { chat: { detail: string } } }>(page, "workbench.create", {
      folder: other,
      name: "Other",
    });
    expect(second.config.chat.detail).toBe("normal");
    await invoke(page, "workbench.open", { folder: host.folder });
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await host.launch();
    page = await app.firstWindow();
    await page.locator('[data-action="open-workbench-nav"]').click();
    await page.locator(`[data-session="${id}"]`).click();
    await expect(page.locator(".transcript-frame")).toHaveAttribute("data-chat-detail", "verbose");
    expect(await snapshot(page, id)).toEqual(state);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(host.root, { recursive: true, force: true });
  }
});
test("native Minimal keeps exact Ask approval and Stop usable", async () => {
  test.setTimeout(60000);
  const host = await rig(80),
    app = await host.launch();
  try {
    const page = await app.firstWindow(),
      id = await create(page, "replay/edit-approve");
    await detail(page, id, "minimal");
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Edit the board");
    await input.press("Enter");
    const card = page.locator("[data-approval-card]");
    await expect(card).toBeVisible();
    await expect(card).toContainText("5 V");
    expect(await readFile(join(host.folder, "board.txt"), "utf8")).toContain("3.3 V");
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(async () => (await snapshot(page, id)).activeTurnId).toBeNull();
    expect(await readFile(join(host.folder, "board.txt"), "utf8")).toContain("5 V");
    await invoke(page, "session.model.set", { sessionId: id, modelRef: "replay/ui-slow" });
    await input.fill("Slow answer");
    await input.press("Enter");
    await expect(page.locator("[data-chat-working]")).toBeVisible();
    await page.locator('[data-action="stop-session"]').click();
    await expect(page.locator("[data-chat-stopped]")).toBeVisible();
    await expect(page.locator("[data-chat-working]")).toHaveCount(0);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(host.root, { recursive: true, force: true });
  }
});

// REQ-UX-b94a613e
test("browser Chat detail stays usable in en/ro/de at minimum size and enlarged text", async ({ page }) => {
  test.setTimeout(60000);
  const resolved = await resolveConfig({ root: "src/apps/desktop" }, "serve", "development"),
    renderer = resolved.config?.renderer;
  if (!renderer) throw Error("renderer");
  const server = await createServer({
    ...renderer,
    define: { ...renderer.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...renderer.server, port: 0, strictPort: false, hmr: false },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await server.listen();
    const addr = server.httpServer?.address();
    if (!addr || typeof addr === "string") throw Error("address");
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto(`http://127.0.0.1:${addr.port}/?mock=chat`);
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    for (const language of ["en", "ro", "de"]) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="language"]').click();
      await page.locator("#language").selectOption(language);
      await page.locator('[data-section="appearance"]').click();
      await page.locator("#interface-font-size").selectOption("1.5");
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator('[data-action="edit-workbench-overview"]').click();
      await page.locator('[data-project-section="chat"]').click();
      const picker = page.locator("select[data-chat-detail]");
      await expect(picker).toHaveValue("normal");
      for (const theme of ["light", "dark"]) {
        // Theme-only visual matrix; persistence of preferences has its own acceptance.
        await page.locator("html").evaluate((html, value) => {
          html.dataset.theme = value;
        }, theme);
        for (const level of ["verbose", "normal", "minimal"]) {
          await picker.selectOption(level);
          await expect(page.locator("[data-project-save]")).toBeVisible();
          expect(await picker.evaluate((el) => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= innerWidth &&
                document.documentElement.scrollHeight <= innerHeight,
            ),
          ).toBe(true);
        }
      }
      if (process.env.VERA_CHAT_SCREENSHOT && language === "ro")
        await page.screenshot({ path: process.env.VERA_CHAT_SCREENSHOT });
      await page.locator("[data-project-cancel]").first().click();
    }
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
