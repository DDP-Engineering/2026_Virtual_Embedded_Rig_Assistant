import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applySessionEvent, emptySessionState, type SessionEvent } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { SessionHub } from "./hub.js";
import { SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vera-hub-"));
  await mkdir(join(root, ".vera"));
  const storage = await openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const service = new SessionService({
    root,
    db: storage.db,
    gateway: new ReplayGateway({ dir: resolve("tests/fixtures/llm-scripts"), now: () => 123 }),
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/read-then-answer",
    prompt: () => "test",
  });
  await service.waitReady();
  const id = service.create().id;
  await service.close();
  cleanup.push(async () => {
    storage.close();
    await rm(root, { recursive: true, force: true });
  });
  return { id, hub: new SessionHub(storage.db, () => new Date(123).toISOString()) };
}

/** Subscribes from `sinceSeq` and returns what a new subscriber receives at once and later. */
function subscriber(hub: SessionHub, id: string, sinceSeq: number) {
  const received: { seq: number | undefined; event: SessionEvent }[] = [];
  const off = hub.subscribe(id, sinceSeq, (seq, event) => received.push({ seq, event }));
  cleanup.push(async () => off());
  return received;
}

// REQ-FUNC-cbd535d1
it("replays stored events once, then the merged live text of each unfinished item of the turn", async () => {
  const { id, hub } = await setup();
  hub.emit(id, { type: "message.user", messageId: "u", text: "Read the board" });
  hub.emit(id, { type: "turn.started", turnId: "t" });
  const cursor = hub.revision(id).seq;
  hub.emit(id, { type: "reasoning.delta", messageId: "m1", text: "Think " });
  hub.emit(id, { type: "message.delta", messageId: "m1", text: "Board " });
  hub.emit(id, { type: "tool.started", callId: "c1", name: "read", args: { path: "board.txt" } });
  hub.emit(id, { type: "tool.update", callId: "c1", text: "line 1\n" });
  hub.emit(id, { type: "reasoning.delta", messageId: "m1", text: "more" });
  hub.emit(id, { type: "message.delta", messageId: "m1", text: "uses " });
  hub.emit(id, { type: "tool.update", callId: "c1", text: "line 2\n" });
  const received = subscriber(hub, id, cursor);
  expect(received).toEqual([
    { seq: cursor + 1, event: expect.objectContaining({ type: "tool.started", callId: "c1" }) },
    { seq: undefined, event: { type: "reasoning.delta", messageId: "m1", text: "Think more" } },
    { seq: undefined, event: { type: "message.delta", messageId: "m1", text: "Board uses " } },
    { seq: undefined, event: { type: "tool.update", callId: "c1", text: "line 1\nline 2\n" } },
  ]);
  // Later events arrive live, once.
  hub.emit(id, { type: "message.delta", messageId: "m1", text: "3.3 V" });
  expect(received.at(-1)).toEqual({
    seq: undefined,
    event: { type: "message.delta", messageId: "m1", text: "3.3 V" },
  });
  // The reducer shows the streamed reply in progress, as an uninterrupted subscriber would.
  const state = received.reduce((s, { event }) => applySessionEvent(s, event), emptySessionState());
  expect(state.items.findLast((item) => item.kind === "assistant")).toMatchObject({
    text: "Board uses 3.3 V",
    streaming: true,
  });
});

// REQ-FUNC-cbd535d1
it("never replays the live text of a finished message, tool or turn", async () => {
  const { id, hub } = await setup();
  hub.emit(id, { type: "turn.started", turnId: "t" });
  hub.emit(id, { type: "message.delta", messageId: "m1", text: "Board uses" });
  hub.emit(id, { type: "reasoning.delta", messageId: "m1", text: "Think" });
  hub.emit(id, { type: "tool.started", callId: "c1", name: "read", args: {} });
  hub.emit(id, { type: "tool.update", callId: "c1", text: "output" });
  hub.emit(id, { type: "message.done", messageId: "m1", text: "Board uses 3.3 V.", citations: [] });
  hub.emit(id, { type: "tool.done", callId: "c1", ok: true, summary: "1 line", durationMs: 1 });
  hub.emit(id, { type: "message.delta", messageId: "m2", text: "Second" });
  const mid = subscriber(hub, id, 0);
  const live = mid.filter(({ seq }) => seq === undefined).map(({ event }) => event);
  // m1's text and c1's output are final now; m1's reasoning belongs to the turn still running.
  expect(live).toEqual([
    { type: "reasoning.delta", messageId: "m1", text: "Think" },
    { type: "message.delta", messageId: "m2", text: "Second" },
  ]);
  const state = mid.reduce((s, { event }) => applySessionEvent(s, event), emptySessionState());
  expect(state.items.filter((item) => item.kind === "assistant").map((item) => item.text)).toEqual([
    "Board uses 3.3 V.",
    "Second",
  ]);
  hub.emit(id, { type: "turn.done", turnId: "t", stopReason: "end" });
  expect(subscriber(hub, id, 0).filter(({ seq }) => seq === undefined)).toEqual([]);
  // An interrupted turn leaves nothing live either.
  hub.emit(id, { type: "turn.started", turnId: "t2" });
  hub.emit(id, { type: "message.delta", messageId: "m3", text: "Cut" });
  hub.emit(id, { type: "session.interrupted", turnId: "t2" });
  expect(subscriber(hub, id, 0).filter(({ seq }) => seq === undefined)).toEqual([]);
});

