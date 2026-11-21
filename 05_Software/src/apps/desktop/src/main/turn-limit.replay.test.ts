import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SettingsService, TurnLimit, WorkbenchService } from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { resolveAdvanced, type TurnCapacity } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import { SessionRouter } from "./session-router.js";
import { SessionsHost } from "./sessions.js";
import { WorkbenchRuntimes } from "./workbench-runtimes.js";

/** A replay delay that holds every stream of its runtime until released. */
function gate() {
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((done) => {
    reach = done;
  });
  const released = new Promise<void>((done) => {
    release = done;
  });
  const delay = (signal: AbortSignal) =>
    new Promise<void>((done, fail) => {
      reach();
      signal.addEventListener("abort", () => fail(signal.reason), { once: true });
      void released.then(done);
    });
  return { reached, release, delay };
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * Two workbench runtimes as Desktop main composes them, sharing one TurnLimit read from the saved
 * Concurrent turns setting; every capacity announcement is recorded.
 */
async function harness(delays: ((signal: AbortSignal) => Promise<void>)[]) {
  const root = await mkdtemp(join(tmpdir(), "vera-turn-limit-main-"));
  const folders = { a: join(root, "a"), b: join(root, "b") };
  for (const folder of Object.values(folders)) {
    await mkdir(folder);
    await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\n");
  }
  const files = createFileAccess(systemClock);
  const paths = { userData: root, settings: join(root, "settings.json"), logs: join(root, "logs") };
  const settings = new SettingsService({ files, paths, uuid: randomUUID, changed: () => limit.refresh() });
  await settings.load();
  const announced: TurnCapacity[] = [];
  const limit = new TurnLimit({
    limit: () => resolveAdvanced("concurrentTurns", { app: settings.get().settings.advanced }).value,
    changed: (state) => announced.push(state),
  });
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
          modelReference: (ref: string | null | undefined) => ref ?? "replay/ui-slow",
        }),
        credentials: { scrub: (text: string) => text, knownSecrets: () => [] },
        clock: systemClock,
        version: "0.0.0",
        target: () => undefined,
        emit: () => {},
        settled,
        admission: limit,
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
  /** Creates a session in the foreground workbench and sends to it; the session ID, or the refusal. */
  const start = (text: string) =>
    router.inWorkbench(undefined, (service) => {
      const id = service.create("replay/ui-slow").id;
      service.send(id, text);
      return id;
    });
  const done = async (id: string) =>
    (await router.inSession(id, (service) => ({ done: service.waitIdle(id) }), { purpose: "metadata" })).done;
  return { root, paths, files, folders, settings, limit, announced, runtimes, router, start, done };
}

// REQ-FUNC-52e97b95 REQ-FUNC-33cd5f9f REQ-REL-11f00fcd REQ-DATA-84718b36
it("bounds turns across a background and a foreground workbench by the saved limit", async () => {
  const heldA = gate();
  const heldB = gate();
  const h = await harness([heldA.delay, heldB.delay]);
  await h.settings.update({ advanced: { concurrentTurns: 2 } });
  expect(h.announced.at(-1)).toEqual({ active: 0, limit: 2 });

  await h.runtimes.create(h.folders.a, "A");
  const sessionA = await h.start("Slow answer");
  await heldA.reached;
  await h.runtimes.create(h.folders.b, "B");
  expect(h.runtimes.all()).toHaveLength(2);
  const sessionB = await h.start("Slow answer");
  await heldB.reached;
  expect(h.limit.state()).toEqual({ active: 2, limit: 2 });

  await expect(h.start("Slow answer")).rejects.toEqual(
    expect.objectContaining({ code: "TURN_LIMIT", params: { limit: 2 } }),
  );
  expect(h.limit.state()).toEqual({ active: 2, limit: 2 });

  // Closing the foreground workbench ends its turn and frees its slot; the background turn runs on.
  const doneA = h.done(sessionA);
  const doneB = h.done(sessionB);
  await h.runtimes.close();
  expect(await doneB).toEqual({ stopReason: "aborted" });
  expect(h.limit.state()).toEqual({ active: 1, limit: 2 });
  heldA.release();
  expect(await doneA).toEqual({ stopReason: "end" });
  expect(h.limit.state()).toEqual({ active: 0, limit: 2 });
  expect(h.announced.map(({ active }) => active)).toEqual([0, 1, 2, 1, 0]);

  // The saved limit is read again after a restart, in the version 1 settings file.
  const saved = JSON.parse(await readFile(h.paths.settings, "utf8"));
  expect(saved.schemaVersion).toBe(1);
  expect(saved.advanced).toEqual({ concurrentTurns: 2 });
  const restarted = new SettingsService({
    files: h.files,
    paths: h.paths,
    uuid: randomUUID,
    changed: () => {},
  });
  await restarted.load();
  expect(resolveAdvanced("concurrentTurns", { app: restarted.get().settings.advanced }).value).toBe(2);
});
