import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { requestJson, requestSha256 } from "../agent/approvals.js";
import * as core from "../index.js";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function setup(path = "docs/notes/bringup.md", fabricated = false) {
  const root = await mkdtemp(join(tmpdir(), "vera-approvals-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "docs/notes"), { recursive: true });
  await writeFile(join(root, path), "old\n");
  await writeFile(
    join(root, "scripts/edit.jsonl"),
    [
      ...(fabricated ? [] : [{ match: "edit", toolCalls: [{ name: "read", args: { path } }] }]),
      {
        toolCalls: [
          {
            name: fabricated ? "write" : "edit",
            args: fabricated ? { path, content: "new\n" } : { path, oldString: "old", newString: "new" },
          },
        ],
      },
      { text: "Done" },
    ]
      .map((v) => JSON.stringify(v))
      .join("\n"),
  );
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  closes.push(async () => handle.close());
  const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  const catalogs: string[][] = [];
  const host: core.SessionHost = {
    root,
    db: handle.db,
    gateway: {
      selectedModel: (id) => gateway.selectedModel(id),
      capabilities: (model) => gateway.capabilities(model),
      models: (id, signal) => gateway.models(id, signal),
      async *stream(request: LlmRequest) {
        catalogs.push(request.tools?.map((t) => t.name) ?? []);
        yield* gateway.stream(request);
      },
    },
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/edit",
    prompt: () => "Test",
  };
  const service = new core.SessionService(host);
  closes.push(() => service.close());
  await service.waitReady();
  return { root, path, handle, host, service, catalogs };
}
async function waiting(service: core.SessionService, id: string) {
  await expect
    .poll(() => service.get(id).snapshot.approvals.find((a) => !a.decision), { timeout: 1000 })
    .toBeDefined();
  const approval = service.get(id).snapshot.approvals.find((a) => !a.decision);
  if (!approval) throw Error("Pending approval disappeared");
  return approval;
}
function decide(
  service: core.SessionService,
  id: string,
  approval: { approvalId: string; requestSha256: string },
  decision: "approved" | "denied",
  switchToAutoEdit = false,
) {
  // Access through a structural host type so the red test fails on behavior, not import resolution.
  return (
    service as core.SessionService & {
      decideApproval(request: {
        sessionId: string;
        approvalId: string;
        requestSha256: string;
        decision: "approved" | "denied";
        switchToAutoEdit?: boolean;
      }): void;
    }
  ).decideApproval({
    sessionId: id,
    ...approval,
    decision,
    ...(switchToAutoEdit ? { switchToAutoEdit } : {}),
  });
}
it.each(["approved", "denied"] as const)("ask %s binds exact request and continues end", async (decision) => {
  const { service, root, path, handle } = await setup();
  const s = service.create();
  service.send(s.id, "edit");
  const a = await waiting(service, s.id);
  expect(service.list()[0]?.status).toBe("awaiting_approval");
  expect(await readFile(join(root, path), "utf8")).toBe("old\n");
  const row = handle.db.prepare("SELECT * FROM approvals").get() as {
    request_json: string;
    request_sha256: string;
  };
  expect(JSON.parse(row.request_json)).toMatchObject({ sessionId: s.id, tool: "edit", path, bytes: 4 });
  expect(createHash("sha256").update(row.request_json).digest("hex")).toBe(a.requestSha256);
  expect(a.diff).toContain("-old");
  expect(a.diff).toContain("+new");
  expect(() => decide(service, s.id, { ...a, requestSha256: "0".repeat(64) }, decision)).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  decide(service, s.id, a, decision);
  expect(() => decide(service, s.id, a, decision)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(await readFile(join(root, path), "utf8")).toBe(decision === "approved" ? "new\n" : "old\n");
  const final = handle.db.prepare("SELECT decision,decided_by,consumed_at FROM approvals").get();
  expect(final).toMatchObject({
    decision,
    decided_by: "user",
    consumed_at: decision === "approved" ? expect.any(String) : null,
  });
  if (decision === "denied") {
    expect(
      handle.db.prepare("SELECT status,result_json FROM tool_calls WHERE name='edit'").get(),
    ).toMatchObject({
      status: "denied",
      result_json: expect.stringContaining("The user denied this change."),
    });
    expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  }
});
it("auto-edit ordinary path records mode, protected paths wait including native Windows case aliases", async () => {
  const { service, root, path, handle } = await setup();
  const s = service.create(null, "auto-edit");
  service.send(s.id, "edit");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(await readFile(join(root, path), "utf8")).toBe("new\n");
  expect(handle.db.prepare("SELECT decision,decided_by FROM approvals").get()).toEqual({
    decision: "approved",
    decided_by: "mode",
  });
  for (const protectedName of ["WORKBENCH.md", ...(process.platform === "win32" ? ["workbench.MD"] : [])]) {
    const p = await setup(protectedName);
    const session = p.service.create(null, "auto-edit");
    p.service.send(session.id, "edit");
    const a = await waiting(p.service, session.id);
    decide(p.service, session.id, a, "denied");
    await p.service.waitIdle(session.id);
    expect(await readFile(join(p.root, protectedName), "utf8")).toBe("old\n");
  }
});
it("read-only catalog and fabricated execution reject writes", async () => {
  const { service, root, path, catalogs, handle } = await setup(undefined, true);
  const s = service.create(null, "read-only");
  service.send(s.id, "edit");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(catalogs.length).toBeGreaterThan(0);
  for (const catalog of catalogs) {
    expect(catalog).not.toContain("write");
    expect(catalog).not.toContain("edit");
  }
  expect(await readFile(join(root, path), "utf8")).toBe("old\n");
  expect(handle.db.prepare("SELECT * FROM approvals").all()).toEqual([]);
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
});
it.each(["stop", "mode"])("%s aborts pending write without blocking app admission", async (action) => {
  const { service, root, path, handle } = await setup();
  const s = service.create();
  service.send(s.id, "edit");
  const a = await waiting(service, s.id);
  if (action === "stop") service.stop(s.id);
  else service.setMode(s.id, "read-only");
  await service.waitIdle(s.id);
  expect(await readFile(join(root, path), "utf8")).toBe("old\n");
  expect(handle.db.prepare("SELECT decision FROM approvals").get()).toEqual({ decision: "aborted" });
  expect(() => decide(service, s.id, a, "approved")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  if (action === "mode") expect(service.get(s.id).snapshot.mode).toBe("read-only");
});
it("file changed during approval conflicts immutable output and switch emits confirmed mode", async () => {
  const { service, root, path, handle } = await setup();
  const s = service.create();
  service.send(s.id, "edit");
  const a = await waiting(service, s.id);
  await writeFile(join(root, path), "other\n");
  decide(service, s.id, a, "approved", true);
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(await readFile(join(root, path), "utf8")).toBe("other\n");
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  expect(service.get(s.id).snapshot.mode).toBe("auto-edit");
  expect(
    new core.EventsRepository(handle.db).list(s.id).map((e) => JSON.parse(e.payload_json)),
  ).toContainEqual({ type: "session.updated", mode: "auto-edit" });
  expect(JSON.stringify(service.get(s.id))).toContain("Conflict");
});
it("restart aborts approvals, pairs interrupted tools, closes awaiting status and rejects old decision", async () => {
  const { service, host, handle } = await setup();
  const s = service.create();
  service.send(s.id, "edit");
  const a = await waiting(service, s.id);
  const copyRoot = await mkdtemp(join(tmpdir(), "vera-restart-"));
  closes.push(() => rm(copyRoot, { recursive: true, force: true }));
  const dbPath = join(copyRoot, "vera.db");
  await handle.db.backup(dbPath);
  service.stop(s.id);
  await service.waitIdle(s.id);
  const copy = await core.openDb(dbPath, { workbenchId: "wb_test", appVersion: "0" });
  closes.push(async () => copy.close());
  const resumed = new core.SessionService({ ...host, db: copy.db });
  closes.push(() => resumed.close());
  await resumed.waitReady();
  expect(resumed.list()[0]?.status).toBe("idle");
  expect(copy.db.prepare("SELECT decision FROM approvals").get()).toEqual({ decision: "aborted" });
  expect(resumed.get(s.id).snapshot.approvals[0]?.decision).toBe("aborted");
  expect(() => decide(resumed, s.id, a, "approved")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(new core.MessagesRepository(copy.db).list(s.id).filter((r) => r.role === "toolResult")).toHaveLength(
    2,
  );
  expect(JSON.stringify(resumed.get(s.id))).toContain("Interrupted");
  await resumed.close();
  const before = copy.db.prepare("SELECT * FROM events").all();
  const twice = new core.SessionService({ ...host, db: copy.db });
  closes.push(() => twice.close());
  await twice.waitReady();
  expect(copy.db.prepare("SELECT * FROM events").all()).toEqual(before);
});
it("sorts nested request keys while preserving array order and binds all exact-change fields", () => {
  expect(requestJson({ z: 1, a: { z: 2, a: 3 }, list: [3, 1] })).toBe(
    '{"a":{"a":3,"z":2},"list":[3,1],"z":1}',
  );
  const request: core.ChangeRequest = {
    workbench: "/bench",
    sessionId: "session",
    turnId: "turn",
    callId: "call",
    tool: "write",
    path: "f",
    args: { path: "f", content: "x" },
    existed: false,
    beforeSha256: null,
    afterSha256: "abc",
    diff: "+x",
    bytes: 1,
    protected: false,
  };
  const digest = requestSha256(request);
  for (const value of [
    { path: "g" },
    { afterSha256: "def" },
    { beforeSha256: "abc" },
    { diff: "+y" },
    { bytes: 2 },
    { turnId: "other" },
    { args: { path: "f", content: "y" } },
  ])
    expect(requestSha256({ ...request, ...value })).not.toBe(digest);
});
it("handles immediate observer decisions, foreign-session conflicts and releases the write queue while waiting", async () => {
  const { service, host, root, path } = await setup();
  const queue = new core.WriteQueue();
  host.writeQueue = queue;
  const instance = new core.SessionService(host);
  closes.push(() => instance.close());
  await instance.waitReady();
  const s = instance.create(),
    other = instance.create();
  instance.send(s.id, "edit");
  const a = await waiting(instance, s.id);
  expect(() => decide(instance, other.id, a, "approved")).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  let saved = false;
  await queue.run(async () => {
    saved = true;
  });
  expect(saved).toBe(true);
  decide(instance, s.id, a, "denied");
  await instance.waitIdle(s.id);
  const immediate = service.create();
  service.subscribe(immediate.id, 0, (_seq, e) => {
    if (e.type === "approval.requested") decide(service, immediate.id, e, "approved");
  });
  service.send(immediate.id, "edit");
  expect(await service.waitIdle(immediate.id)).toEqual({ stopReason: "end" });
  expect(await readFile(join(root, path), "utf8")).toBe("new\n");
});
it("revokes automatic grants queued before a switch to ask", async () => {
  const { host, handle, root, path } = await setup();
  const queue = new core.WriteQueue();
  host.writeQueue = queue;
  const service = new core.SessionService(host);
  closes.push(() => service.close());
  await service.waitReady();
  let release!: () => void;
  const barrier = queue.run(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  const s = service.create(null, "auto-edit");
  service.send(s.id, "edit");
  await expect
    .poll(() => handle.db.prepare("SELECT consumed_at FROM approvals WHERE session_id=?").get(s.id))
    .toMatchObject({ consumed_at: expect.any(String) });
  service.setMode(s.id, "ask");
  release();
  await barrier;
  await service.waitIdle(s.id);
  expect(await readFile(join(root, path), "utf8")).toBe("old\n");
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
});
it("refuses prepared diffs containing known credential data before approval persistence", async () => {
  const { service, host, root, path, handle } = await setup();
  host.scrub = (text) => text.replaceAll("secret-token", "[redacted]");
  await writeFile(join(root, path), "old\nsecret-token\n");
  const s = service.create(null, "auto-edit");
  service.send(s.id, "edit");
  await service.waitIdle(s.id);
  expect(await readFile(join(root, path), "utf8")).toBe("old\nsecret-token\n");
  expect(handle.db.prepare("SELECT * FROM approvals").all()).toEqual([]);
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  expect(JSON.stringify(handle.db.prepare("SELECT payload_json FROM events").all())).not.toContain(
    "secret-token",
  );
});

it.each(["ownership", "database"])("settles a cancelled gate wait after %s failure", async (failure) => {
  const { service, handle } = await setup();
  const s = service.create();
  let owned = true;
  const gate = new core.ApprovalGate({
    db: handle.db,
    now: () => new Date().toISOString(),
    active: () => true,
    mode: () => "ask",
    assertWritable: () => {
      if (!owned) throw Error("ownership lost");
    },
    record: () => () => {},
  });
  const signal = new AbortController();
  const request: core.ChangeRequest = {
    workbench: "/bench",
    sessionId: s.id,
    turnId: "turn",
    callId: "call",
    tool: "write",
    path: "new.txt",
    args: { path: "new.txt", content: "x" },
    existed: false,
    beforeSha256: null,
    afterSha256: "abc",
    diff: "+x",
    bytes: 1,
    protected: false,
  };
  const wait = gate.request(request, signal.signal).then(
    () => "resolved",
    () => "rejected",
  );
  if (failure === "ownership") owned = false;
  else
    handle.db.exec(
      "CREATE TRIGGER fail_approval BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT, 'database failure'); END;",
    );
  try {
    expect(() => gate.abort(s.id, "user")).toThrow();
    const outcome = await Promise.race([wait, new Promise((done) => setTimeout(() => done("pending"), 30))]);
    expect(outcome).toBe("rejected");
    expect(handle.db.prepare("SELECT decision FROM approvals").get()).toEqual({ decision: null });
    expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  } finally {
    owned = true;
    handle.db.exec("DROP TRIGGER IF EXISTS fail_approval");
    gate.abort(s.id, "user");
    await wait;
  }
});

it("drains a real session on close after losing ownership during an approval wait", async () => {
  const { service, host, handle, root, path } = await setup();
  const s = service.create();
  service.send(s.id, "edit");
  await waiting(service, s.id);
  host.assertWritable = () => {
    throw Error("ownership lost");
  };
  await expect(service.close()).resolves.toBeUndefined();
  expect(await readFile(join(root, path), "utf8")).toBe("old\n");
  expect(handle.db.prepare("SELECT decision FROM approvals").get()).toEqual({ decision: null });
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
});
