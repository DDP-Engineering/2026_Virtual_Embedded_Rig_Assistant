import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { foldSessionEvents, type SessionEvent } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { buildSessionMarkdown } from "./export.js";
import { SessionHub } from "./hub.js";
import { type SessionHost, SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vera-bookmarks-"));
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, "board.txt"), "Board uses 3.3 V.\n");
  const path = join(root, ".vera/vera.db");
  const options = { workbenchId: "wb_test", appVersion: "0" };
  let storage = await openDb(path, options);
  const gateway = new ReplayGateway({ dir: resolve("tests/fixtures/llm-scripts"), now: () => 123 });
  const host: SessionHost = {
    root,
    db: storage.db,
    gateway,
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/read-then-answer",
    prompt: () => "test",
  };
  let service = new SessionService(host);
  await service.waitReady();
  cleanup.push(async () => {
    await service.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    host,
    gateway,
    get service() {
      return service;
    },
    get hub() {
      return new SessionHub(storage.db, () => new Date(123).toISOString());
    },
    async restart(readOnly = false) {
      await service.close();
      storage.close();
      storage = await openDb(path, { ...options, readOnly });
      host.db = storage.db;
      host.readOnly = readOnly;
      service = new SessionService(host);
      await service.waitReady();
    },
  };
}

it("records bookmarks before publication and retains set and clear through database restart and export", async () => {
  const env = await setup();
  const id = env.service.create().id;
  env.hub.emit(id, { type: "message.user", messageId: "u", text: "Remember" });
  const seen: SessionEvent[] = [];
  const off = env.service.subscribe(id, env.service.revision(id).seq, (seq, event) => {
    expect(env.service.exportSession(id).events.at(-1)).toMatchObject({ seq, event });
    seen.push(event);
  });
  env.service.bookmark(id, "u", true);
  expect(seen).toEqual([{ type: "message.bookmarked", messageId: "u", bookmarked: true }]);
  off();
  await env.restart();
  expect(env.service.get(id).snapshot.bookmarkedMessageIds).toEqual(["u"]);
  const archive = env.service.exportSession(id);
  expect(archive.schemaVersion).toBe(1);
  expect(
    foldSessionEvents(JSON.parse(JSON.stringify(archive)).events.map((r: { event: SessionEvent }) => r.event))
      .bookmarkedMessageIds,
  ).toEqual(["u"]);
  expect(buildSessionMarkdown(archive, [])).toContain("### User (bookmarked)");
  const replay: SessionEvent[] = [];
  env.service.subscribe(id, 0, (_seq, event) => replay.push(event))();
  expect(foldSessionEvents(replay).bookmarkedMessageIds).toEqual(["u"]);
  env.service.bookmark(id, "u", false);
  await env.restart();
  expect(env.service.get(id).snapshot.bookmarkedMessageIds).toEqual([]);
  expect(buildSessionMarkdown(env.service.exportSession(id), [])).not.toContain("(bookmarked)");
});

it("refuses non-user and other-session targets, archived and read-only writes without changing events", async () => {
  const env = await setup();
  const id = env.service.create().id;
  const other = env.service.create().id;
  env.hub.emit(id, { type: "message.user", messageId: "u", text: "Remember" });
  env.hub.emit(id, { type: "message.done", messageId: "a", text: "Answer", citations: [] });
  env.hub.emit(id, { type: "tool.started", callId: "c", name: "read", args: {} });
  env.hub.emit(other, { type: "message.user", messageId: "other", text: "Other" });
  const before = env.service.revision(id);
  expect(() => env.service.bookmark(id, "u", "true" as never)).toThrow(
    expect.objectContaining({ code: "INVALID" }),
  );
  for (const target of ["a", "c", "unknown", "other"])
    expect(() => env.service.bookmark(id, target, true)).toThrow(
      expect.objectContaining({ code: "INVALID" }),
    );
  expect(env.service.revision(id)).toEqual(before);
  env.service.bookmark(id, "u", true);
  env.service.setArchived(id, true);
  const archived = env.service.get(id);
  expect(() => env.service.bookmark(id, "u", false)).toThrow(expect.objectContaining({ code: "DENIED" }));
  expect(env.service.get(id)).toEqual(archived);
  env.service.setArchived(id, false);
  env.host.assertWritable = () => {
    throw { code: "DENIED", messageKey: "errors.DENIED" };
  };
  expect(() => env.service.bookmark(id, "u", false)).toThrow(expect.objectContaining({ code: "DENIED" }));
  delete env.host.assertWritable;
  await env.restart(true);
  const readonly = env.service.get(id);
  expect(() => env.service.bookmark(id, "u", false)).toThrow(expect.objectContaining({ code: "DENIED" }));
  expect(env.service.get(id)).toEqual(readonly);
  expect(
    foldSessionEvents(env.service.exportSession(id).events.map((r) => r.event)).bookmarkedMessageIds,
  ).toEqual(["u"]);
  await env.service.close();
  expect(() => env.service.bookmark(id, "u", true)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
});

it("publishes no bookmark when durable event recording fails", async () => {
  const env = await setup();
  const id = env.service.create().id;
  env.hub.emit(id, { type: "message.user", messageId: "u", text: "Remember" });
  const before = env.service.get(id);
  const on = vi.fn();
  env.service.subscribe(id, before.seq, on);
  env.host.db.exec(
    "CREATE TEMP TRIGGER refuse_bookmark BEFORE INSERT ON events WHEN NEW.type='message.bookmarked' BEGIN SELECT RAISE(ABORT, 'test persistence failure'); END",
  );
  expect(() => env.service.bookmark(id, "u", true)).toThrow("test persistence failure");
  expect(on).not.toHaveBeenCalled();
  expect(env.service.get(id)).toEqual(before);
});

it("bookmarks active queued users without exposing metadata to the agent or changing transcript rows", async () => {
  const env = await setup();
  const id = env.service.create().id;
  const original = env.gateway.stream.bind(env.gateway);
  const stream = vi.spyOn(env.gateway, "stream");
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    started = r;
  });
  stream.mockImplementation(async function* (request) {
    started();
    await held;
    yield* original(request);
  });
  env.service.send(id, "Read the board");
  await ready;
  try {
    const queued = env.service.send(id, "Next");
    const rows = env.host.db.prepare("SELECT * FROM messages WHERE session_id=?").all(id);
    const request = JSON.stringify(stream.mock.calls[0]?.[0]);
    env.service.bookmark(id, queued.messageId, true);
    expect(env.service.get(id).snapshot.bookmarkedMessageIds).toEqual([queued.messageId]);
    expect(env.host.db.prepare("SELECT * FROM messages WHERE session_id=?").all(id)).toEqual(rows);
    expect(JSON.stringify(stream.mock.calls[0]?.[0])).toBe(request);
    expect(request).not.toContain("bookmark");
  } finally {
    release();
  }
  await env.service.waitIdle(id);
  expect(stream.mock.calls.length).toBeGreaterThan(1);
  expect(JSON.stringify(stream.mock.calls)).not.toContain("bookmark");
});
