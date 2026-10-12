import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
it("executes replay read/edit with exact prepared permission metadata, changes row and persisted event", async () => {
  const requests: core.ChangeRequest[] = [];
  const { service, root, handle } = await setup({
    allow: ({ prepared, tool }) => {
      if (tool.class === "write") {
        expect(prepared).toBeDefined();
        requests.push(prepared as core.ChangeRequest);
      }
      return true;
    },
  });
  const s = service.create(null, "auto-edit");
  service.send(s.id, "edit");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
  const row = handle.db.prepare("SELECT * FROM changes").get() as {
    id: number;
    diff: string;
    tool_call_id: string;
  };
  expect(row).toMatchObject({ session_id: s.id, path: "file.txt", status: "applied" });
  expect(row.diff).toContain("-old");
  expect(row.diff).toContain("+new");
  expect(requests[0]).toMatchObject({
    sessionId: s.id,
    callId: row.tool_call_id,
    tool: "edit",
    path: "file.txt",
    existed: true,
    bytes: 4,
    protected: false,
  });
  expect(
    new core.EventsRepository(handle.db).list(s.id).map((e) => JSON.parse(e.payload_json)),
  ).toContainEqual({ type: "change.recorded", changeId: row.id, path: "file.txt", added: 1, removed: 1 });
});
it("holds no queue position while two session approvals wait and conflicts the stale loser", async () => {
  const pending: (() => void)[] = [];
  const { service, root, handle, queue } = await setup({
    allow: async ({ tool }) => {
      if (tool.class === "write") await new Promise<void>((done) => pending.push(done));
      return true;
    },
  });
  const a = service.create(null, "auto-edit"),
    b = service.create(null, "auto-edit");
  service.send(a.id, "edit");
  service.send(b.id, "edit");
  await expect.poll(() => pending.length).toBe(2);
  let appSaved = false;
  await queue.run(async () => {
    appSaved = true;
  });
  expect(appSaved).toBe(true);
  pending.forEach((done) => {
    done();
  });
  await Promise.all([service.waitIdle(a.id), service.waitIdle(b.id)]);
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
  expect(handle.db.prepare("SELECT count(*) n FROM changes WHERE status='applied'").get()).toEqual({ n: 1 });
  const outcomes = handle.db.prepare("SELECT status,result_json FROM tool_calls WHERE name='edit'").all() as {
    status: string;
    result_json: string;
  }[];
  expect(outcomes.map((x) => x.status).sort()).toEqual(["error", "ok"]);
  expect(outcomes.find((x) => x.status === "error")?.result_json).toMatch(/Conflict/);
});
it("keeps the default read-only catalog and hard rejects read-only mode with an injected policy", async () => {
  for (const permissions of [undefined, { allow: () => true }]) {
    const { service, root, handle } = await setup(permissions);
    const s = service.create(null, permissions ? "read-only" : "ask");
    service.send(s.id, "edit");
    await service.waitIdle(s.id);
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("old\n");
    expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  }
});

it("denies prepared changes without rows and contains permission errors through the host scrubber", async () => {
  const { service, root, handle, host } = await setup({
    allow: ({ tool }) => {
      if (tool.class === "write") throw Error("secret-denial");
      return true;
    },
  });
  host.scrub = (text) => text.replaceAll("secret-denial", "[redacted]");
  const s = service.create(null, "auto-edit");
  service.send(s.id, "edit");
  await service.waitIdle(s.id);
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("old\n");
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  expect(JSON.stringify(service.get(s.id))).not.toContain("secret-denial");
  expect(JSON.stringify(service.get(s.id))).toContain("[redacted]");
});
