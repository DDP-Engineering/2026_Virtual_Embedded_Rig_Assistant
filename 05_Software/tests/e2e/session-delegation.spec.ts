// REQ-UX-66b40e85 REQ-UX-9335be50 REQ-UX-01f905ce REQ-UX-93738350
// REQ-UX-b2f2c1dc REQ-UX-15bcd8cc REQ-REL-716213c5 REQ-TEST-1c4ba3f0
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const tool = (name: string, args: Record<string, unknown>) => ({ name, args });
const completedReply = "The inspection found a violet jumper.";
const childText = (prefix: string, chunks: number) => prefix + " Recorded observation.".repeat(chunks);
const currentSession = (page: Page) => page.locator('[data-session][aria-current="page"]');

async function sessionId(page: Page) {
  const id = await currentSession(page).getAttribute("data-session");
  if (!id) throw Error("Missing selected session");
  return id;
}

async function createParent(page: Page, model: string, instruction: string) {
  const selected = '[data-session][aria-current="page"]';
  const previous = await page.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute("data-session"),
    selected,
  );
  await page.locator('[data-action="new-session"]').click();
  await page.waitForFunction(
    ({ selected, previous }) => {
      const id = document.querySelector(selected)?.getAttribute("data-session");
      return id && id !== previous;
    },
    { selected, previous },
  );
  const id = await sessionId(page);
  await page.evaluate(
    ({ id, model }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
        sessionId: id,
        modelRef: `replay/${model}`,
      }),
    { id, model },
  );
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill(instruction);
  await input.press("Enter");
  return id;
}

function delegation(page: Page) {
  return page.locator("[data-session-delegations]");
}

/**
 * A parent keeps streaming its reply after the checked prefix. Wait until every turn has ended, so the next
 * parent and its child fit within the default Concurrent turns limit of 3.
 */
async function turnsEnded(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const api = (window as unknown as { vera: VeraBridge }).vera;
          return (await api.invoke("session.capacity", {})).active;
        }),
      { timeout: 20000 },
    )
    .toBe(0);
}

async function followChild(page: Page, name: string) {
  await delegation(page).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeFocused();
  await expect(page.locator("[data-transcript]")).toContainText(name);
  return sessionId(page);
}

async function returnToParent(page: Page, id: string, name: string) {
  await delegation(page)
    .getByRole("button", { name: `Parent session: ${name}`, exact: true })
    .click();
  await expect(currentSession(page)).toHaveAttribute("data-session", id);
  await expect(page.getByRole("heading", { name, exact: true })).toBeFocused();
}

