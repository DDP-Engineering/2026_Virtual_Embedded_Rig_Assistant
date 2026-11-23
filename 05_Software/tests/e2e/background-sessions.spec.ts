// REQ-UX-18f96271 REQ-UX-9a0489f1 REQ-FUNC-1388cbcf REQ-FUNC-e117c80b REQ-UX-ec37f55b REQ-UX-c2a9fe24
// REQ-UX-4bb04608 REQ-UX-f20cb322
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, type Page } from "@playwright/test";
import type { SessionState, VeraBridge, WorkbenchSnapshot } from "@vera/shared";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

/** A reply streamed in 40-character chunks, one every VERA_REPLAY_DELAY_MS (250 ms): about `seconds` long. */
const long = (name: string, seconds: number) =>
  `${name} START ${"streamed background content. ".repeat(Math.ceil((seconds * 4 * 40) / 30))}${name} END`;

interface Bench {
  root: string;
  app: ElectronApplication;
  page: Page;
  a: WorkbenchSnapshot;
  b: WorkbenchSnapshot;
}

/** Native Desktop with replay scripts and workbenches A and B; A is shown. */
async function launch(prefix: string): Promise<Bench> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const scripts = join(root, "scripts");
  for (const folder of ["a", "b", "scripts"]) await mkdir(join(root, folder));
  for (const folder of ["a", "b"])
    await writeFile(join(root, folder, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  const script = (name: string, rows: object[]) =>
    writeFile(join(scripts, `${name}.jsonl`), rows.map((row) => JSON.stringify(row)).join("\n"));
  await script("long-a", [{ text: long("LONG A", 25) }]);
  await script("long-b", [{ text: long("LONG B", 10) }]);
  await script("long-stop", [{ text: long("LONG STOP", 60) }]);
  await script("long-c", [{ text: long("LONG C", 60) }]);
  await script("notice", [{ text: long("NOTIFICATION", 5) }]);
  await copyFile(
    resolve("tests/fixtures/llm-scripts/edit-approve.jsonl"),
    join(scripts, "edit-approve.jsonl"),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_REPLAY_DELAY_MS = "250";
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
    env,
  });
  await installNetworkGuard(app);
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as unknown as { vera?: unknown }).vera);
  const call = <T>(channel: string, payload: unknown) =>
    page.evaluate(
      ([channel, payload]) =>
        (window as unknown as { vera: { invoke(c: string, p: unknown): Promise<unknown> } }).vera.invoke(
          channel,
          payload,
        ),
      [channel, payload] as const,
    ) as Promise<T>;
  await call("app.settings.update", { language: "en" });
  const b = await call<WorkbenchSnapshot>("workbench.create", { folder: join(root, "b"), name: "Bench B" });
  const a = await call<WorkbenchSnapshot>("workbench.create", { folder: join(root, "a"), name: "Bench A" });
  await page.reload();
  await expect(page.locator('[data-i18n="nav.settings"]')).toBeVisible();
  await expect(name(page, a)).toHaveAttribute("aria-current", "page");
  return { root, app, page, a, b };
}
async function close({ app, root }: Bench) {
  await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
}
const heading = (page: Page, bench: WorkbenchSnapshot) =>
  page.locator(`[data-workbench-entry="${bench.config.id}"] > .workbench-group-heading`);
