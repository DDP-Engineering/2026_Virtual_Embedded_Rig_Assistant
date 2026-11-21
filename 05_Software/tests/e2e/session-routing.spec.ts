import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect } from "@playwright/test";
import {
  applySessionEvent,
  type SessionEvent,
  type SessionState,
  type VeraBridge,
  type WorkbenchSnapshot,
} from "@vera/shared";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

// REQ-FUNC-038c9b9b, REQ-SEC-a4fbf2c9, REQ-FUNC-93ec5cc7, REQ-SEC-cf233e14, REQ-FUNC-cbd535d1, REQ-FUNC-4f478637
test("a background approval is reviewed in its own workbench, masked by it, and streamed text survives a switch", async () => {
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), "vera-routing-"));
  const a = join(root, "a");
  const b = join(root, "b");
  const scripts = join(root, "scripts");
  const secret = "pwb02-native-mqtt-secret";
  for (const folder of [a, b, scripts]) await mkdir(folder);
  // A reads its notes and its clean board, then edits the board (an edit of a file holding a stored
  // secret is refused).
  await writeFile(join(a, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  await writeFile(join(a, "notes.txt"), `Key ${secret}.\n`);
  await writeFile(join(b, "board.txt"), `Board uses 3.3 V.\nKey ${secret}.\n`);
  await writeFile(
    join(scripts, "notes-edit.jsonl"),
    [
      {
        match: "(?i)edit.*board",
        toolCalls: [
          { name: "read", args: { path: "notes.txt" } },
          { name: "read", args: { path: "board.txt" } },
        ],
      },
      { toolCalls: [{ name: "edit", args: { path: "board.txt", oldString: "3.3 V", newString: "5 V" } }] },
      { text: "The change decision has been processed." },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n"),
  );
  for (const name of ["read-then-answer.jsonl", "ui-slow.jsonl"])
    await copyFile(resolve("tests/fixtures/llm-scripts", name), join(scripts, name));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
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
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: unknown }).vera);
    /** The IPC result, or the error object it rejected with. */
    const attempt = (channel: string, payload: unknown) =>
      page.evaluate(
        async ([channel, payload]) => {
          const bridge = window as unknown as {
            vera: { invoke(channel: string, payload: unknown): Promise<unknown> };
          };
          try {
            return { value: await bridge.vera.invoke(channel, payload) };
          } catch (error) {
            return { error };
          }
        },
        [channel, payload] as const,
      );
    const call = async <T>(channel: string, payload: unknown) => {
      const result = await attempt(channel, payload);
      if ("error" in result) throw new Error(`${channel} failed: ${JSON.stringify(result.error)}`);
      return result.value as T;
    };
    const read = (sessionId: string) =>
      call<{ snapshot: SessionState; seq: number }>("session.get", { sessionId });
    const startTurn = async (modelRef: string, text: string) => {
      const { id } = await call<{ id: string }>("session.create", { modelRef, mode: "ask" });
      await call("session.send", { sessionId: id, text });
      return id;
    };
    const idle = (sessionId: string) =>
      expect.poll(async () => (await read(sessionId)).snapshot.activeTurnId, { timeout: 60000 }).toBeNull();
    const lock = (folder: string) => existsSync(join(folder, ".vera/lock"));
    await call("app.settings.update", {
      language: "en",
      privacy: { mask: { agent: false, exports: false, display: false, runs: false } },
    });
    await call("workbench.create", { folder: b, name: "B" });
    const benchA = await call<WorkbenchSnapshot>("workbench.create", { folder: a, name: "A" });
    // A's session is titled with the text before it becomes a stored secret, which no title may hold.
    const { id: sessionA } = await call<{ id: string }>("session.create", {
      modelRef: "replay/notes-edit",
      mode: "ask",
    });
    await call("session.rename", { sessionId: sessionA, title: `Notes ${secret}` });
    await call("mqtt.credentials.save", { ref: "pwb02", password: secret, storageConsent: true });
    // A's turn reads its notes, then waits for the user to approve an edit of its board.
    await call("session.send", { sessionId: sessionA, text: "Edit the board" });
    await expect
      .poll(async () => (await read(sessionA)).snapshot.approvals.length, { timeout: 60000 })
      .toBe(1);
    expect(JSON.stringify(await read(sessionA))).toContain(secret);
    await call("workbench.config.update", {
      workbenchId: benchA.config.id,
      patch: { privacy: { mask: { agent: "on" } } },
    });
    const benchB = await call<WorkbenchSnapshot>("workbench.open", { folder: b });
    // The undecided approval keeps A open in the background while B runs a turn of its own.
    expect(lock(a)).toBe(true);
    const sessionB = await startTurn("replay/read-then-answer", "Read the board");
    await idle(sessionB);
    // Each session reaches the renderer through its own workbench's masking, whichever is shown.
    expect(JSON.stringify(await read(sessionB))).toContain(secret);
    const background = await read(sessionA);
    expect(JSON.stringify(background)).not.toContain(secret);
    expect(background.snapshot.approvals[0]).toMatchObject({ tool: "edit", decision: null });
    // A subscription to A's session replays A's events through A's masking too.
    await page.evaluate((id) => {
      const vera = (window as unknown as { vera: VeraBridge }).vera;
      const events: SessionEvent[] = [];
      const off = vera.subscribe("session", id, 0, (event) => events.push(event));
      Object.assign(globalThis, { pwb02Replay: { events, off } });
    }, sessionA);
    const replayed = () =>
      page.evaluate(
        () => (globalThis as unknown as { pwb02Replay: { events: SessionEvent[] } }).pwb02Replay.events,
      );
    await expect
      .poll(async () => (await replayed()).some((event) => event.type === "approval.requested"))
      .toBe(true);
    const replay = JSON.stringify(await replayed());
    expect(replay).toContain("notes.txt");
    expect(replay).not.toContain(secret);
    await page.evaluate(() => (globalThis as unknown as { pwb02Replay: { off(): void } }).pwb02Replay.off());
    expect(await call("session.activity", {})).toEqual([
      { workbenchId: benchB.config.id, name: "B", folder: benchB.folder, foreground: true, sessions: [] },
      {
        workbenchId: benchA.config.id,
        name: "A",
        folder: benchA.folder,
        foreground: false,
        sessions: [{ id: sessionA, title: "Notes [REDACTED]", status: "awaiting_approval" }],
      },
    ]);
    // Listing A's sessions while B is shown runs in A and masks the title by A's choice.
    const listed = await call<{ id: string; title: string }[]>("session.list", {
      workbenchId: benchA.config.id,
    });
    expect(listed.map(({ id, title }) => [id, title])).toEqual([[sessionA, "Notes [REDACTED]"]]);
    // B's identity does not reach A's session.
    expect(
      await attempt("session.image.capability", { workbenchId: benchB.config.id, sessionId: sessionA }),
    ).toMatchObject({ error: { code: "CONFLICT" } });
    // Returning to A shows its approval; approving it there completes A's edit in A only.
    await call("workbench.open", { folder: a });
    const approval = (await read(sessionA)).snapshot.approvals[0];
    if (!approval) throw new Error("approval missing");
    await call("session.approval.decide", {
      sessionId: sessionA,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision: "approved",
    });
    await idle(sessionA);
    expect(await readFile(join(a, "board.txt"), "utf8")).toContain("Board uses 5 V.");
    expect(await readFile(join(b, "board.txt"), "utf8")).toContain("Board uses 3.3 V.");
    expect(await call("session.activity", {})).toMatchObject([{ name: "A", foreground: true, sessions: [] }]);

    // A slow reply streams in A; the user switches to B and back while it streams.
    const slow = await startTurn("replay/ui-slow", "Slow answer");
    await expect.poll(async () => (await read(slow)).snapshot.activeTurnId).not.toBeNull();
    // About six of its 40-character chunks stream before the switch (one each 250 ms).
    await page.waitForTimeout(1500);
    await call("workbench.open", { folder: b });
    await call("workbench.open", { folder: a });
    // The returning view reads the snapshot, then subscribes from its cursor.
    await page.evaluate(async (id) => {
      const vera = (window as unknown as { vera: VeraBridge }).vera;
      const view = await vera.invoke("session.get", { sessionId: id });
      const events: SessionEvent[] = [];
      vera.subscribe("session", id, view.seq, (event) => events.push(event));
      Object.assign(globalThis, { pwb02View: { view, events } });
    }, slow);
    const returning = () =>
      page.evaluate(
        () =>
          (
            globalThis as unknown as {
              pwb02View: { view: { snapshot: SessionState }; events: SessionEvent[] };
            }
          ).pwb02View,
      );
    const fold = (state: SessionState, events: SessionEvent[]) =>
      events.reduce((current, event) => applySessionEvent(current, event), state);
    const answer = (state: SessionState) => state.items.findLast((item) => item.kind === "assistant");
    // The text streamed so far is back at once, still streaming.
    await expect
      .poll(async () => {
        const { view, events } = await returning();
        return answer(fold(view.snapshot, events));
      })
      .toMatchObject({ streaming: true, text: expect.stringMatching(/^SLOW START/) });
    await idle(slow);
    await expect
      .poll(async () => (await returning()).events.some((event) => event.type === "turn.done"))
      .toBe(true);
    const { view, events } = await returning();
    const final = answer(fold(view.snapshot, events));
    const stored = answer((await read(slow)).snapshot);
    expect(final).toEqual(stored);
    expect(final?.text.split("SLOW END")).toHaveLength(2);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