test("native Desktop follows live delegated sessions, stops one and reopens durable outcomes", async () => {
  test.setTimeout(100000);
  const root = await mkdtemp(join(tmpdir(), "vera-session-delegation-"));
  const folder = join(root, "board");
  const scripts = join(root, "replay");
  await mkdir(folder);
  await mkdir(scripts);
  await writeFile(join(folder, "board.txt"), "Board fixture\n");
  const fixture = (name: string, steps: object[]) =>
    writeFile(join(scripts, `${name}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
  for (const [kind, instruction] of [
    ["complete", "Inspect the jumper"],
    ["stop", "Inspect the slow board"],
    ["error", "Inspect the failing board"],
  ]) {
    await fixture(`parent-${kind}`, [
      {
        toolCalls: [
          tool("session_launch", {
            instruction,
            modelRef: `replay/child-${kind}`,
            ...(kind === "complete" ? { reasoning: "high" } : {}),
          }),
        ],
      },
      {
        text: "Parent work is still progressing.",
        toolCalls: [tool("session_wait", { sessionId: "{{sessionId}}", waitMs: 20000 })],
      },
      { text: kind === "complete" ? "Parent used: {{reply}}" : childText("Parent outcome: {{status}}.", 30) },
    ]);
  }
  await fixture("child-complete", [
    {
      reasoningOptions: ["low", "high"],
      expectReasoning: "high",
      text: childText(completedReply, 72),
    },
  ]);
  await fixture("child-stop", [{ text: childText("Slow child is working.", 350) }]);
  await fixture("child-error", [
    {
      text: childText("Child is about to fail.", 55),
      toolCalls: [tool("read", { path: "board.txt" })],
    },
  ]);

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_REPLAY_DELAY_MS = "120";
  let app: ElectronApplication | undefined;
  const boot = async () => {
    const instance = await _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [
        resolve(process.env.VERA_BUILD_ROOT ?? "src/apps/desktop/out", "main/index.js"),
        `--user-data-dir=${join(root, "profile")}`,
      ],
      env,
    });
    app = instance;
    await installNetworkGuard(instance);
    const page = await instance.firstWindow();
    await expect(page.locator('[data-i18n="nav.settings"]')).toBeVisible();
    return { instance, page };
  };
  try {
    let { instance, page } = await boot();
    await page.evaluate(async (folder) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.create", {
        folder,
        name: "Delegation bench",
      });
    }, folder);
    await page.reload();
    await page.locator(".workbench-group-name", { hasText: "Delegation bench" }).click();
    await instance.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) throw Error("Missing renderer");
      const proof = { delivered: 0, dropped: 0, drop: false };
      Object.assign(globalThis, { delegationProof: proof });
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === "vera:event" && args[0]?.event?.type === "session.delegations.changed") {
          if (proof.drop) {
            proof.dropped++;
            return;
          }
          proof.delivered++;
        }
        send(channel, ...args);
      };
    });

    const completedParent = await createParent(page, "parent-complete", "Coordinate jumper inspection");
    await expect(delegation(page)).toContainText("Running");
    const linkedChild = await page.evaluate(async (parentSessionId) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const { config } = await api.invoke("workbench.config.get", {});
      const rows = await api.invoke("session.list", { workbenchId: config.id });
      const child = rows.find((row) => row.delegation?.parentSessionId === parentSessionId);
      if (!child) throw Error("Missing delegated child");
      localStorage.setItem(
        `vera.tabs.${config.id}.${child.id}`,
        JSON.stringify({
          version: 1,
          active: "file:board.txt",
          tabs: [{ target: { textPath: "board.txt" } }],
        }),
      );
      return child.id;
    }, completedParent);
    const childId = await followChild(page, "Inspect the jumper");
    expect(childId).toBe(linkedChild);
    await expect(page.locator('[data-tab-key="file:board.txt"]')).toBeVisible();
    await expect(page.getByRole("tab", { name: "Chat", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(delegation(page)).toContainText("Running");
    const initial = await page.evaluate(
      (id) => (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
      childId,
    );
    expect(initial.snapshot).toMatchObject({ modelRef: "replay/child-complete", reasoning: "high" });
    await returnToParent(page, completedParent, "Coordinate jumper inspection");
    await expect(page.locator("[data-transcript]")).toContainText("Parent work is still progressing.");
    await expect(delegation(page)).toContainText("Running");
    if (process.env.VERA_DELEGATION_PROOF_DIR)
      await page.screenshot({ path: join(process.env.VERA_DELEGATION_PROOF_DIR, "running-parent.png") });
    await expect(delegation(page)).toContainText("Completed", { timeout: 15000 });
    await expect(page.locator("[data-transcript]")).toContainText(`Parent used: ${completedReply}`, {
      timeout: 15000,
    });

    await turnsEnded(page);
    const stoppedParent = await createParent(page, "parent-stop", "Coordinate slow inspection");
    await expect(delegation(page)).toContainText("Running");
    const stoppedChild = await followChild(page, "Inspect the slow board");
    await page.locator('[data-action="stop-session"]').click();
    await expect(delegation(page)).toContainText("Stopped");
    await expect(page.locator('[data-action="stop-session"]')).toHaveCount(0);
    await returnToParent(page, stoppedParent, "Coordinate slow inspection");
    await expect(delegation(page)).toContainText("Stopped");
    await expect(page.locator('[data-action="stop-session"]')).toBeVisible();
    await expect(page.locator("[data-transcript]")).toContainText("Parent outcome: stopped.");

    // Drop relationship notifications; the existing list heartbeat must still recover.
    const delivered = await instance.evaluate(() => {
      const proof = Reflect.get(globalThis, "delegationProof");
      proof.drop = true;
      return proof.delivered;
    });
    expect(delivered).toBe(4);
    await turnsEnded(page);
    const failedParent = await createParent(page, "parent-error", "Coordinate failing inspection");
    await expect(delegation(page)).toContainText("Running");
    await followChild(page, "Inspect the failing board");
    await expect(delegation(page)).toContainText("Failed", { timeout: 15000 });
    await returnToParent(page, failedParent, "Coordinate failing inspection");
    await expect(delegation(page)).toContainText("Failed");
    expect(await instance.evaluate(() => Reflect.get(globalThis, "delegationProof").dropped)).toBe(2);

    await page.reload();
    await page.locator(`[data-session="${failedParent}"]`).click();
    await expect(delegation(page)).toContainText("Failed");
    await expect(delegation(page).getByRole("button", { name: "Inspect the failing board" })).toBeVisible();
    expect(await outboundAttempts(instance)).toEqual([]);
    await instance.close();
    app = undefined;

    ({ instance, page } = await boot());
    await page.locator(".workbench-group-name", { hasText: "Delegation bench" }).click();
    await page.locator(`[data-session="${stoppedChild}"]`).click();
    await expect(delegation(page).getByRole("status")).toHaveText("Delegated turn: Stopped");
    await returnToParent(page, stoppedParent, "Coordinate slow inspection");
    await expect(delegation(page)).toContainText("Stopped");
    await page.locator(`[data-session="${completedParent}"]`).click();
    await expect(delegation(page)).toContainText("Completed");
    expect(await followChild(page, "Inspect the jumper")).toBe(childId);
    await expect(delegation(page)).toContainText("Completed");
    await expect(page.locator("[data-transcript]")).toContainText(completedReply);
    if (process.env.VERA_DELEGATION_PROOF_DIR)
      await page.screenshot({ path: join(process.env.VERA_DELEGATION_PROOF_DIR, "restarted-child.png") });
    await page.locator('[data-action="show-help"]').click();
    await expect(page.locator("[data-help-view]")).toBeVisible();
    const rightPanel = page.locator('[data-toggle="right"]');
    if ((await rightPanel.getAttribute("aria-expanded")) === "false") await rightPanel.click();
    await page.getByRole("tab", { name: "Files", exact: true }).click();
    await page.locator('#panel-docs [data-tree-path="board.txt"]').click();
    await expect(page.locator('[data-tab-key="file:board.txt"]')).toHaveAttribute("aria-selected", "true");
    expect(await outboundAttempts(instance)).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
});
