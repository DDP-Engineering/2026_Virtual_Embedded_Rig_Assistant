import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { SessionService } from "../sessions/service.js";
import { openDb } from "./db.js";
import { initializeDatabase } from "./schema.js";

const fixtures = resolve("tests/fixtures/upgrade");
const interrupted = JSON.parse(await readFile(join(fixtures, "interrupted.json"), "utf8"));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const preservedTables = [
  "sessions",
  "messages",
  "events",
  "tool_calls",
  "approvals",
  "changes",
  "documents",
  "chunks",
];
function rows(db: Database.Database) {
  return Object.fromEntries(
    preservedTables.map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]),
  );
}
function seed(db: Database.Database) {
  for (const s of interrupted.sessions) {
    db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,0)").run(
      s.id,
      s.title,
      interrupted.createdAt,
      interrupted.createdAt,
      "replay/read-then-answer",
      "ask",
      s.status,
    );
    db.prepare("INSERT INTO messages VALUES (?,1,'assistant',?,?)").run(
      s.id,
      s.messageJson,
      interrupted.createdAt,
    );
    for (const [index, event] of s.events.entries())
      db.prepare("INSERT INTO events VALUES (?,?,?,?,?)").run(
        s.id,
        index + 1,
        event.type,
        JSON.stringify(event),
        interrupted.createdAt,
      );
    db.prepare("INSERT INTO tool_calls VALUES (?,?,'edit','{}',NULL,'pending',?,NULL)").run(
      s.callId,
      s.id,
      interrupted.createdAt,
    );
    if (s.approvalId)
      db.prepare(
        "INSERT INTO approvals(id,session_id,turn_id,tool_call_id,request_sha256,request_json) VALUES (?,?,?,?,?,'{}')",
      ).run(s.approvalId, s.id, s.turnId, s.callId, s.requestSha256);
  }
  for (const c of interrupted.changes)
    db.prepare(
      "INSERT INTO changes(session_id,tool_call_id,path,before_sha256,after_sha256,diff,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
    ).run(
      interrupted.sessions[1].id,
      c.callId,
      c.path,
      c.beforeSha256,
      c.afterSha256,
      c.diff,
      interrupted.createdAt,
    );
  db.exec(
    "INSERT INTO documents(id,path,kind,sha256,bytes,status) VALUES (1,'docs/register.txt','text','fixture',26,'indexed'); INSERT INTO chunks VALUES(1,1,0,'{\"type\":\"lines\",\"start\":1,\"end\":1}','I2C1_CR1 previous register',26)",
  );
}
function integrity(db: Database.Database) {
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_key_check")).toEqual([]);
}

it("recovers interrupted current-schema sessions, preserves files/history and cannot reuse old approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-session-recovery-"));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "docs"));
  const path = join(root, ".vera/vera.db");
  let handle: Awaited<ReturnType<typeof openDb>> | undefined;
  let service: SessionService | undefined;
  try {
    const previous = new Database(path);
    initializeDatabase(previous, { workbenchId: "wb_fixture", appVersion: "0.0.0" });
    seed(previous);
    previous.close();
    for (const c of interrupted.changes) await writeFile(join(root, c.path), c.current);
    async function fileState() {
      return Promise.all(
        interrupted.changes.map(async (c: { path: string }) => {
          const path = join(root, c.path),
            metadata = await stat(path);
          return {
            path: c.path,
            sha256: hash(await readFile(path)),
            size: metadata.size,
            mtime: metadata.mtimeMs,
            mode: metadata.mode,
          };
        }),
      );
    }
    const before = await fileState();
    handle = await openDb(path, { workbenchId: "wb_fixture", appVersion: "0.32.1" });
    const host = {
      db: handle.db,
      root,
      gateway: new ReplayGateway({ dir: resolve("tests/fixtures/llm-scripts"), now: () => 123 }),
      clock: { now: () => new Date(123), sleep: async () => {} },
      model: () => "replay/read-then-answer",
      prompt: () => "Read the board.",
    };
    service = new SessionService(host);
    await service.waitReady();
    expect(await fileState()).toEqual(before);
    expect(handle.db.prepare("SELECT path,status FROM changes ORDER BY path").all()).toEqual([
      { path: "docs/after.txt", status: "applied" },
      { path: "docs/conflict.txt", status: "conflict" },
    ]);
    for (const s of interrupted.sessions) {
      const state = service.get(s.id).snapshot;
      expect(state).toMatchObject({
        status: "idle",
        activeTurnId: null,
        interrupted: [s.turnId],
        turns: [{ turnId: s.turnId, steps: 1, stopReason: "aborted" }],
      });
      const messages = handle.db
        .prepare("SELECT content_json FROM messages WHERE session_id=? ORDER BY seq")
        .pluck()
        .all(s.id) as string[];
      expect(messages[0]).toBe(s.messageJson);
      expect(JSON.parse(messages[1]!)).toMatchObject({
        role: "toolResult",
        toolCallId: s.callId,
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("Interrupted") }],
      });
      expect(handle.db.prepare("SELECT status FROM tool_calls WHERE id=?").pluck().get(s.callId)).toBe(
        "aborted",
      );
    }
    const s = interrupted.sessions[1];
    expect(
      handle.db.prepare("SELECT decision,consumed_at FROM approvals WHERE id=?").get(s.approvalId),
    ).toEqual({ decision: "aborted", consumed_at: null });
    expect(() =>
      service!.decideApproval({
        sessionId: s.id,
        approvalId: s.approvalId,
        requestSha256: s.requestSha256,
        decision: "approved",
      }),
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    const recovered = rows(handle.db);
    await service.close();
    service = new SessionService(host);
    await service.waitReady();
    expect(rows(handle.db)).toEqual(recovered);
    expect(await fileState()).toEqual(before);
    await writeFile(join(root, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
    service.send(s.id, "Read the board");
    expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
    integrity(handle.db);
  } finally {
    await service?.close();
    handle?.close();
    await rm(root, { recursive: true, force: true });
  }
});
