import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as core from "../index.js";
import { ReplayGateway } from "../llm/replay.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(permissions?: core.PermissionEngine) {
  const root = await mkdtemp(join(tmpdir(), "vera-edit-session-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "file.txt"), "old\n");
  await writeFile(
    join(root, "scripts/edit.jsonl"),
    [
      { match: "edit", toolCalls: [{ name: "read", args: { path: "file.txt" } }] },
      { toolCalls: [{ name: "edit", args: { path: "file.txt", oldString: "old", newString: "new" } }] },
      { text: "Done" },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  );
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  const queue = new core.WriteQueue();
  const host: core.SessionHost = {
    root,
    db: handle.db,
    gateway,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/edit",
    prompt: () => "Test",
    writeQueue: queue,
    ...(permissions ? { permissions } : {}),
  };
  const service = new core.SessionService(host);
  cleanup.push(() => service.close());
  return { root, handle, gateway, host, service, queue };
}
// REQ-FUNC-18000001 REQ-FUNC-18000002
it("lists only applied session changes in time/id order with patch-content counts", async () => {
  const { service, handle } = await setup();
  const a = service.create(),
    b = service.create();
  expect(typeof service.listChanges).toBe("function");
  expect(service.listChanges(a.id)).toEqual([]);
  const insert = handle.db.prepare(
    "INSERT INTO changes(id,session_id,path,diff,status,created_at) VALUES(?,?,?,?,?,?)",
  );
  const diff = "--- board.txt\n+++ board.txt\n@@ -1,1 +1,2 @@\n-old\n+new\n+++literal\n";
  insert.run(1, a.id, "late.txt", diff, "applied", "2026-10-12T02:00:00.000Z");
  insert.run(2, a.id, "early.txt", diff, "applied", "2026-10-12T01:00:00.000Z");
  insert.run(3, a.id, "tie.txt", diff, "applied", "2026-10-12T01:00:00.000Z");
  insert.run(4, a.id, "pending.txt", diff, "pending", "2026-10-12T01:00:00.000Z");
  insert.run(5, a.id, "conflict.txt", diff, "conflict", "2026-10-12T01:00:00.000Z");
  insert.run(6, b.id, "other.txt", diff, "applied", "2026-10-12T01:00:00.000Z");
  expect(service.listChanges(a.id).map((c) => c.changeId)).toEqual([2, 3, 1]);
  expect(service.listChanges(a.id)[0]).toEqual({
    changeId: 2,
    sessionId: a.id,
    path: "early.txt",
    createdAt: "2026-10-12T01:00:00.000Z",
    added: 2,
    removed: 1,
  });
  expect(service.listChanges(b.id).map((c) => c.changeId)).toEqual([6]);
  expect(() => service.listChanges("bad")).toThrow();
  expect(() => service.listChanges("ses_00000000000000000000000000")).toThrow(
    expect.objectContaining({ code: "NOT_FOUND" }),
  );
  for (const id of [4, 5, 99])
    expect(() => service.getChange(id)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => service.getChange(id)).toThrow(expect.objectContaining({ code: "INVALID" }));
});

it("retains approved edit counts and stored diff after file mutation and service restart", async () => {
  const { service, host, root } = await setup();
  const session = service.create();
  service.send(session.id, "edit");
  await expect.poll(() => service.get(session.id).snapshot.approvals.length).toBe(1);
  const approval = service.get(session.id).snapshot.approvals[0];
  if (!approval) throw Error("approval missing");
  service.decideApproval({
    sessionId: session.id,
    approvalId: approval.approvalId,
    requestSha256: approval.requestSha256,
    decision: "approved",
  });
  await service.waitIdle(session.id);
  expect(typeof service.listChanges).toBe("function");
  const rows = service.listChanges(session.id);
  expect(rows).toHaveLength(1);
  const id = rows[0]?.changeId ?? 0;
  const detail = service.getChange(id);
  expect(detail).toMatchObject({ sessionId: session.id, path: "file.txt", added: 1, removed: 1 });
  expect(detail.diff).toContain("-old\n+new");
  await writeFile(join(root, "file.txt"), "later content\n");
  expect(service.getChange(id)).toEqual(detail);
  await service.close();
  expect(() => service.getChange(id)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  const reopened = new core.SessionService(host);
  cleanup.push(() => reopened.close());
  await reopened.waitReady();
  expect(reopened.listChanges(session.id)).toEqual(rows);
  expect(reopened.getChange(id)).toEqual(detail);
});
