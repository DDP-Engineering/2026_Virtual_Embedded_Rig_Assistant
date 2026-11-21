import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionMode, PlanTarget, SessionEvent, TodoItem } from "@vera/shared";
import { onTestFinished } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { TodosRepository } from "../storage/repos/todos.js";
import { SessionHub } from "./hub.js";
import { type SessionHost, SessionService } from "./service.js";

export const plan: TodoItem[] = [
  { id: "same", text: "A😀B\nμC", status: "pending" },
  { id: "same", text: "A😀B\nμC", status: "in_progress" },
];
export const target: PlanTarget = {
  revision: 1,
  stepIndex: 1,
  stepText: "A😀B\nμC",
  range: { start: 1, end: 3, quote: "😀" },
};
export const input = { expectedPlanRevision: 1, expectedFeedbackRevision: 1 };
export async function fixture(mode: PermissionMode = "ask") {
  const root = await mkdtemp(join(tmpdir(), "vera-review-turn-"));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "scripts/chat.jsonl"), JSON.stringify({ text: "Which GPIO should change?" }));
  await writeFile(join(root, "board.txt"), "Original board");
  const path = join(root, ".vera/vera.db"),
    options = { workbenchId: "wb_test", appVersion: "0" };
  let storage = await openDb(path, options);
  const host: SessionHost = {
    root,
    db: storage.db,
    gateway: new ReplayGateway({ dir: join(root, "scripts"), now: () => 123 }),
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/chat",
    prompt: () => "Canonical engineering prompt",
  };
  let service = new SessionService(host);
  await service.waitReady();
  onTestFinished(async () => {
    await service.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  });
  const id = service.create(null, mode).id;
  const record = (sessionId: string, event: SessionEvent) => {
    const hub = new SessionHub(host.db, () => new Date(123).toISOString());
    const saved = host.db.transaction(() => {
      if (event.type === "todo.updated")
        new TodosRepository(host.db).replace(sessionId, event.items, new Date(123).toISOString());
      return hub.record(sessionId, event);
    })();
    hub.publish(sessionId, saved);
  };
  record(id, { type: "todo.updated", items: plan });
  service.savePlanComment(id, {
    action: "create",
    target,
    text: 'Vérifier 😀\n"quoted" feedback',
    expectedFeedbackRevision: 0,
  });
  return {
    root,
    host,
    id,
    record,
    get service() {
      return service;
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
    async script(steps: unknown[]) {
      await writeFile(join(root, "scripts/chat.jsonl"), steps.map((step) => JSON.stringify(step)).join("\n"));
    },
  };
}