const name = (page: Page, bench: WorkbenchSnapshot) => heading(page, bench).locator(".workbench-group-name");
async function switchWorkbench(page: Page, bench: WorkbenchSnapshot) {
  await name(page, bench).click();
  await expect(name(page, bench)).toHaveAttribute("aria-current", "page");
  await expect(heading(page, bench).locator(".workbench-sessions-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

const activity = (page: Page, bench: WorkbenchSnapshot) =>
  heading(page, bench).locator(".workbench-activity");
const row = (page: Page, id: string) => page.locator(`[data-session="${id}"]`);
const read = (page: Page, sessionId: string) =>
  page.evaluate(
    (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
    sessionId,
  ) as Promise<{ snapshot: SessionState }>;
const answer = (state: SessionState) =>
  state.items.findLast((item) => item.kind === "assistant") as { text: string } | undefined;

/** Creates a session in the shown workbench with a replay model, sends `text` from the composer. */
async function start(page: Page, model: string, text: string, mode?: "ask") {
  const selected = '[data-session][aria-current="page"]';
  const previous = await page.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute("data-session") ?? null,
    selected,
  );
  await page.locator('[data-action="new-session"]').click();
  await page.waitForFunction(
    ({ selected, previous }) => {
      const id = document.querySelector(selected)?.getAttribute("data-session");
      return !!id && id !== previous;
    },
    { selected, previous },
  );
  const id = (await page.locator(selected).getAttribute("data-session")) as string;
  await page.evaluate(
    async ({ id, model, mode }) => {
      const vera = (window as unknown as { vera: VeraBridge }).vera;
      await vera.invoke("session.model.set", { sessionId: id, modelRef: `replay/${model}` });
      if (mode) await vera.invoke("session.mode.set", { sessionId: id, mode });
    },
    { id, model, mode },
  );
  await expect(page.locator("[data-model-picker]")).toHaveValue(`replay/${model}`);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill(text);
  await input.press("Enter");
  return id;
}
test("a completion notification restores the window and honors the editor guard across workbenches", async () => {
  test.setTimeout(120000);
  const bench = await launch("vera-session-notice-");
  const { app, page, a, b } = bench;
  try {
    await app.evaluate(({ dialog, Notification }) => {
      const native = { notices: [] as Electron.Notification[] };
      Object.assign(globalThis, { veraTestNativeNotices: native.notices });
      Notification.isSupported = () => true;
      Notification.prototype.show = function () {
        native.notices.push(this);
        this.emit("show");
      };
      dialog.showOpenDialog = () =>
        new Promise((resolve) => {
          Object.assign(globalThis, {
            veraTestCancelNoticePicker: () => resolve({ canceled: true, filePaths: [] }),
          });
        });
    });
    await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.settings.update", {
        notifications: { turnCompletion: "always" },
      }),
    );
    const notices = () =>
      app.evaluate(() =>
        (
          globalThis as unknown as { veraTestNativeNotices: Electron.Notification[] }
        ).veraTestNativeNotices.map(({ title, body, silent }) => ({ title, body, silent })),
      );
    const payload = { title: "VERA", body: "A reply is ready.", silent: true };
    const first = await start(page, "notice", "First completion notification");
    await expect.poll(notices, { timeout: 25000 }).toEqual([payload]);
    const second = await start(page, "notice", "Second completion notification");
    await switchWorkbench(page, b);
    await page.locator('[data-action="edit-workbench-overview"]').click();
    const draft = page.locator(".workbench-editor [data-project-name]");
    await draft.fill("Unsaved Bench B");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
    await expect.poll(notices, { timeout: 25000 }).toEqual([payload, payload]);
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized()))
      .toBe(true);
    const click = (index: number) =>
      app.evaluate((_electron, index) => {
        (globalThis as unknown as { veraTestNativeNotices: Electron.Notification[] }).veraTestNativeNotices[
          index
        ]?.emit("click");
      }, index);
    page.once("dialog", (dialog) => dialog.dismiss());
    await click(0);
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized()))
      .toBe(false);
    await expect(draft).toHaveValue("Unsaved Bench B");
    await expect(name(page, b)).toHaveAttribute("aria-current", "page");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-action="open-workbench-nav"]').click();
    await expect.poll(() => app.evaluate(() => "veraTestCancelNoticePicker" in globalThis)).toBe(true);
    await click(1);
    await expect(draft).toHaveValue("Unsaved Bench B");
    page.once("dialog", (dialog) => dialog.accept());
    await app.evaluate(() => {
      (globalThis as unknown as { veraTestCancelNoticePicker: () => void }).veraTestCancelNoticePicker();
    });
    await expect(name(page, a)).toHaveAttribute("aria-current", "page");
    await expect(row(page, second)).toHaveAttribute("aria-current", "page");
    await expect(row(page, first)).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByText("NOTIFICATION END", { exact: false })).toBeVisible();
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await close(bench);
  }
});

/** Presses `key` until the focused element matches `selector`. */
async function keyTo(page: Page, selector: string, key = "Tab", max = 80) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
    await page.keyboard.press(key);
  }
  throw Error(`Keyboard focus never reached ${selector}`);
}

