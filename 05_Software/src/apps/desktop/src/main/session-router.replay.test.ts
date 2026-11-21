import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type SessionService, SettingsService, WorkbenchService } from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  applySessionEvent,
  type EventEnvelope,
  isLiveSessionEvent,
  type SessionEvent,
  type SessionState,
} from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import type { InvokeSender } from "./ipc-router.js";
import { SessionRouter } from "./session-router.js";
import { SessionsHost } from "./sessions.js";
import { WorkbenchRuntimes } from "./workbench-runtimes.js";

/** A replay delay that lets `chunks` streamed chunks through, then holds the turn until released. */
function gate(chunks = 1) {
  let calls = 0;
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delay = (signal: AbortSignal) =>
    ++calls < chunks
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          reach();
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          void released.then(resolve);
        });
  return { reached, release, delay };
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** The renderer frame the window shows; only it may control session subscriptions. */
const frame = { url: "vera://app/index.html" };
const contents = { mainFrame: frame, isDestroyed: () => false };
const sender: InvokeSender = { sender: contents, senderFrame: frame };

/**
 * Workbench runtimes as Desktop main composes them, with the session router over them. Runtime i streams
 * through `delays[i]` when given; every event a runtime emits to the renderer is recorded.
 */
async function harness(delays: ((signal: AbortSignal) => Promise<void>)[] = []) {
  const root = await mkdtemp(join(tmpdir(), "vera-routes-"));
  const folders = { a: join(root, "a"), b: join(root, "b") };
  for (const folder of Object.values(folders)) {
    await mkdir(folder);
    await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  }
  const files = createFileAccess(systemClock);
  const settings = new SettingsService({
    files,
    paths: { userData: root, settings: join(root, "settings.json"), logs: join(root, "logs") },
    uuid: randomUUID,
    changed: () => {},
  });
  await settings.load();
  const workbenchHost = {
    userData: root,
    files,
    settings,
    pid: process.pid,
    appVersion: "0.0.0",
    now: () => new Date(),
    token: randomUUID,
    isProcessAlive: (pid: number) => pid === process.pid,
    changed: () => {},
  };
  const setup = new WorkbenchService(workbenchHost);
  await setup.create(folders.b, "B");
  await setup.close();
  const emitted: Extract<EventEnvelope, { topic: "session" }>[] = [];
  const activity = { count: 0 };
  let made = 0;
  const runtimes = new WorkbenchRuntimes({
    create: (settled) => {
      const delay = delays[made++];
      const replay = new ReplayGateway({
        dir: resolve("tests/fixtures/llm-scripts"),
        now: () => Date.now(),
        ...(delay ? { delay } : {}),
      });
      const workbench = new WorkbenchService(workbenchHost);
      const sessions = new SessionsHost({
        workbench,
        settings,
        gateway: () => ({
          api: replay,
          modelReference: (ref: string | null | undefined) => ref ?? "replay/read-then-answer",
        }),
        credentials: { scrub: (text: string) => text, knownSecrets: () => [] },
        clock: systemClock,
        version: "0.0.0",
        target: () => ({ webContents: contents, url: frame.url }),
        emit: (event: EventEnvelope) => {
          if (event.topic === "session") emitted.push(event);
        },
        settled,
        activity: () => {
          activity.count++;
        },
      } as never);
      return { workbench, sessions };
    },
    stopPrograms: async () => {},
  });
  const router = new SessionRouter(() => runtimes.all());
  cleanup.push(async () => {
    await runtimes.closeSessions();
    await runtimes.closeWorkbenches();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  /** Starts a turn in the foreground workbench and returns its session. */
  const start = (modelRef: string, text: string) =>
    router.inWorkbench(undefined, (service) => {
      const id = service.create(modelRef).id;
      service.send(id, text);
      return id;
    });
  const snapshot = (id: string) => router.inSession(id, (service) => service.get(id), false);
  const done = async (id: string) =>
    (await router.inSession(id, (service) => ({ done: service.waitIdle(id) }), false)).done;
  return { root, folders, runtimes, router, emitted, activity, start, snapshot, done };
}

const lastAnswer = (state: SessionState) => state.items.findLast((item) => item.kind === "assistant");
const lock = (folder: string) => existsSync(join(folder, ".vera/lock"));

// REQ-FUNC-038c9b9b, REQ-FUNC-93ec5cc7, REQ-SEC-cf233e14, REQ-REL-6ca70bd2
it("decides a background workbench's approval in that workbench while another runs its own turn", async () => {
  const h = await harness();
  await h.runtimes.create(h.folders.a, "A");
  const a = h.runtimes.foreground;
  const sessionA = await h.start("replay/edit-approve", "Edit the board");
  await vi.waitFor(async () => expect((await h.snapshot(sessionA)).snapshot.approvals).toHaveLength(1));
  await h.runtimes.open(h.folders.b);
  const b = h.runtimes.foreground;
  // An undecided approval keeps A open in the background.
  expect(h.runtimes.all()).toEqual([b, a]);
  const sessionB = await h.start("replay/read-then-answer", "Read the board");
  expect(await h.done(sessionB)).toEqual({ stopReason: "end" });
  const activity = await h.router.activity();
  expect(
    activity.map(({ snapshot, foreground, sessions }) => [
      snapshot.config.name,
      foreground,
      sessions.map(({ id, status }) => [id, status]),
    ]),
  ).toEqual([
    ["B", true, []],
    ["A", false, [[sessionA, "awaiting_approval"]]],
  ]);
  // A's session is A's: B's identity does not reach it, and B's session is not in A.
  const idA = activity[1]?.snapshot.config.id as string;
  const idB = activity[0]?.snapshot.config.id as string;
  await expect(h.router.inSession(sessionA, () => 0, false, idB)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(h.router.inSession(sessionB, () => 0, false, idA)).rejects.toMatchObject({ code: "CONFLICT" });
  // The approval is reviewed and decided while B is shown; the edit lands in A's folder only.
  const approval = (await h.snapshot(sessionA)).snapshot.approvals[0];
  if (!approval) throw Error("approval missing");
  expect(approval).toMatchObject({ tool: "edit", path: "board.txt", decision: null });
  const finished = h.done(sessionA);
  await h.router.inSession(
    sessionA,
    (service) =>
      service.decideApproval({
        sessionId: sessionA,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
      }),
    false,
    idA,
  );
  expect(await finished).toEqual({ stopReason: "end" });
  expect(await readFile(join(h.folders.a, "board.txt"), "utf8")).toContain("Board uses 5 V.");
  expect(await readFile(join(h.folders.b, "board.txt"), "utf8")).toContain("Board uses 3.3 V.");
  expect(h.activity.count).toBeGreaterThan(0);
  // A settles and is released; its session is then unknown rather than sent to B.
  await vi.waitFor(() => expect(lock(h.folders.a)).toBe(false));
  await expect(h.snapshot(sessionA)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(lastAnswer((await h.snapshot(sessionB)).snapshot)?.text).toContain("3.3 V");
  // The released workbench is no longer listed.
  expect((await h.router.activity()).map(({ snapshot }) => snapshot.config.name)).toEqual(["B"]);
});

// REQ-FUNC-038c9b9b
it("stops a background session while the foreground workbench's turn runs on", async () => {
  const heldA = gate();
  const heldB = gate();
  const h = await harness([heldA.delay, heldB.delay]);
  await h.runtimes.create(h.folders.a, "A");
  const sessionA = await h.start("replay/ui-slow", "Slow answer");
  await heldA.reached;
  await h.runtimes.open(h.folders.b);
  const sessionB = await h.start("replay/ui-slow", "Slow answer");
  await heldB.reached;
  const doneA = h.done(sessionA);
  const doneB = h.done(sessionB);
  expect(await h.router.inSession(sessionA, (service) => service.stop(sessionA), false)).toBe(true);
  expect(await doneA).toEqual({ stopReason: "aborted" });
  expect((await h.snapshot(sessionB)).snapshot.activeTurnId).not.toBeNull();
  heldB.release();
  expect(await doneB).toEqual({ stopReason: "end" });
  expect(lastAnswer((await h.snapshot(sessionB)).snapshot)?.text).toContain("SLOW END");
});

// REQ-FUNC-038c9b9b
it("closes the foreground workbench while a background session's turn completes", async () => {
  const heldA = gate();
  const heldB = gate();
  const h = await harness([heldA.delay, heldB.delay]);
  await h.runtimes.create(h.folders.a, "A");
  const sessionA = await h.start("replay/ui-slow", "Slow answer");
  await heldA.reached;
  await h.runtimes.open(h.folders.b);
  const sessionB = await h.start("replay/ui-slow", "Slow answer");
  await heldB.reached;
  const doneA = h.done(sessionA);
  const doneB = h.done(sessionB);
  await h.runtimes.close();
  expect(await doneB).toEqual({ stopReason: "aborted" });
  heldA.release();
  expect(await doneA).toEqual({ stopReason: "end" });
});

/** The events one subscription received, as the renderer reads them. */
function received(emitted: Extract<EventEnvelope, { topic: "session" }>[], subscriptionId: string) {
  return emitted.filter((envelope) => envelope.subscriptionId === subscriptionId);
}

// REQ-FUNC-4f478637, REQ-FUNC-cbd535d1
it("keeps a subscription across a foreground change and restores the streamed text to a returning view", async () => {
  const held = gate(3);
  const h = await harness([held.delay]);
  await h.runtimes.create(h.folders.a, "A");
  const sessionA = await h.start("replay/ui-slow", "Slow answer");
  const first = await h.snapshot(sessionA);
  const subscribe = (subscriptionId: string, sinceSeq: number) =>
    h.router.subscription(sender, "subscribe", { sessionId: sessionA, sinceSeq, subscriptionId });
  expect(await subscribe("watching", first.seq)).toEqual({ ok: true, value: {} });
  await held.reached;
  // Another workbench comes to the foreground; A's turn and its subscription carry on.
  await h.runtimes.open(h.folders.b);
  // A view returning to A reads the snapshot, then subscribes from its cursor.
  const back = await h.snapshot(sessionA);
  expect(await subscribe("returning", back.seq)).toEqual({ ok: true, value: {} });
  await vi.waitFor(() =>
    expect(received(h.emitted, "returning").some(({ event }) => event.type === "message.delta")).toBe(true),
  );
  const restored = received(h.emitted, "returning").reduce(
    (state, { event }) => applySessionEvent(state, event),
    back.snapshot,
  );
  // Three streamed chunks of 40 characters reached the turn before it was held.
  const script = await readFile(resolve("tests/fixtures/llm-scripts/ui-slow.jsonl"), "utf8");
  const reply = (JSON.parse(script.split("\n")[0] as string) as { text: string }).text;
  expect(lastAnswer(restored)).toMatchObject({ streaming: true });
  expect(lastAnswer(restored)?.text).toBe(reply.slice(0, 120));
  held.release();
  // Both views end with the stored final reply, every stored event once and in order.
  await vi.waitFor(() => expect(lock(h.folders.a)).toBe(false));
  const stored = (await (async () => {
    await h.runtimes.open(h.folders.a);
    return h.snapshot(sessionA);
  })()) as { snapshot: SessionState; seq: number };
  for (const [subscriptionId, from] of [
    ["watching", first],
    ["returning", back],
  ] as const) {
    const events = received(h.emitted, subscriptionId);
    const seqs = events.flatMap(({ seq }) => (seq === undefined ? [] : [seq]));
    expect(seqs).toEqual(Array.from({ length: stored.seq - from.seq }, (_, i) => from.seq + i + 1));
    const durable = events.filter(({ event }) => !isLiveSessionEvent(event));
    expect(durable.filter(({ event }) => event.type === "message.done")).toHaveLength(1);
    const final = events.reduce(
      (state, { event }) => applySessionEvent(state, event as SessionEvent),
      from.snapshot,
    );
    expect(lastAnswer(final)).toEqual(lastAnswer(stored.snapshot));
  }
  // The released runtime ended both subscriptions: a change of the session in the reopened A reaches neither.
  const delivered = h.emitted.length;
  await h.router.inSession(sessionA, (service) => service.rename(sessionA, "Renamed"));
  expect((await h.snapshot(sessionA)).snapshot.title).toBe("Renamed");
  expect(h.emitted).toHaveLength(delivered);
  expect(await h.router.subscription(sender, "unsubscribe", { subscriptionId: "watching" })).toEqual({
    ok: true,
    value: {},
  });
});

// REQ-REL-6e1454c1
it("refuses a routed request whose runtime closed its workbench before the request ran", async () => {
  const h = await harness();
  await h.runtimes.create(h.folders.a, "A");
  const sessionA = await h.start("replay/read-then-answer", "Read the board");
  expect(await h.done(sessionA)).toEqual({ stopReason: "end" });
  const route = h.router.session(sessionA);
  await h.runtimes.close();
  const operation = vi.fn();
  await expect(h.router.run(route, operation as (service: SessionService) => void)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(operation).not.toHaveBeenCalled();
});
