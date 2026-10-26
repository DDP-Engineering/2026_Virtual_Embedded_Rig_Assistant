// REQ-REL-4bea0004 REQ-REL-4bea0006 REQ-UX-4bea0002
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { SessionState, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
async function rig(delay = 0) {
  const root = await mkdtemp(join(tmpdir(), "vera-wp14-ui-")),
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
  await page.locator("#workbench-name").fill("Board");
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
// REQ-UX-8b320385 REQ-UX-3001bd00: authored Done scenario; execution deferred.
test("queued steering shows pending during a real running turn and clears on delivery", async () => {
  const host = await rig(80),
    app = await host.launch();
  try {
    const page = await app.firstWindow(),
      id = await create(page, "replay/ui-slow");
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Slow answer");
    await input.press("Enter");
    await expect(page.locator('[data-message-kind="assistant"]')).toContainText("SLOW START");
    await expect(input).toBeEnabled();
    await expect(page.getByRole("combobox", { name: "Model", exact: true })).toBeDisabled();
    await input.fill("Steer the running turn");
    await page.locator('[data-action="send-message"]').click();
    const pending = page.locator('[data-message-kind="user"]').filter({ hasText: "Steer the running turn" });
    await expect(pending.locator("[data-message-pending]")).toHaveText("Pending delivery");
    expect((await snapshot(page, id)).items.filter((i) => i.kind === "user" && i.pending)).toHaveLength(1);
    await expect(pending.locator("[data-message-pending]")).toHaveCount(0, { timeout: 15000 });
    await expect(pending).toHaveCount(1);
    await expect.poll(async () => (await snapshot(page, id)).activeTurnId, { timeout: 20000 }).toBeNull();
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(host.root, { recursive: true, force: true });
  }
});
test("chat UI read-then-answer renders two tool rows and one cited answer, identical after native restart", async () => {
  const host = await rig();
  let app = await host.launch();
  try {
    let page = await app.firstWindow();
    const id = await create(page, "replay/read-then-answer");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Read the board");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    await expect(page.locator("[data-tool-row]")).toHaveCount(2);
    await expect(page.locator('[data-citation="valid"]')).toHaveCount(1);
    await expect.poll(async () => (await snapshot(page, id)).activeTurnId).toBeNull();
    const text = await page.locator("[data-transcript]").textContent();
    const before = await snapshot(page, id);
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await host.launch();
    page = await app.firstWindow();
    await page.locator('[data-action="open-recent"]').click();
    await expect(page.locator("[data-transcript]")).toHaveText(text as string);
    expect(await snapshot(page, id)).toEqual(before);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(host.root, { recursive: true, force: true });
  }
});
test("Stop during a slowed scripted response ends the real turn and enables the composer", async () => {
  const host = await rig(120),
    app = await host.launch();
  try {
    const page = await app.firstWindow(),
      id = await create(page, "replay/ui-slow");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Slow answer");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    await expect(page.locator('[data-message-kind="assistant"]')).toContainText("SLOW START");
    await page.locator('[data-action="stop-session"]').click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
    expect((await snapshot(page, id)).turns.at(-1)?.stopReason).toBe("aborted");
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(host.root, { recursive: true, force: true });
  }
});
test("renderer reload mid-stream projects final authoritative text exactly once", async () => {
  const host = await rig(80),
    app = await host.launch();
  try {
    const page = await app.firstWindow(),
      id = await create(page, "replay/ui-slow");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Slow answer");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    await expect(page.locator('[data-message-kind="assistant"]')).toContainText("SLOW START");
    await page.reload();
    await expect(page.locator('[data-message-kind="assistant"]')).toContainText("SLOW END", {
      timeout: 15000,
    });
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
    const state = await snapshot(page, id);
    const final = state.items.filter((i) => i.kind === "assistant");
    expect(final).toHaveLength(1);
    expect(final[0]?.kind).toBe("assistant");
    const text = await page.locator('[data-message-kind="assistant"] .markdown').textContent();
    expect(text).toBe(final[0]?.kind === "assistant" ? final[0].text : "");
    expect(text?.split("SLOW START")).toHaveLength(2);
    await expect(page.locator('[data-message-kind="user"]')).toHaveCount(1);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(host.root, { recursive: true, force: true });
  }
});
test("session Stop aborts a real pathological grep while app.info responds; next grep succeeds", async () => {
  const host = await rig(),
    app = await host.launch();
  try {
    const page = await app.firstWindow(),
      id = await create(page, "replay/auto");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Pathological grep");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    await expect(page.locator('[data-tool-row="grep"]')).toContainText("Running");
    // Give the worker time to enter its actual catastrophic regex, well before its 10s deadline.
    await page.waitForTimeout(300);
    const start = Date.now();
    const info = await page.evaluate(() =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("app.info", {}),
    );
    expect(info.platform).toBe(process.platform);
    expect(Date.now() - start).toBeLessThan(1500);
    expect((await snapshot(page, id)).activeTurnId).not.toBeNull();
    await page.locator('[data-action="stop-session"]').click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled({ timeout: 3000 });
    const stopped = await snapshot(page, id);
    expect(stopped.turns.at(-1)?.stopReason).toBe("aborted");
    expect(stopped.items.find((i) => i.kind === "tool" && i.name === "grep")).toMatchObject({
      status: "error",
    });
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Normal grep");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    await expect(page.locator('[data-tool-row="grep"]')).toHaveCount(2);
    await expect(page.locator('[data-message-kind="assistant"]').last()).toContainText("Grep recovered");
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
    const completed = await snapshot(page, id);
    expect(completed.turns.at(-1)?.stopReason).toBe("end");
    expect(completed.items.filter((i) => i.kind === "tool").at(-1)).toMatchObject({
      status: "ok",
      summary: expect.stringContaining("00-good.txt"),
    });
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(host.root, { recursive: true, force: true });
  }
});
