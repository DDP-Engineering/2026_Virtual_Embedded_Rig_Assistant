import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PlanTarget, type TodoItem, veraError } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { TodosRepository } from "../storage/repos/todos.js";
import { SessionHub } from "./hub.js";
import { type SessionHost, SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const plan: TodoItem[] = [
  { id: "same", text: "A😀B\nμC", status: "pending" },
  { id: "same", text: "A😀B\nμC", status: "in_progress" },
  { text: "", status: "done" },
];
const target = (stepIndex = 1, revision = 1): PlanTarget => ({
  revision,
  stepIndex,
  stepText: plan[stepIndex]?.text ?? "",
  range: stepIndex === 2 ? null : { start: 1, end: 3, quote: "😀" },
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vera-plan-review-"));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "scripts/chat.jsonl"), JSON.stringify({ text: "Ready" }));
  const path = join(root, ".vera/vera.db");
  const options = { workbenchId: "wb_test", appVersion: "0" };
  let storage = await openDb(path, options);
  const host: SessionHost = {
    root,
    db: storage.db,
    gateway: new ReplayGateway({ dir: join(root, "scripts"), now: () => 123 }),
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/chat",
    prompt: () => "Test",
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
    get service() {
      return service;
    },
    replace(id: string, items = plan) {
      const hub = new SessionHub(storage.db, () => new Date(123).toISOString());
      const value = storage.db.transaction(() => {
        new TodosRepository(storage.db).replace(id, items, new Date(123).toISOString());
        return hub.record(id, { type: "todo.updated", items });
      })();
      hub.publish(id, value);
    },
    async reopen(readOnly = false) {
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

it("saves distinct occurrence and empty-step drafts without changing transcript, plan or model requests", async () => {
  const env = await setup();
  const id = env.service.create(null, "read-only").id;
  env.replace(id);
  const stream = vi.spyOn(env.host.gateway, "stream");
  const before = env.service.get(id);
  const messages = env.host.db.prepare("SELECT * FROM messages").all();
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Vérifier 😀\nGPIO",
    target: target(),
  });
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 1,
    text: "Încă o dată",
    target: { ...target(0), range: null },
  });
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 2,
    text: "Empty step",
    target: target(2),
  });
  const state = env.service.get(id).snapshot;
  expect(state.planComments).toHaveLength(3);
  expect(new Set(state.planComments.map((c) => c.id)).size).toBe(3);
  expect(state.planComments.map((c) => c.target)).toEqual([
    target(),
    { ...target(0), range: null },
    target(2),
  ]);
  expect(state.planComments.map((c) => c.text)).toEqual(["Vérifier 😀\nGPIO", "Încă o dată", "Empty step"]);
  expect(state.todos).toEqual(before.snapshot.todos);
  expect(state.items).toEqual(before.snapshot.items);
  expect(env.host.db.prepare("SELECT * FROM messages").all()).toEqual(messages);
  expect(stream).not.toHaveBeenCalled();
  env.service.send(id, "ordinary request");
  expect(await env.service.waitIdle(id)).toEqual({ stopReason: "end" });
  expect(JSON.stringify(stream.mock.calls)).not.toContain("Vérifier");
  expect(env.service.get(id).snapshot.planComments).toEqual(state.planComments);
});

it("edits and deletes only the selected draft, retaining stale anchors through a real database reopen", async () => {
  const env = await setup();
  const id = env.service.create().id,
    other = env.service.create().id;
  env.replace(id);
  env.replace(other);
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "first",
    target: target(),
  });
  env.service.savePlanComment(other, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "other",
    target: target(0),
  });
  const original = env.service.get(id).snapshot.planComments[0];
  expect(original).toBeDefined();
  const commentId = original?.id ?? "missing";
  env.replace(id, []);
  env.service.savePlanComment(id, {
    action: "edit",
    commentId,
    expectedFeedbackRevision: 1,
    text: "Édité 😀\nmultiline",
  });
  await env.reopen();
  expect(env.service.get(id).snapshot.planComments).toEqual([
    { ...original, text: "Édité 😀\nmultiline", stale: true },
  ]);
  expect(env.service.get(other).snapshot.planComments).toMatchObject([
    { text: "other", stale: false, target: target(0) },
  ]);
  env.service.deletePlanComment(id, { commentId, expectedFeedbackRevision: 2 });
  await env.reopen();
  expect(env.service.get(id).snapshot.planComments).toEqual([]);
  expect(env.service.get(other).snapshot.planComments).toHaveLength(1);
  expect(env.host.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()).toEqual({
    value: "1",
  });
});

it("explicitly reanchors only the chosen target and refuses obsolete feedback or revision snapshots", async () => {
  const env = await setup();
  const id = env.service.create().id;
  env.replace(id);
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Keep feedback",
    target: target(),
  });
  const commentId = env.service.get(id).snapshot.planComments[0]?.id ?? "missing";
  env.replace(id);
  const before = env.service.get(id);
  expect(() =>
    env.service.savePlanComment(id, {
      action: "reanchor",
      commentId,
      expectedFeedbackRevision: 1,
      target: target(),
    }),
  ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(() =>
    env.service.savePlanComment(id, {
      action: "edit",
      commentId,
      expectedFeedbackRevision: 0,
      text: "obsolete",
    }),
  ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  expect(env.service.get(id)).toEqual(before);
  env.service.savePlanComment(id, {
    action: "reanchor",
    commentId,
    expectedFeedbackRevision: 1,
    target: { ...target(0, 2), range: null },
  });
  expect(env.service.get(id).snapshot.planComments).toEqual([
    { id: commentId, text: "Keep feedback", target: { ...target(0, 2), range: null }, stale: false },
  ]);
});

