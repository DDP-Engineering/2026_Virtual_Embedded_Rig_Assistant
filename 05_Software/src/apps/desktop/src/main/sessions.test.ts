import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, SessionService, SkillCatalog, WriteQueue } from "@vera/core";
import { workbenchSchema } from "@vera/shared";
import { expect, it } from "vitest";
import { SessionsHost } from "./sessions.js";

it("locks update shutdown admission only after already accepted host work completes", async () => {
  const host = new SessionsHost({} as never);
  let release: () => void = () => {};
  const held = new Promise<void>((accept) => {
    release = accept;
  });
  const pending = host.lifecycle(() => held);
  expect(host.beginShutdown()).toBe(false);
  release();
  await pending;
  expect(host.beginShutdown()).toBe(true);
  await expect(host.run(() => undefined)).rejects.toMatchObject({ code: "BUSY" });
  await expect(host.lifecycle(async () => undefined)).rejects.toMatchObject({ code: "BUSY" });
  await host.close();
});

it("awaits pending-change recovery before returning a session snapshot from a reopened host", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-host-recovery-"));
  await mkdir(join(root, ".vera"));
  const storage = await openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const gateway = { capabilities: () => ({}), stream: async function* () {}, models: async () => ({}) };
  const clock = { now: () => new Date(), sleep: async () => {} };
  const core = new SessionService({
    root,
    db: storage.db,
    gateway,
    clock,
    model: () => "replay/test",
    prompt: () => "test",
  } as never);
  const session = core.create();
  await core.close();
  await writeFile(join(root, "file.txt"), "after\n");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  storage.db
    .prepare(
      "INSERT INTO changes(session_id,tool_call_id,path,before_sha256,after_sha256,diff,status) VALUES (?,?,?, ?,?,?,'pending')",
    )
    .run(
      session.id,
      "call",
      "file.txt",
      hash("before\n"),
      hash("after\n"),
      "--- file.txt\n+++ file.txt\n@@ -1 +1 @@\n-before\n+after\n",
    );
  const config = workbenchSchema.parse({ format: 1, id: "wb_01J00000000000000000000000", name: "Board" });
  const host = new SessionsHost({
    workbench: {
      getSnapshot: () => ({ folder: root, config, readOnly: false }),
      getDatabase: () => storage.db,
      getConfig: async () => ({ config }),
      getPinned: async () => ({ content: "" }),
      skillCatalog: () => new SkillCatalog({ root, disabled: () => [] }),
      getWriteQueue: () => new WriteQueue(),
      assertSessionWritable: () => {},
    },
    settings: { get: () => ({ settings: { limits: { maxToolCallsPerTurn: 50 } } }) },
    gateway: () => ({ api: gateway }),
    clock,
    credentials: { scrub: (s: string) => s },
  } as never);
  try {
    const snapshot = await host.run((service) => service.get(session.id));
    expect(snapshot.snapshot.changes).toEqual([{ changeId: 1, path: "file.txt", added: 1, removed: 1 }]);
    expect(storage.db.prepare("SELECT status FROM changes").get()).toEqual({ status: "applied" });
  } finally {
    await host.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("denies foreign and detached subscription frames and malformed requests before core setup", async () => {
  const frame = { url: "vera://app/index.html" };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  let destroyed = false;
  const target = { webContents: { ...contents, isDestroyed: () => destroyed }, url: frame.url };
  const host = new SessionsHost({
    target: () => target,
    workbench: {
      getSnapshot: () => {
        throw Error("must not dispatch");
      },
    },
  } as never);
  const payload = { sessionId: "ses_01J00000000000000000000000", sinceSeq: 0, subscriptionId: "s" };
  expect(
    await host.subscription({ sender: contents, senderFrame: frame }, "subscribe", payload),
  ).toMatchObject({ ok: false, error: { code: "DENIED" } });
  expect(
    await host.subscription({ sender: target.webContents, senderFrame: null }, "subscribe", payload),
  ).toMatchObject({ ok: false, error: { code: "DENIED" } });
  expect(
    await host.subscription({ sender: target.webContents, senderFrame: frame }, "subscribe", {
      ...payload,
      sinceSeq: -1,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID" } });
  destroyed = true;
  expect(
    await host.subscription({ sender: target.webContents, senderFrame: frame }, "subscribe", payload),
  ).toMatchObject({ ok: false, error: { code: "DENIED" } });
});

// REQ-NFR-a881a281
it("computes the program prompt entries once until plugins or plugin skills change", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-host-programs-"));
  await mkdir(join(root, ".vera"));
  const storage = await openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const gateway = { capabilities: () => ({}), stream: async function* () {}, models: async () => ({}) };
  const config = workbenchSchema.parse({ format: 1, id: "wb_01J00000000000000000000000", name: "Board" });
  const plugin = {
    manifest: { id: "tools", description: "Tools.", programs: { tool: {} } },
    record: { programs: {}, sha256: "a".repeat(64) },
  };
  const skills = [{ name: "tool-guide", description: "d", source: "plugin", plugin: "tools", enabled: true }];
  let resolved = 0;
  const host = new SessionsHost({
    workbench: {
      getSnapshot: () => ({ folder: root, config, readOnly: false }),
      getDatabase: () => storage.db,
      getConfig: async () => ({ config }),
      getPinned: async () => ({ content: "" }),
      skillCatalog: () => ({ list: async () => skills.map((skill) => ({ ...skill })) }),
      loadPlugins: async () => [plugin],
      getWriteQueue: () => new WriteQueue(),
      assertSessionWritable: () => {},
    },
    settings: { get: () => ({ settings: { limits: { maxToolCallsPerTurn: 50 }, webAccess: {} } }) },
    gateway: () => ({ api: gateway }),
    clock: { now: () => new Date(), sleep: async () => {} },
    credentials: { scrub: (s: string) => s },
    programs: {
      runner: {},
      resolver: {
        resolve: async () => {
          resolved++;
          return { executable: "/bin/tool", version: "1.0" };
        },
      },
    },
  } as never);
  try {
    for (let i = 0; i < 3; i++) await host.run(() => undefined);
    expect(resolved).toBe(1);
    host.invalidatePrograms();
    await host.run(() => undefined);
    expect(resolved).toBe(2);
    skills.push({ name: "tool-more", description: "d", source: "plugin", plugin: "tools", enabled: true });
    await host.run(() => undefined);
    expect(resolved).toBe(3);
    await host.run(() => undefined);
    expect(resolved).toBe(3);
    plugin.record.sha256 = "b".repeat(64);
    await host.run(() => undefined);
    expect(resolved).toBe(4);
  } finally {
    await host.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
