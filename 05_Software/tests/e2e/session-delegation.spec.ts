// REQ-UX-66b40e85 REQ-UX-9335be50 REQ-UX-01f905ce REQ-UX-93738350
// REQ-UX-b2f2c1dc REQ-UX-15bcd8cc REQ-REL-716213c5 REQ-TEST-1c4ba3f0
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { tabStorageKey } from "../../src/apps/desktop/src/renderer/lib/document-tabs-store.js";
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
  await expect(page.locator("[data-model-picker]")).toHaveValue(`replay/${model}`);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill(instruction);
  await input.press("Enter");
  return id;
}

/** A child chat's parent link and delegated turn outcome. */
function delegation(page: Page) {
  return page.locator("[data-session-delegations]");
}

/** A parent's delegated sessions, nested under it in the sidebar with their outcomes. */
function children(page: Page, parentId: string) {
  return page.locator(`[data-session-children="${parentId}"]`);
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
  const row = page.locator("[data-session-children] [data-session]", { hasText: name });
  await row.click();
  // A child row opens the child's Chat transcript, like the parent link, and becomes the current row.
  await expect(page.getByRole("heading", { name, exact: true })).toBeFocused();
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-transcript]")).toContainText(name);
  return sessionId(page);
}

/** The parent is the sidebar row its children are nested under; the child chat has no parent link. */
async function returnToParent(page: Page, id: string, name: string) {
  await expect(delegation(page).getByRole("button")).toHaveCount(0);
  await page.locator(`[data-session="${id}"]`).click();
  await expect(currentSession(page)).toHaveAttribute("data-session", id);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
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
      text: childText("Child is about to fail.", 100),
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
    await expect(children(page, completedParent)).toContainText("Running");
    const owner = await page.evaluate(async (parentSessionId) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const { config, folder } = await api.invoke("workbench.config.get", {});
      const rows = await api.invoke("session.list", { workbenchId: config.id });
      const child = rows.find((row) => row.delegation?.parentSessionId === parentSessionId);
      if (!child) throw Error("Missing delegated child");
      return { folder, workbenchId: config.id, sessionId: child.id };
    }, completedParent);
    await page.evaluate((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          active: "file:board.txt",
          tabs: [{ target: { textPath: "board.txt" } }],
        }),
      );
    }, tabStorageKey(owner));
    const childId = await followChild(page, "Inspect the jumper");
    expect(childId).toBe(owner.sessionId);
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
    await expect(children(page, completedParent)).toContainText("Running");
    if (process.env.VERA_DELEGATION_PROOF_DIR)
      await page.screenshot({ path: join(process.env.VERA_DELEGATION_PROOF_DIR, "running-parent.png") });
    await expect(children(page, completedParent)).toContainText("Completed", { timeout: 15000 });
    await expect(page.locator("[data-transcript]")).toContainText(`Parent used: ${completedReply}`, {
      timeout: 15000,
    });

    await turnsEnded(page);
    const stoppedParent = await createParent(page, "parent-stop", "Coordinate slow inspection");
    await expect(children(page, stoppedParent)).toContainText("Running");
    const stoppedChild = await followChild(page, "Inspect the slow board");
    await page.locator('[data-action="stop-session"]').click();
    await expect(delegation(page)).toContainText("Stopped");
    await expect(page.locator('[data-action="stop-session"]')).toHaveCount(0);
    await returnToParent(page, stoppedParent, "Coordinate slow inspection");
    await expect(children(page, stoppedParent)).toContainText("Stopped");
    await expect(page.locator('[data-action="stop-session"]')).toBeVisible();
    await expect(page.locator("[data-transcript]")).toContainText("Parent outcome: stopped.");
    await expect
      .poll(() =>
        page.evaluate(async (sessionId) => {
          const api = (window as unknown as { vera: VeraBridge }).vera;
          return (await api.invoke("session.get", { sessionId })).snapshot.activeTurnId;
        }, stoppedParent),
      )
      .toBeNull();

    // Drop relationship notifications; the existing list heartbeat must still recover.
    const delivered = await instance.evaluate(() => {
      const proof = Reflect.get(globalThis, "delegationProof");
      proof.drop = true;
      return proof.delivered;
    });
    expect(delivered).toBe(4);
    await turnsEnded(page);
    const failedParent = await createParent(page, "parent-error", "Coordinate failing inspection");
    await expect(children(page, failedParent)).toContainText("Running", { timeout: 10000 });
    await followChild(page, "Inspect the failing board");
    await expect(delegation(page)).toContainText("Failed", { timeout: 15000 });
    await returnToParent(page, failedParent, "Coordinate failing inspection");
    await expect(children(page, failedParent)).toContainText("Failed");
    expect(await instance.evaluate(() => Reflect.get(globalThis, "delegationProof").dropped)).toBe(2);

    await page.reload();
    await page.locator(`[data-session="${failedParent}"]`).click();
    await expect(children(page, failedParent)).toContainText("Failed");
    await expect(
      children(page, failedParent).locator("[data-session]", { hasText: "Inspect the failing board" }),
    ).toBeVisible();
    expect(await outboundAttempts(instance)).toEqual([]);
    await instance.close();
    app = undefined;

    ({ instance, page } = await boot());
    await page.locator(".workbench-group-name", { hasText: "Delegation bench" }).click();
    await page.locator(`[data-session="${stoppedChild}"]`).click();
    await expect(delegation(page).getByRole("status")).toHaveText("Delegated turn: Stopped");
    await returnToParent(page, stoppedParent, "Coordinate slow inspection");
    await expect(children(page, stoppedParent)).toContainText("Stopped");
    await page.locator(`[data-session="${completedParent}"]`).click();
    await expect(children(page, completedParent)).toContainText("Completed");
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

