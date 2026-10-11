import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it } from "vitest";

let openDb: typeof import("./db.js").openDb;
let SessionsRepository: typeof import("./repos/sessions.js").SessionsRepository;
let MessagesRepository: typeof import("./repos/messages.js").MessagesRepository;
let EventsRepository: typeof import("./repos/events.js").EventsRepository;
beforeAll(async () => {
  expect(existsSync(new URL("./repos/sessions.ts", import.meta.url)), "repositories exist").toBe(true);
  ({ openDb } = await import("./db.js"));
  ({ SessionsRepository } = await import("./repos/sessions.js"));
  ({ MessagesRepository } = await import("./repos/messages.js"));
  ({ EventsRepository } = await import("./repos/events.js"));
});
const roots: string[] = [];
const handles: { close(): void }[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) h.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vera-repos-"));
  roots.push(root);
  await mkdir(join(root, ".vera"));
  const file = join(root, ".vera/vera.db");
  const h = await openDb(file, { workbenchId: "wb_test", appVersion: "0.0.0" });
  handles.push(h);
  return {
    h,
    file,
    sessions: new SessionsRepository(h.db),
    messages: new MessagesRepository(h.db),
    events: new EventsRepository(h.db),
  };
}
function session(id: string) {
  return {
    id,
    title: "Banc ă",
    created_at: "2026-10-11T00:00:00.000Z",
    updated_at: "2026-10-11T00:00:00.000Z",
    model_ref: null,
    permission_mode: "ask",
    status: "idle",
    archived: 0,
  } as const;
}
it("session CRUD persists rows, orders deterministically and cascades every child table", async () => {
  const { h, file, sessions } = await setup();
  sessions.create(session("ses_a"));
  sessions.create(session("ses_b"));
  expect(sessions.get("ses_a")).toEqual(session("ses_a"));
  expect(sessions.get("absent")).toBeUndefined();
  expect(sessions.list().map((s) => s.id)).toEqual(["ses_b", "ses_a"]);
  h.db.exec(`INSERT INTO messages VALUES ('ses_a',1,'user','{}','now'); INSERT INTO events VALUES ('ses_a',1,'event','{}','now');
    INSERT INTO tool_calls(id,session_id) VALUES ('call','ses_a');
    INSERT INTO approvals(id,session_id,request_sha256,request_json) VALUES ('apv','ses_a','hash','{}');
    INSERT INTO changes(session_id,status) VALUES ('ses_a','pending');
    INSERT INTO artifacts(id,session_id) VALUES ('art','ses_a'); INSERT INTO todos VALUES ('ses_a','[]','now');`);
  expect(sessions.delete("ses_a")).toBe(true);
  expect(sessions.delete("ses_a")).toBe(false);
  for (const table of ["messages", "events", "tool_calls", "approvals", "changes", "artifacts", "todos"])
    expect(h.db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()).toBe(0);
  h.close();
  const reopened = await openDb(file, { workbenchId: "wb_test", appVersion: "0.0.0" });
  handles.push(reopened);
  expect(new SessionsRepository(reopened.db).list()).toEqual([session("ses_b")]);
});
it("message CRUD isolates sessions, preserves JSON bytes, enforces keys and orders seq", async () => {
  const { sessions, messages } = await setup();
  sessions.create(session("ses_a"));
  sessions.create(session("ses_b"));
  const row = {
    session_id: "ses_a",
    seq: 2,
    role: "assistant",
    content_json: '{ "text": "ă", "tool": [1] }',
    created_at: "2026-10-11T00:00:00.000Z",
  };
  messages.create(row);
  messages.create({ ...row, seq: 1 });
  messages.create({ ...row, session_id: "ses_b" });
  expect(messages.get("ses_a", 2)).toEqual(row);
  expect(messages.get("ses_a", 7)).toBeUndefined();
  expect(messages.list("ses_a").map((r) => r.seq)).toEqual([1, 2]);
  expect(messages.list("ses_b")).toHaveLength(1);
  expect(() => messages.create(row)).toThrow();
  expect(() => messages.create({ ...row, session_id: "absent" })).toThrow();
  expect(messages.delete("ses_a", 1)).toBe(true);
  expect(messages.delete("ses_a", 1)).toBe(false);
  expect(messages.list("ses_a")).toEqual([row]);
});
it("event CRUD isolates sessions and replays ascending seq after cursor", async () => {
  const { sessions, events } = await setup();
  sessions.create(session("ses_a"));
  sessions.create(session("ses_b"));
  const row = {
    session_id: "ses_a",
    seq: 8,
    type: "turn.done",
    payload_json: '{ "reason":"end", "extra":"ă" }',
    created_at: "2026-10-11T00:00:00.000Z",
  };
  for (const seq of [8, 2, 5]) events.create({ ...row, seq });
  events.create({ ...row, session_id: "ses_b" });
  expect(events.get("ses_a", 8)).toEqual(row);
  expect(events.get("ses_a", 99)).toBeUndefined();
  expect(events.list("ses_a").map((e) => e.seq)).toEqual([2, 5, 8]);
  expect(events.list("ses_a", 5)).toEqual([row]);
  expect(events.list("ses_b")).toHaveLength(1);
  expect(() => events.create(row)).toThrow();
  expect(() => events.create({ ...row, seq: 9, session_id: "absent" })).toThrow();
  expect(events.delete("ses_a", 8)).toBe(true);
  expect(events.delete("ses_a", 8)).toBe(false);
});
it("message and event JSON rows survive close and reopen in sequence order", async () => {
  const { h, file, sessions, messages, events } = await setup();
  sessions.create(session("ses_a"));
  const timestamp = "2026-10-11T00:00:00.000Z";
  for (const seq of [3, 1, 2]) {
    messages.create({
      session_id: "ses_a",
      seq,
      role: "user",
      content_json: '{ "text":"ă" }',
      created_at: timestamp,
    });
    events.create({
      session_id: "ses_a",
      seq,
      type: "message.user",
      payload_json: '{ "extra": [1,2] }',
      created_at: timestamp,
    });
  }
  const m = messages.list("ses_a"),
    e = events.list("ses_a");
  h.close();
  const reopened = await openDb(file, { workbenchId: "wb_test", appVersion: "0.0.0" });
  handles.push(reopened);
  expect(new MessagesRepository(reopened.db).list("ses_a")).toEqual(m);
  expect(new EventsRepository(reopened.db).list("ses_a")).toEqual(e);
});
it("messages and events reject nonfinite fractional negative and unsafe sequences", async () => {
  const { h, sessions, messages, events } = await setup();
  sessions.create(session("ses_a"));
  for (const seq of [
    0.5,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(() =>
      messages.create({ session_id: "ses_a", seq, role: "user", content_json: "{}", created_at: null }),
    ).toThrow();
    expect(() =>
      events.create({ session_id: "ses_a", seq, type: "event", payload_json: "{}", created_at: null }),
    ).toThrow();
    expect(() =>
      h.db.prepare("INSERT INTO messages(session_id,seq,content_json) VALUES ('ses_a',?,'{}')").run(seq),
    ).toThrow();
    expect(() =>
      h.db.prepare("INSERT INTO events(session_id,seq,payload_json) VALUES ('ses_a',?,'{}')").run(seq),
    ).toThrow();
  }
  expect(messages.list("ses_a")).toEqual([]);
  expect(events.list("ses_a")).toEqual([]);
  for (const seq of [Number.MAX_SAFE_INTEGER, 0]) {
    messages.create({ session_id: "ses_a", seq, role: "user", content_json: "{}", created_at: null });
    events.create({ session_id: "ses_a", seq, type: "event", payload_json: "{}", created_at: null });
  }
  expect(messages.list("ses_a").map((r) => r.seq)).toEqual([0, Number.MAX_SAFE_INTEGER]);
  expect(events.list("ses_a").map((r) => r.seq)).toEqual([0, Number.MAX_SAFE_INTEGER]);
});