it("rejects malformed targets and mixed actions with INVALID and preserves all rows/events", async () => {
  const env = await setup();
  const id = env.service.create().id;
  env.replace(id);
  const before = env.service.exportSession(id);
  for (const invalid of [
    { ...target(), stepIndex: -1 },
    { ...target(), stepIndex: 50 },
    { ...target(), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...target(), range: { start: 1, end: 2, quote: "\ud83d" } },
    { ...target(), range: { start: 2, end: 3, quote: "\ude00" } },
    { ...target(), range: { start: 1, end: 1, quote: "" } },
    { ...target(), range: { start: 0, end: 200, quote: "all steps" } },
    { ...target(), range: { start: 1, end: 3, quote: "forged" } },
  ])
    expect(() =>
      env.service.savePlanComment(id, {
        action: "create",
        expectedFeedbackRevision: 0,
        text: "invalid",
        target: invalid,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID" }));
  expect(() =>
    env.service.savePlanComment(id, {
      action: "edit",
      expectedFeedbackRevision: 0,
      commentId: "unknown",
      text: "invalid",
      target: target(),
    } as never),
  ).toThrow(expect.objectContaining({ code: "INVALID" }));
  expect(env.service.exportSession(id)).toEqual(before);
});

it("scopes every draft lookup to its session and denies archived, read-only and lost-owner writes", async () => {
  const env = await setup();
  const id = env.service.create().id,
    other = env.service.create().id;
  env.replace(id);
  env.replace(other);
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Owned feedback",
    target: target(),
  });
  const commentId = env.service.get(id).snapshot.planComments[0]?.id ?? "missing";
  for (const foreignId of [commentId, "unknown"])
    for (const act of [
      () =>
        env.service.savePlanComment(other, {
          action: "edit",
          expectedFeedbackRevision: 0,
          commentId: foreignId,
          text: "stolen",
        }),
      () =>
        env.service.savePlanComment(other, {
          action: "reanchor",
          expectedFeedbackRevision: 0,
          commentId: foreignId,
          target: target(),
        }),
      () => env.service.deletePlanComment(other, { commentId: foreignId, expectedFeedbackRevision: 0 }),
    ])
      expect(act).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  expect(env.service.get(other).snapshot.planComments).toEqual([]);
  const mutations = [
    () =>
      env.service.savePlanComment(id, {
        action: "create",
        expectedFeedbackRevision: 1,
        text: "new",
        target: target(),
      }),
    () =>
      env.service.savePlanComment(id, {
        action: "edit",
        expectedFeedbackRevision: 1,
        commentId,
        text: "new",
      }),
    () =>
      env.service.savePlanComment(id, {
        action: "reanchor",
        expectedFeedbackRevision: 1,
        commentId,
        target: target(0),
      }),
    () => env.service.deletePlanComment(id, { expectedFeedbackRevision: 1, commentId }),
  ];
  env.service.setArchived(id, true);
  for (const act of mutations) expect(act).toThrow(expect.objectContaining({ code: "DENIED" }));
  env.service.setArchived(id, false);
  env.host.assertWritable = () => {
    throw veraError("DENIED");
  };
  for (const act of mutations) expect(act).toThrow(expect.objectContaining({ code: "DENIED" }));
  delete env.host.assertWritable;
  await env.reopen(true);
  const before = env.service.get(id);
  for (const act of mutations) expect(act).toThrow(expect.objectContaining({ code: "DENIED" }));
  expect(env.service.get(id)).toEqual(before);
});

it("publishes only committed metadata and rolls back a persistence failure without losing feedback", async () => {
  const env = await setup();
  const id = env.service.create().id;
  env.replace(id);
  const observer = vi.fn((_seq, event) => ({
    published: event,
    committed: env.service.exportSession(id).events.at(-1)?.event,
  }));
  env.service.subscribe(id, env.service.revision(id).seq, observer);
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Saved",
    target: target(),
  });
  expect(observer).toHaveBeenCalledOnce();
  expect(observer.mock.results[0]?.value).toEqual({
    published: expect.anything(),
    committed: observer.mock.calls[0]?.[1],
  });
  const before = env.service.get(id);
  env.host.db.exec(
    "CREATE TEMP TRIGGER refuse_feedback BEFORE INSERT ON events WHEN NEW.type LIKE 'plan.%' BEGIN SELECT RAISE(ABORT, 'feedback persistence failure'); END",
  );
  expect(() =>
    env.service.savePlanComment(id, {
      action: "create",
      expectedFeedbackRevision: 1,
      text: "Retained locally",
      target: target(0),
    }),
  ).toThrow("feedback persistence failure");
  expect(observer).toHaveBeenCalledOnce();
  expect(env.service.get(id)).toEqual(before);
});

it("validates the live bounded projection and marks changed projections stale before sanitization", async () => {
  const env = await setup();
  const id = env.service.create().id;
  env.replace(id);
  let masking = false;
  env.host.scrub = (text) => text.replaceAll("😀", "[REDACTED]");
  env.host.masking = () => masking;
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Review emoji",
    target: target(),
  });
  masking = true;
  expect(env.service.get(id).snapshot.planComments[0]?.stale).toBe(true);
  expect(() =>
    env.service.savePlanComment(id, {
      action: "create",
      expectedFeedbackRevision: 1,
      text: "old projection",
      target: target(),
    }),
  ).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  env.service.savePlanComment(id, {
    action: "create",
    expectedFeedbackRevision: 1,
    text: "current projection",
    target: { ...target(), stepText: "A[REDACTED]B\nμC", range: { start: 1, end: 11, quote: "[REDACTED]" } },
  });
  expect(env.service.get(id).snapshot.planComments.map((c) => c.stale)).toEqual([true, false]);
});