test("native desktop authorizes two sequential Full Access children, reuses one and starts unauthorized children in Auto-edit", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vera-delegation-modes-"));
  const folder = join(root, "board");
  const scripts = join(root, "replay");
  let app: ElectronApplication | undefined;
  try {
    await mkdir(folder);
    await mkdir(scripts);
    execFileSync("git", ["init", "-q"], { cwd: folder });
    const fixture = (name: string, steps: object[]) =>
      writeFile(join(scripts, `${name}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
    for (const ticket of ["first", "second"]) {
      const path = `${ticket}.txt`;
      await writeFile(join(folder, path), "before\n");
      await fixture(ticket, [
        { toolCalls: [tool("read", { path })] },
        { toolCalls: [tool("edit", { path, oldString: "before", newString: "checked" })] },
        // The second command has no saved prefix: a Full Access child runs it like direct Bypass.
        {
          toolCalls: [
            tool("run_command", {
              command: ticket === "first" ? `git hash-object -- ${path}` : `git status --short -- ${path}`,
            }),
          ],
        },
        { text: `${ticket} ticket handover ready` },
      ]);
    }
    await fixture("follow-low", [
      { reasoningOptions: ["low", "high"], expectReasoning: "low", text: "Low follow-up checked" },
    ]);
    await fixture("follow-high", [
      { reasoningOptions: ["low", "high"], expectReasoning: "high", text: "High follow-up checked" },
    ]);
    const call = (name: string, args: Record<string, unknown>) => ({ toolCalls: [tool(name, args)] });
    const child = { sessionId: "{{sessionId}}" };
    const monitored = { ...child, turnId: "{{turnId}}", waitMs: 20000 };
    await fixture("coordinate", [
      call("session_launch", { instruction: "Implement first ticket", modelRef: "replay/first" }),
      call("session_wait", monitored),
      call("session_configure", { ...child, modelRef: "replay/follow-low", reasoning: "low" }),
      call("session_send", { ...child, instruction: "First follow-up" }),
      call("session_wait", monitored),
      call("session_configure", { ...child, modelRef: "replay/follow-high", reasoning: "high" }),
      call("session_send", { ...child, instruction: "Second follow-up" }),
      call("session_wait", monitored),
      call("session_send", { ...child, instruction: "Third follow-up" }),
      call("session_wait", monitored),
      call("session_launch", { instruction: "Implement second ticket", modelRef: "replay/second" }),
      call("session_wait", monitored),
      { text: "Coordinator received {{reply}}." },
    ]);
    await fixture("limited", [
      { toolCalls: [tool("run_command", { command: "git status --short" })] },
      { text: "Limited child done." },
    ]);
    await fixture("revoked", [
      call("session_launch", { instruction: "Starts in Auto-edit", modelRef: "replay/limited" }),
      { text: "Revocation checked." },
    ]);
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [
        resolve(process.env.VERA_BUILD_ROOT ?? "src/apps/desktop/out", "main/index.js"),
        `--user-data-dir=${join(root, "profile")}`,
      ],
      env: { ...env, VERA_REPLAY_DIR: scripts },
    });
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await expect(page.locator('[data-i18n="nav.settings"]')).toBeVisible();
    await page.evaluate(async (folder) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.create", {
        folder,
        name: "Delegation modes",
        config: { agent: { allowed_commands: ["git hash-object"] } },
      });
    }, folder);
    await page.reload();
    await page.locator(".workbench-group-name", { hasText: "Delegation modes" }).click();
    const ids = await page.evaluate(async () => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const { config } = await api.invoke("workbench.config.get", {});
      const { id } = await api.invoke("session.create", {
        workbenchId: config.id,
        modelRef: "replay/coordinate",
      });
      return { sessionId: id, workbenchId: config.id };
    });
    await page.locator(`[data-session="${ids.sessionId}"]`).click();
    const permission = page.getByRole("combobox", { name: "Permission mode" });
    await expect(permission).toHaveValue("ask");
    const unacknowledged = await page.evaluate(async ({ sessionId }) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      try {
        await api.invoke("session.mode.set", { sessionId, mode: "bypass" });
        return "allowed";
      } catch {
        return (await api.invoke("session.get", { sessionId })).snapshot.mode;
      }
    }, ids);
    expect(unacknowledged).toBe("ask");
    await permission.selectOption("bypass");
    await page.locator('[data-action="cancel-bypass"]').click();
    await expect(permission).toHaveValue("ask");
    await permission.selectOption("bypass");
    await page.locator('[data-action="confirm-bypass"]').click();
    await expect(permission).toHaveValue("bypass");

    const rejectedGrant = await page.evaluate(async () => {
      try {
        await (window as unknown as { vera: VeraBridge }).vera.invoke(
          "app.settings.delegatedFullAccess.set",
          { enabled: true } as never,
        );
        return false;
      } catch {
        return true;
      }
    });
    expect(rejectedGrant).toBe(true);
    const allow = page.getByRole("switch", { name: "Allow Full Access for delegated tasks" });
    const storedPolicy = join(root, "profile", "delegated-full-access.json");
    const openLaunchSettings = async () => {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator("#settings-tab-data").click();
    };
    const returnToChat = async (sessionId: string) => {
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator(`[data-session="${sessionId}"]`).click();
    };
    await expect(allow).toHaveCount(0);
    await openLaunchSettings();
    await expect(allow).not.toBeChecked();
    await allow.click();
    await expect(page.getByRole("dialog")).toContainText("across all workbenches");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(allow).not.toBeChecked();
    await allow.click();
    await page.getByRole("dialog").getByRole("button", { name: "Enable", exact: true }).click();
    await expect(allow).toBeChecked();
    expect(JSON.parse(await readFile(storedPolicy, "utf8"))).toEqual({ schemaVersion: 1, enabled: true });

    await returnToChat(ids.sessionId);
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Coordinate local ticket implementation");
    await input.press("Enter");
    await expect(page.locator("[data-transcript]")).toContainText("Coordinator received", { timeout: 45000 });
    const proof = await page.evaluate(async ({ sessionId, workbenchId }) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const rows = (await api.invoke("session.list", { workbenchId })).filter(
        ({ delegation }) => delegation?.parentSessionId === sessionId,
      );
      const children = await Promise.all(
        rows.map(async (row) => {
          const { snapshot } = await api.invoke("session.get", { sessionId: row.id });
          return { row, snapshot };
        }),
      );
      const { snapshot: coordinator } = await api.invoke("session.get", { sessionId });
      return { children, coordinator };
    }, ids);
    if (process.env.VERA_DELEGATION_PROOF_DIR)
      await writeFile(
        join(process.env.VERA_DELEGATION_PROOF_DIR, "independent-modes.json"),
        JSON.stringify(proof, null, 2),
      );
    await expect(page.locator("[data-transcript]")).toContainText(
      "Coordinator received second ticket handover ready.",
    );
    expect(proof.children).toHaveLength(2);
    const first = proof.children.find(({ row }) => row.title === "Implement first ticket");
    const second = proof.children.find(({ row }) => row.title === "Implement second ticket");
    if (!first || !second) throw Error("Missing local implementation children");
    expect(first.snapshot.turns).toHaveLength(4);
    expect(first.snapshot.turns.at(-1)?.turnId).toBe(first.row.delegation?.turnId);
    expect(first.snapshot.items.filter((item) => item.kind === "user").map(({ id }) => id)).toHaveLength(4);
    for (const { snapshot, row } of [first, second]) {
      expect(row.mode).toBe("bypass");
      expect(snapshot.approvals.map(({ tool, decision, by }) => ({ tool, decision, by }))).toEqual([
        { tool: "edit", decision: "approved", by: "mode" },
        { tool: "run_command", decision: "approved", by: "mode" },
      ]);
      expect(
        snapshot.items.filter((item) => item.kind === "tool").map(({ name, status }) => ({ name, status })),
      ).toEqual([
        { name: "read", status: "ok" },
        { name: "edit", status: "ok" },
        { name: "run_command", status: "ok" },
      ]);
    }
    expect(await readFile(join(folder, "first.txt"), "utf8")).toBe("checked\n");
    expect(await readFile(join(folder, "second.txt"), "utf8")).toBe("checked\n");

    const opened = await followChild(page, "Implement first ticket");
    expect(opened).toBe(first.row.id);
    await expect(page.locator("[data-parent-instruction]")).toHaveCount(4);
    await expect(page.locator("[data-transcript]").getByText("You", { exact: true })).toHaveCount(0);
    await expect(page.locator(`[data-delegated-turn="${first.row.delegation?.turnId}"]`)).toBeVisible();
    await permission.selectOption("ask");
    await expect(permission).toHaveValue("ask");
    await permission.selectOption("bypass");
    await page.locator('[data-action="confirm-bypass"]').click();
    await expect(permission).toHaveValue("bypass");
    await permission.selectOption("read-only");
    await expect(permission).toHaveValue("read-only");
    await returnToParent(page, ids.sessionId, "Coordinate local ticket implementation");
    await expect(permission).toHaveValue("bypass");
    await permission.selectOption("auto-edit");
    await expect(permission).toHaveValue("auto-edit");
    await openLaunchSettings();
    await allow.click();
    await expect(allow).not.toBeChecked();
    expect(JSON.parse(await readFile(storedPolicy, "utf8"))).toEqual({ schemaVersion: 1, enabled: false });
    await returnToChat(ids.sessionId);
    await followChild(page, "Implement second ticket");
    await expect(permission).toHaveValue("bypass");
    await returnToParent(page, ids.sessionId, "Coordinate local ticket implementation");
    await permission.selectOption("bypass");
    await page.locator('[data-action="confirm-bypass"]').click();
    await expect(allow).toHaveCount(0);
    const revoked = await page.evaluate(async ({ sessionId }) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("session.model.set", { sessionId, modelRef: "replay/revoked" });
      return api.invoke("session.send", { sessionId, text: "Check future launches" });
    }, ids);
    expect(revoked.turnId).toBeTruthy();
    await expect(page.locator("[data-transcript]")).toContainText("Revocation checked.");
    await expect(
      children(page, ids.sessionId).locator("[data-session]", { hasText: "Starts in Auto-edit" }),
    ).toBeVisible();
    // With the setting off the child starts in Auto-edit, and its unsaved command waits for the user.
    const limited = await page.evaluate(async ({ sessionId, workbenchId }) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const row = (await api.invoke("session.list", { workbenchId })).find(
        (entry) => entry.delegation?.parentSessionId === sessionId && entry.title === "Starts in Auto-edit",
      );
      return row ? { mode: row.mode, id: row.id } : undefined;
    }, ids);
    expect(limited?.mode).toBe("auto-edit");
    await expect
      .poll(async () =>
        page.evaluate(async (sessionId) => {
          const api = (window as unknown as { vera: VeraBridge }).vera;
          const { snapshot } = await api.invoke("session.get", { sessionId });
          return snapshot.approvals.map(({ tool, decision }) => ({ tool, decision }));
        }, limited?.id ?? ""),
      )
      .toEqual([{ tool: "run_command", decision: null }]);
    await openLaunchSettings();
    await allow.click();
    await page.getByRole("dialog").getByRole("button", { name: "Enable", exact: true }).click();
    await expect(allow).toBeChecked();
    await page.reload();
    expect(
      await page.evaluate(async () => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        return (await api.invoke("app.settings.delegatedFullAccess.get", {})).enabled;
      }),
    ).toBe(true);
    await page.locator(`[data-session="${first.row.id}"]`).click();
    await expect(permission).toHaveValue("read-only");
    await expect(page.locator("[data-parent-instruction]")).toHaveCount(4);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
});
