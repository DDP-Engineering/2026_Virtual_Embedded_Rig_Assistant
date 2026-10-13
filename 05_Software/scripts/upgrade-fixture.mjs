import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/upgrade/interrupted.json", import.meta.url), "utf8"),
);
function sessionFixture(sessionIds) {
  return fixture.sessions.map((session, index) => {
    const id = sessionIds[index];
    const replacements = [
      [session.id, id],
      [session.callId, `previous-call-${id}`],
      [session.turnId, `previous-turn-${id}`],
    ];
    if (session.approvalId) replacements.push([session.approvalId, `apv_${id.slice(4)}`]);
    let raw = JSON.stringify(session);
    for (const [before, after] of replacements) raw = raw.replaceAll(before, after);
    return JSON.parse(raw);
  });
}
export async function contentState(root) {
  return Promise.all(
    fixture.changes.map(async (change) => {
      const path = join(root, change.path),
        info = await stat(path);
      return {
        path: change.path,
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        bytes: info.size,
        mtimeMs: info.mtimeMs,
        mode: info.mode,
      };
    }),
  );
}
/** External acceptance driver only. Requires the installed app to close this workbench first. */
export async function seedInterrupted(root, sessionIds) {
  assert.equal(sessionIds.length, fixture.sessions.length);
  await mkdir(join(root, "docs"), { recursive: true });
  for (const change of fixture.changes) await writeFile(join(root, change.path), change.current);
  const db = new Database(join(root, ".vera/vera.db"));
  try {
    db.pragma("foreign_keys=ON");
    db.transaction(() => {
      for (const [index, s] of sessionFixture(sessionIds).entries()) {
        const id = sessionIds[index];
        assert(db.prepare("SELECT id FROM sessions WHERE id=?").get(id), "vN IPC-created session required");
        db.prepare("UPDATE sessions SET title=?,status=?,model_ref='replay/read-then-answer' WHERE id=?").run(
          s.title,
          s.status,
          id,
        );
        const messageSeq = db
          .prepare("SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE session_id=?")
          .pluck()
          .get(id);
        db.prepare("INSERT INTO messages VALUES (?,?,'assistant',?,?)").run(
          id,
          messageSeq,
          s.messageJson,
          fixture.createdAt,
        );
        const eventSeq = db
          .prepare("SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE session_id=?")
          .pluck()
          .get(id);
        for (const [offset, event] of s.events.entries())
          db.prepare("INSERT INTO events VALUES (?,?,?,?,?)").run(
            id,
            eventSeq + offset,
            event.type,
            JSON.stringify(event),
            fixture.createdAt,
          );
        db.prepare("INSERT INTO tool_calls VALUES (?,?,'edit','{}',NULL,'pending',?,NULL)").run(
          s.callId,
          id,
          fixture.createdAt,
        );
        if (s.approvalId)
          db.prepare(
            "INSERT INTO approvals(id,session_id,turn_id,tool_call_id,request_sha256,request_json) VALUES (?,?,?,?,?,'{}')",
          ).run(s.approvalId, id, s.turnId, s.callId, s.requestSha256);
      }
      for (const change of fixture.changes)
        db.prepare(
          "INSERT INTO changes(session_id,tool_call_id,path,before_sha256,after_sha256,diff,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
        ).run(
          sessionIds[1],
          `${change.callId}-${sessionIds[1]}`,
          change.path,
          change.beforeSha256,
          change.afterSha256,
          change.diff,
          fixture.createdAt,
        );
    })();
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    return {
      sessions: db.prepare("SELECT id,title,status FROM sessions ORDER BY id").all(),
      pending: db.prepare("SELECT path,status FROM changes ORDER BY path").all(),
      content: await contentState(root),
    };
  } finally {
    db.close();
  }
}
export async function verifyRecovered(invoke, root, sessionIds, beforeContent) {
  // Main's session.get waits for initialization; no next turn has yet been sent.
  const snapshots = [];
  for (const [index, s] of sessionFixture(sessionIds).entries()) {
    const { snapshot } = await invoke("session.get", { sessionId: sessionIds[index] });
    assert.equal(snapshot.status, "idle");
    assert.equal(snapshot.activeTurnId, null);
    assert(snapshot.interrupted.includes(s.turnId));
    assert(snapshot.turns.some((turn) => turn.turnId === s.turnId && turn.stopReason === "aborted"));
    if (s.approvalId) {
      assert(
        snapshot.approvals.some(
          (approval) => approval.approvalId === s.approvalId && approval.decision === "aborted",
        ),
      );
      let refused = false;
      try {
        await invoke("session.approval.decide", {
          sessionId: sessionIds[index],
          approvalId: s.approvalId,
          requestSha256: s.requestSha256,
          decision: "approved",
        });
      } catch (error) {
        refused = error.message.includes('"code":"CONFLICT"');
      }
      assert(refused, "pre-restart approval is unusable");
    }
    snapshots.push({ id: sessionIds[index], snapshot });
  }
  assert.deepEqual(await contentState(root), beforeContent, "recovery must never rewrite workbench content");
  const db = new Database(join(root, ".vera/vera.db"), { readonly: true });
  try {
    const changes = db
      .prepare("SELECT path,status FROM changes WHERE session_id=? ORDER BY path")
      .all(sessionIds[1]);
    assert.deepEqual(changes, [
      { path: "docs/after.txt", status: "applied" },
      { path: "docs/conflict.txt", status: "conflict" },
    ]);
    for (const [index, s] of sessionFixture(sessionIds).entries()) {
      const messages = db
        .prepare("SELECT content_json FROM messages WHERE session_id=? ORDER BY seq")
        .pluck()
        .all(sessionIds[index]);
      assert(messages.includes(s.messageJson), "original previous assistant bytes retained");
      assert(
        messages
          .map(JSON.parse)
          .some(
            (message) =>
              message.role === "toolResult" &&
              message.toolCallId === s.callId &&
              message.isError &&
              message.content.some((part) => part.text?.includes("Interrupted")),
          ),
      );
      assert.equal(db.prepare("SELECT status FROM tool_calls WHERE id=?").pluck().get(s.callId), "aborted");
    }
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    return {
      snapshots,
      changes,
      content: await contentState(root),
      integrity: "ok",
      staleApproval: "CONFLICT",
      observedBeforeNextTurn: true,
    };
  } finally {
    db.close();
  }
}
