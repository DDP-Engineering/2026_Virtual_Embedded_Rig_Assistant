import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type SessionService, SettingsService, WorkbenchService } from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { afterEach, expect, it, vi } from "vitest";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import { SessionsHost } from "./sessions.js";
import { WorkbenchRuntimes } from "./workbench-runtimes.js";

/** A replay delay that holds a turn at its first streamed chunk until the test releases it. */
function gate() {
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delay = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
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

/** Workbench runtimes as Desktop main composes them; runtime 0 streams through a held replay gateway. */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "vera-runtimes-"));
  const folders = { a: join(root, "a"), b: join(root, "b"), plain: join(root, "plain") };
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
  // B exists before navigation starts, as a workbench the user opens from the recent list.
  const setup = new WorkbenchService(workbenchHost);
  await setup.create(folders.b, "B");
  await setup.close();
  const held = gate();
  let made = 0;
  const stopped: string[] = [];
  const runtimes = new WorkbenchRuntimes({
    create: (settled) => {
      const replay = new ReplayGateway({
        dir: resolve("tests/fixtures/llm-scripts"),
        now: () => Date.now(),
        ...(made++ === 0 ? { delay: held.delay } : {}),
      });
      const workbench = new WorkbenchService(workbenchHost);
      const sessions = new SessionsHost({
        workbench,
        settings,
        gateway: () => ({ api: replay, modelReference: () => "replay/read-then-answer" }),
        credentials: { scrub: (text: string) => text, knownSecrets: () => [] },
        clock: systemClock,
        version: "0.0.0",
        target: () => undefined,
        emit: () => {},
        settled,
      } as never);
      return { workbench, sessions };
    },
    stopPrograms: async (folder) => {
      stopped.push(folder);
    },
  });
  cleanup.push(async () => {
    held.release();
    await runtimes.closeSessions();
    await runtimes.closeWorkbenches();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { root, folders, runtimes, held, stopped };
}

const lastAnswer = (service: SessionService, id: string) =>
  service.get(id).snapshot.items.findLast((item) => item.kind === "assistant")?.text;

async function startTurn(sessions: SessionsHost): Promise<string> {
  return sessions.run((service) => {
    const id = service.create().id;
    service.send(id, "Read the board");
    return id;
  });
}

async function completion(sessions: SessionsHost, id: string) {
  const { done } = await sessions.run((service) => ({ done: service.waitIdle(id) }), false);
  return done;
}

const lock = (folder: string) => existsSync(join(folder, ".vera/lock"));

// REQ-FUNC-db6bacf7, REQ-FUNC-4747d310, REQ-FUNC-0dfa01fd
it("continues a replay turn in A after B opens while B runs its own turn, then releases A", async () => {
  const { folders, runtimes, held, stopped } = await harness();
  await runtimes.create(folders.a, "A");
  const a = runtimes.foreground;
  const sessionA = await startTurn(a.sessions);
  await held.reached;
  await runtimes.open(folders.b);
  const b = runtimes.foreground;
  expect(b).not.toBe(a);
  expect(runtimes.all()).toEqual([b, a]);
  expect(lock(folders.a)).toBe(true);
  expect(stopped).toEqual([]);
  // B runs a turn to completion while A's turn is still held.
  const sessionB = await startTurn(b.sessions);
  expect(await completion(b.sessions, sessionB)).toEqual({ stopReason: "end" });
  expect(await b.sessions.run((service) => lastAnswer(service, sessionB))).toContain("3.3 V");
  expect(await b.sessions.run((service) => service.list(true).map((row) => row.id))).toEqual([sessionB]);
  // A finishes in A, then its runtime is released: sessions, program runs, lock and database.
  const doneA = completion(a.sessions, sessionA);
  held.release();
  expect(await doneA).toEqual({ stopReason: "end" });
  await vi.waitFor(() => expect(lock(folders.a)).toBe(false));
  expect(runtimes.all()).toEqual([b]);
  expect(stopped).toEqual([folders.a]);
  // Returning to A shows its final reply from A's own database.
  await runtimes.open(folders.a);
  const reopened = runtimes.foreground;
  expect(await reopened.sessions.run((service) => lastAnswer(service, sessionA))).toContain("3.3 V");
  expect(await reopened.sessions.run((service) => service.list(true).map((row) => row.id))).toEqual([
    sessionA,
  ]);
});

// REQ-FUNC-0278c7ba, REQ-REL-b10ee7aa
it("keeps a held turn through failed opens, a return to its workbench and a reopen in place", async () => {
  const { root, folders, runtimes, held, stopped } = await harness();
  await runtimes.create(folders.a, "A");
  const a = runtimes.foreground;
  const sessionA = await startTurn(a.sessions);
  await held.reached;
  const service = await a.sessions.run((current) => current, false);
  await expect(runtimes.open(join(root, "nowhere"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(runtimes.open(folders.plain)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(runtimes.foreground).toBe(a);
  expect(runtimes.all()).toEqual([a]);
  await runtimes.open(folders.b);
  await runtimes.open(folders.a);
  expect(runtimes.foreground).toBe(a);
  // B had no work of its own, so returning to A released it.
  expect(lock(folders.b)).toBe(false);
  expect(stopped).toEqual([folders.b]);
  await runtimes.open(folders.a);
  expect(runtimes.foreground).toBe(a);
  expect(await a.sessions.run((current) => current, false)).toBe(service);
  const done = completion(a.sessions, sessionA);
  held.release();
  expect(await done).toEqual({ stopReason: "end" });
  expect(await a.sessions.run((current) => lastAnswer(current, sessionA))).toContain("3.3 V");
  expect(lock(folders.a)).toBe(true);
});

// REQ-FUNC-4af886f8
it("closes the foreground workbench while a background turn continues and completes", async () => {
  const { folders, runtimes, held, stopped } = await harness();
  await runtimes.create(folders.a, "A");
  const a = runtimes.foreground;
  const sessionA = await startTurn(a.sessions);
  await held.reached;
  await runtimes.open(folders.b);
  const b = runtimes.foreground;
  const done = completion(a.sessions, sessionA);
  await runtimes.close();
  expect(runtimes.foreground).toBe(b);
  expect(lock(folders.b)).toBe(false);
  expect(lock(folders.a)).toBe(true);
  expect(stopped).toEqual([folders.b]);
  held.release();
  expect(await done).toEqual({ stopReason: "end" });
  await vi.waitFor(() => expect(lock(folders.a)).toBe(false));
  expect(runtimes.all()).toEqual([b]);
  expect(stopped).toEqual([folders.b, folders.a]);
});

// REQ-REL-436f00da
it("closes the sessions of every runtime and releases every lock on exit", async () => {
  const { folders, runtimes, held } = await harness();
  await runtimes.create(folders.a, "A");
  const a = runtimes.foreground;
  const sessionA = await startTurn(a.sessions);
  await held.reached;
  const done = completion(a.sessions, sessionA);
  await runtimes.open(folders.b);
  expect(lock(folders.a) && lock(folders.b)).toBe(true);
  await runtimes.closeSessions();
  expect(await done).toEqual({ stopReason: "aborted" });
  await runtimes.closeWorkbenches();
  expect(lock(folders.a) || lock(folders.b)).toBe(false);
  await expect(runtimes.open(folders.a)).rejects.toMatchObject({ code: "BUSY" });
});
