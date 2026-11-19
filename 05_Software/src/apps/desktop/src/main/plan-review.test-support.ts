import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LlmGateway,
  openDb,
  SessionHub,
  SessionService,
  TodosRepository,
  WriteQueue,
  zeroUsage,
} from "@vera/core";
import { defaultSettings, type SessionEvent, workbenchSchema } from "@vera/shared";
import { onTestFinished, vi } from "vitest";
import * as mainSessions from "./sessions.js";

export async function fixture(sameWorkbenchId = false) {
  const root = await mkdtemp(join(tmpdir(), "vera-plan-review-main-"));
  const stores: Array<
    Awaited<ReturnType<typeof openDb>> & { folder: string; config: ReturnType<typeof workbenchSchema.parse> }
  > = [];
  for (let i = 0; i < 2; i++) {
    const folder = join(root, String(i));
    await mkdir(folder);
    await mkdir(join(folder, ".vera"));
    const config = workbenchSchema.parse({
      format: 1,
      id: i && !sameWorkbenchId ? "wb_01J00000000000000000000001" : "wb_01J00000000000000000000000",
      name: `Board ${i}`,
    });
    stores.push({
      folder,
      config,
      ...(await openDb(join(folder, ".vera/vera.db"), { workbenchId: config.id, appVersion: "0" })),
    });
  }
  const a = stores[0],
    b = stores[1];
  if (!a || !b) throw Error("fixture stores missing");
  let current = a;
  const gateway: LlmGateway = {
    capabilities: () => ({
      input: ["text"],
      contextWindow: 32768,
      maxOutputTokens: 4096,
      safetyMargin: 1639,
      inputBudget: 27033,
      supportsTools: true,
    }),
    selectedModel: () => "chat",
    models: async () => ({ models: [], reachability: "pass" }),
    stream: async function* () {
      yield {
        type: "done",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Brief explanation: review only." }],
          api: "replay",
          provider: "replay",
          model: "chat",
          timestamp: 1,
          usage: zeroUsage(),
          stopReason: "stop",
        },
      };
    },
  };
  const clock = { now: () => new Date(123), sleep: async () => {} };
  const core = new SessionService({
    root: a.folder,
    db: a.db,
    clock,
    gateway,
    model: () => "replay/chat",
    prompt: () => "Test",
  });
  await core.waitReady();
  const id = core.create().id;
  await core.close();
  b.db
    .prepare(
      "INSERT INTO sessions(id,title,permission_mode,status,created_at,updated_at) VALUES (?,'','ask','idle',?,?)",
    )
    .run(id, new Date(123).toISOString(), new Date(123).toISOString());
  const record = (store: typeof a, event: SessionEvent) => {
    const hub = new SessionHub(store.db, () => new Date(123).toISOString());
    store.db.transaction(() => {
      if (event.type === "todo.updated")
        new TodosRepository(store.db).replace(id, event.items, new Date(123).toISOString());
      hub.record(id, event);
    })();
  };
  for (const store of stores)
    record(store, { type: "todo.updated", items: [{ text: "A😀B\nμC", status: "pending" }] });
  let configWait = async () => {},
    pinnedWait = async () => {};
  const skills = vi.fn(async () => []),
    loadPlugins = vi.fn(async () => []),
    resolve = vi.fn(async () => undefined);
  const getConfig = vi.fn(async () => {
    await configWait();
    return { config: current.config };
  });
  const getPinned = vi.fn(async () => {
    await pinnedWait();
    return { content: "Pinned board context" };
  });
  const containsSecret = (value: unknown) => typeof value === "string" && value.includes("credential-secret");
  const host = new mainSessions.SessionsHost({
    workbench: {
      getSnapshot: () => ({ folder: current.folder, config: current.config, readOnly: false }),
      getDatabase: () => current.db,
      getConfig,
      getPinned,
      getWriteQueue: () => new WriteQueue(),
      skillCatalog: () => ({ list: skills }),
      loadPlugins,
      assertSessionWritable: () => {},
    },
    settings: { get: () => ({ settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19") }) },
    gateway: () => ({ api: gateway, modelReference: () => "replay/chat" }),
    clock,
    version: "0",
    target: () => undefined,
    emit: () => {},
    credentials: {
      scrub: (text: string) => text.replaceAll("credential-secret", "[REDACTED]"),
      knownSecrets: () => ["credential-secret"],
    },
    programs: { runner: { stopSession: async () => {} }, resolver: { resolve } },
  } as never);
  onTestFinished(async () => {
    await host.close();
    for (const store of stores) store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    a,
    b,
    id,
    host,
    gateway,
    containsSecret,
    skills,
    loadPlugins,
    resolve,
    getConfig,
    getPinned,
    record,
    get current() {
      return current;
    },
    switchToB() {
      current = b;
    },
    holdConfig(wait: () => Promise<void>) {
      configWait = wait;
    },
    holdPinned(wait: () => Promise<void>) {
      pinnedWait = wait;
    },
    scope: { workbenchId: a.config.id, sessionId: id },
    target: { revision: 1, stepIndex: 0, stepText: "A😀B\nμC", range: { start: 1, end: 3, quote: "😀" } },
  };
}