// REQ-FUNC-cbd535d1
it("replays at most the last 500000 characters of an item's live text", async () => {
  const { id, hub } = await setup();
  hub.emit(id, { type: "turn.started", turnId: "t" });
  hub.emit(id, { type: "tool.started", callId: "c1", name: "run_program", args: {} });
  hub.emit(id, { type: "tool.update", callId: "c1", text: `${"a".repeat(100000)}${"b".repeat(500000)}` });
  hub.emit(id, { type: "tool.update", callId: "c1", text: "c" });
  const [replayed] = subscriber(hub, id, hub.revision(id).seq);
  const event = replayed?.event as Extract<SessionEvent, { type: "tool.update" }> | undefined;
  expect(event && { type: event.type, callId: event.callId, length: event.text.length }).toEqual({
    type: "tool.update",
    callId: "c1",
    length: 500000,
  });
  expect(event?.text === `${"b".repeat(499999)}c`).toBe(true);
});

// REQ-FUNC-cbd535d1
it("keeps each session's live text to itself and forgets it when cleared", async () => {
  const { id, hub } = await setup();
  hub.emit(id, { type: "turn.started", turnId: "t" });
  hub.emit(id, { type: "message.delta", messageId: "m1", text: "Mine" });
  hub.clear();
  expect(subscriber(hub, id, hub.revision(id).seq)).toEqual([]);
});

// REQ-FUNC-cbd535d1
it("keeps live text of a message finished by a re-entrant publish out of the replay", async () => {
  const { id, hub } = await setup();
  hub.emit(id, { type: "turn.started", turnId: "t" });
  // The first listener finishes m1 while m1's second chunk still waits in the publish queue.
  const off = hub.subscribe(id, hub.revision(id).seq, (_seq, event) => {
    if (event.type === "message.delta" && event.text === "a")
      hub.emit(id, { type: "message.done", messageId: "m1", text: "ab", citations: [] });
  });
  cleanup.push(async () => off());
  hub.publishBatch(id, [
    { event: { type: "message.delta", messageId: "m1", text: "a" } },
    { event: { type: "message.delta", messageId: "m1", text: "b" } },
  ]);
  const later = subscriber(hub, id, 0);
  expect(later.filter(({ seq }) => seq === undefined)).toEqual([]);
  const state = later.reduce((s, { event }) => applySessionEvent(s, event), emptySessionState());
  expect(state.items.findLast((item) => item.kind === "assistant")).toMatchObject({
    text: "ab",
    streaming: false,
  });
});

// REQ-FUNC-cbd535d1
it("delivers live text published while a subscriber joins or replays exactly once", async () => {
  const { id, hub } = await setup();
  hub.emit(id, { type: "turn.started", turnId: "t" });
  // A subscriber that joins while "a" is being delivered gets "a" from the replay and "b" live.
  let joined: ReturnType<typeof subscriber> | undefined;
  const off = hub.subscribe(id, hub.revision(id).seq, (_seq, event) => {
    if (event.type === "message.delta" && event.text === "a")
      joined = subscriber(hub, id, hub.revision(id).seq);
  });
  cleanup.push(async () => off());
  hub.publishBatch(id, [
    { event: { type: "message.delta", messageId: "m1", text: "a" } },
    { event: { type: "message.delta", messageId: "m1", text: "b" } },
  ]);
  expect(joined?.map(({ event }) => event)).toEqual([
    { type: "message.delta", messageId: "m1", text: "a" },
    { type: "message.delta", messageId: "m1", text: "b" },
  ]);
  // A subscriber whose own listener publishes during its replay gets that text once, after the replay.
  const seen: SessionEvent[] = [];
  const replaying = hub.subscribe(id, hub.revision(id).seq, (_seq, event) => {
    seen.push(event);
    if (seen.length === 1) hub.emit(id, { type: "message.delta", messageId: "m1", text: "c" });
  });
  cleanup.push(async () => replaying());
  expect(seen).toEqual([
    { type: "message.delta", messageId: "m1", text: "ab" },
    { type: "message.delta", messageId: "m1", text: "c" },
  ]);
  expect(subscriber(hub, id, hub.revision(id).seq).map(({ event }) => event)).toEqual([
    { type: "message.delta", messageId: "m1", text: "abc" },
  ]);
});