test("A runs in the background while B runs; the sidebar follows both and both replies stay", async () => {
  test.setTimeout(180000);
  const bench = await launch("vera-background-a-b-");
  const { page, a, b } = bench;
  try {
    const sessionA = await start(page, "long-a", "Long answer A");
    await expect(row(page, sessionA).locator('[data-session-activity="running"]')).toBeVisible();
    await expect(activity(page, a)).toHaveAttribute("data-activity", "running");
    await expect(page.locator("[data-turn-capacity]")).toContainText("1/3");

    await switchWorkbench(page, b);
    // A keeps running in the background; its collapsed row shows it.
    await expect(heading(page, a).locator(".workbench-sessions-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(activity(page, a)).toHaveAttribute("data-activity", "running");
    await expect(activity(page, a).locator("summary")).toHaveAttribute(
      "aria-label",
      "Active sessions in Bench A: running 1, awaiting approval 0",
    );
    const sessionB = await start(page, "long-b", "Long answer B");
    await expect(row(page, sessionB).locator('[data-session-activity="running"]')).toBeVisible();
    await expect(activity(page, b)).toHaveAttribute("data-activity", "running");
    await expect(page.locator("[data-turn-capacity]")).toContainText("2/3");
    // B's shorter turn ends first: its marks go while A's stays.
    await expect(activity(page, b)).toHaveCount(0, { timeout: 60000 });
    await expect(row(page, sessionB).locator("[data-session-activity]")).toHaveCount(0);
    await expect(activity(page, a)).toHaveAttribute("data-activity", "running");
    await expect(page.locator("[data-transcript]")).toContainText("LONG B END");
    await expect(activity(page, a)).toHaveCount(0, { timeout: 60000 });
    await expect(page.locator("[data-turn-capacity]")).toHaveCount(0);

    // Back to either workbench, each session shows its own completed reply.
    await switchWorkbench(page, a);
    await row(page, sessionA).click();
    await expect(page.locator("[data-transcript]")).toContainText("LONG A END");
    await expect(page.locator("[data-transcript]")).not.toContainText("LONG B");
    expect(answer((await read(page, sessionA)).snapshot)?.text).toMatch(/^LONG A START.*LONG A END$/s);
    await switchWorkbench(page, b);
    await row(page, sessionB).click();
    await expect(page.locator("[data-transcript]")).toContainText("LONG B END");
    await expect(page.locator("[data-transcript]")).not.toContainText("LONG A");
    expect(await outboundAttempts(bench.app)).toEqual([]);
  } finally {
    await close(bench);
  }
});

test("Stop in the sidebar ends one background session, and a background approval opens in its session", async () => {
  test.setTimeout(180000);
  const bench = await launch("vera-background-stop-");
  const { page, a, b, root } = bench;
  try {
    const stopped = await start(page, "long-stop", "Long answer to stop");
    const approval = await start(page, "edit-approve", "Edit the board", "ask");
    await expect(page.locator("[data-approval-card]")).toBeVisible({ timeout: 30000 });
    await expect(row(page, approval).locator('[data-session-activity="awaiting_approval"]')).toBeVisible();
    await expect(row(page, stopped).locator('[data-session-activity="running"]')).toBeVisible();
    await switchWorkbench(page, b);
    const sessionB = await start(page, "long-c", "Long answer C");
    await expect(row(page, sessionB).locator('[data-session-activity="running"]')).toBeVisible();
    // B's own row collapses too; A (background, collapsed) shows one running and one waiting session.
    await heading(page, b).locator(".workbench-sessions-toggle").click();
    await expect(heading(page, b).locator(".workbench-sessions-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(activity(page, b)).toHaveAttribute("data-activity", "running");
    await expect(activity(page, a)).toHaveAttribute("data-activity", "awaiting_approval");
    await expect(activity(page, a).locator("summary")).toHaveAttribute(
      "aria-label",
      "Active sessions in Bench A: running 1, awaiting approval 1",
    );

    // Stop only A's running session from the sidebar, B still shown.
    await activity(page, a).locator("summary").click();
    await activity(page, a)
      .locator(`[data-activity-session="${stopped}"] [data-action="stop-active-session"]`)
      .click();
    await expect(activity(page, a).locator("summary")).toHaveAttribute(
      "aria-label",
      "Active sessions in Bench A: running 0, awaiting approval 1",
    );
    await expect.poll(async () => (await read(page, stopped)).snapshot.activeTurnId).toBeNull();
    expect(answer((await read(page, stopped)).snapshot)?.text ?? "").not.toContain("LONG STOP END");
    await expect(name(page, b)).toHaveAttribute("aria-current", "page");
    expect((await read(page, sessionB)).snapshot.activeTurnId).not.toBeNull();
    expect((await read(page, approval)).snapshot.approvals.at(-1)).toMatchObject({ decision: null });

    // The waiting session opens in A from A's collapsed row, by keyboard.
    await activity(page, a).locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(activity(page, a)).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveAttribute("data-action", "open-active-session");
    await page.keyboard.press("Enter");
    await expect(name(page, a)).toHaveAttribute("aria-current", "page");
    await expect(row(page, approval)).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Edit the board", exact: true })).toBeFocused();
    await expect(page.locator("[data-approval-card]")).toBeVisible();
    await page.locator("[data-approval-card]").getByRole("button", { name: "Approve", exact: true }).click();
    await expect
      .poll(async () => (await read(page, approval)).snapshot.activeTurnId, { timeout: 60000 })
      .toBeNull();
    expect(await readFile(join(root, "a", "board.txt"), "utf8")).toContain("Board uses 5 V.");
    expect(await readFile(join(root, "b", "board.txt"), "utf8")).toContain("Board uses 3.3 V.");
    // B now runs in the background and still completes in its own session.
    await expect(activity(page, b)).toHaveAttribute("data-activity", "running");
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const api = (window as unknown as { vera: VeraBridge }).vera;
            const activity = await api.invoke("session.activity", {});
            return activity.some((workbench) => workbench.sessions.some((session) => session.id === id));
          }, sessionB),
        { timeout: 90000 },
      )
      .toBe(false);
    await expect(activity(page, b)).toHaveCount(0);
    await expect(name(page, a)).toHaveAttribute("aria-current", "page");
    await name(page, b).click();
    await expect(name(page, b)).toHaveAttribute("aria-current", "page");
    expect(answer((await read(page, sessionB)).snapshot)?.text).toMatch(/LONG C END$/);
    expect(await outboundAttempts(bench.app)).toEqual([]);
  } finally {
    await close(bench);
  }
});

test("at the limit set by keyboard the draft stays, a sidebar Stop frees a turn and the draft sends", async () => {
  test.setTimeout(180000);
  const bench = await launch("vera-background-limit-");
  const { page, a } = bench;
  try {
    // Settings > Advanced by keyboard: Concurrent turns 1.
    await page.keyboard.press("Control+Comma");
    await keyTo(page, '[role="tab"][aria-selected="true"]');
    await keyTo(page, '[data-section="advanced"]', "ArrowDown", 20);
    await keyTo(page, "[data-show-advanced]");
    await page.keyboard.press("Space");
    await expect(page.locator("[data-show-advanced]")).toBeChecked();
    const field = '[data-settings-section="advanced"] [data-advanced-field="concurrentTurns"] input';
    await keyTo(page, field);
    await page.keyboard.type("1");
    await keyTo(page, "[data-settings-save]", "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-settings-save]")).toBeDisabled();
    await page.locator('[data-action="leave-settings"]').click();
    await name(page, a).click();

    const running = await start(page, "long-stop", "Long answer to stop");
    await expect(page.locator("[data-turn-capacity]")).toHaveAttribute("data-limit-reached", "true");
    await expect(page.locator("[data-turn-capacity]")).toContainText("1/1");
    // A second session's send is refused; the draft stays in the focused composer.
    await start(page, "long-b", "Second question");
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    const limit = page.locator('[role="alert"][data-i18n="errors.TURN_LIMIT"]');
    await expect(limit).toContainText("(1)");
    await expect(limit).toContainText("Wait for a running turn to finish, or stop one in the sidebar.");
    await expect(input).toHaveValue("Second question");
    await expect(input).toBeFocused();

    // Stop the running one from the sidebar by keyboard (Space opens the menu); the composer then says
    // a turn can start.
    await activity(page, a).locator("summary").focus();
    await page.keyboard.press("Space");
    await expect(activity(page, a)).toHaveAttribute("open", "");
    await keyTo(page, `[data-activity-session="${running}"] [data-action="stop-active-session"]`);
    await page.keyboard.press("Enter");
    await expect(page.locator('[role="status"][data-i18n="chat.turnSlotFree"]')).toHaveText(
      "A turn can start now. Send your message again.",
    );
    await expect(input).toHaveValue("Second question");
    await input.focus();
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.locator("[data-transcript]")).toContainText("LONG B END", { timeout: 60000 });
    expect(await outboundAttempts(bench.app)).toEqual([]);
  } finally {
    await close(bench);
  }
});
