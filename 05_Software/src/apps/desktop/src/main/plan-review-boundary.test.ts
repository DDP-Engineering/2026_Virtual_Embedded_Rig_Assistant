import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PluginStore,
  SessionHub,
  SettingsService,
  SkillCatalog,
  WorkbenchService,
  zeroUsage,
} from "@vera/core";
import { expect, it, vi } from "vitest";
import { fixture } from "./plan-review.test-support.js";
import * as mainSessions from "./sessions.js";

it("prepares review through real current configuration without warning-driven discovery", async () => {
  const env = await fixture();
  const files = {
    read: async (path: string) => {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    writeAtomic: async (path: string, text: string) => {
      await writeFile(path, text);
    },
    backup: async () => true,
  };
  const settings = new SettingsService({
    files,
    paths: { userData: env.root, settings: join(env.root, "settings.json"), logs: join(env.root, "logs") },
    uuid: randomUUID,
    changed: () => {},
  });
  await settings.load();
  const workbench = new WorkbenchService({
    userData: env.root,
    files,
    settings,
    appVersion: "0",
    now: () => new Date(123),
    pid: process.pid,
    isProcessAlive: (pid: number) => pid === process.pid,
    token: randomUUID,
    changed: () => {},
  });
  const folder = join(env.root, "real");
  await mkdir(folder);
  const host = new mainSessions.SessionsHost({
    workbench,
    settings,
    gateway: () => ({ api: env.gateway, modelReference: () => "replay/chat" }),
    clock: { now: () => new Date(123), sleep: async () => {} },
    version: "0",
    target: () => undefined,
    emit: () => {},
    credentials: { scrub: (text: string) => text, knownSecrets: () => [] },
  } as never);
  try {
    const { config } = await workbench.create(folder, "Before disk edit");
    const core = await host.run((service) => service);
    const id = core.create().id;
    const db = workbench.getDatabase();
    new SessionHub(db, () => new Date(123).toISOString()).record(id, {
      type: "todo.updated",
      items: [{ text: "Review only", status: "pending" }],
    });
    const handlers = mainSessions.planReviewHandlers(host, () => false);
    const scope = { workbenchId: config.id, sessionId: id };
    await handlers["session.plan.comment.save"]({
      ...scope,
      action: "create",
      expectedFeedbackRevision: 0,
      text: "Feedback",
      target: { revision: 1, stepIndex: 0, stepText: "Review only", range: null },
    });
    await writeFile(
      join(folder, ".vera/workbench.yaml"),
      JSON.stringify({ ...config, name: "Fresh disk name", plugins: { enabled: ["ghost"] } }),
    );
    await writeFile(join(folder, ".vera/WORKBENCH.md"), "Fresh pinned context");
    // Normal opening legitimately computes warnings. Observe the real chain only after it.
    const names = vi.spyOn(SkillCatalog.prototype, "names"),
      ids = vi.spyOn(PluginStore.prototype, "ids"),
      load = vi.spyOn(PluginStore.prototype, "load"),
      ordinary = vi.spyOn(workbench, "getConfig"),
      pinned = vi.spyOn(workbench, "getPinned"),
      stream = vi.spyOn(env.gateway, "stream");
    try {
      await handlers["session.plan.review"]({
        ...scope,
        expectedPlanRevision: 1,
        expectedFeedbackRevision: 1,
      });
      expect(await core.waitIdle(id)).toEqual({ stopReason: "end" });
      expect(stream.mock.calls[0]?.[0].system).toContain("Fresh disk name");
      expect(stream.mock.calls[0]?.[0].system).toContain("Fresh pinned context");
      expect(workbench.getSnapshot().config.name).toBe("Fresh disk name");
      expect(pinned).toHaveBeenCalledOnce();
      expect(names).not.toHaveBeenCalled();
      expect(ids).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      expect(ordinary).not.toHaveBeenCalled();
      // Preserve normal configuration warnings and all indirect discovery edges.
      expect((await workbench.getConfig()).warnings).toContainEqual({
        code: "UNKNOWN_NAME",
        path: "plugins.enabled.ghost",
      });
      expect(names).toHaveBeenCalledOnce();
      expect(ids).toHaveBeenCalled();
      expect(load).toHaveBeenCalled();
    } finally {
      for (const spy of [names, ids, load, ordinary, pinned, stream]) spy.mockRestore();
    }
  } finally {
    await host.close();
    await workbench.close();
  }
});

it("revalidates plan and feedback counters changed during awaited review preparation", async () => {
  for (const change of ["plan", "feedback"] as const) {
    const env = await fixture(),
      handlers = mainSessions.planReviewHandlers(env.host, env.containsSecret);
    await handlers["session.plan.comment.save"]({
      ...env.scope,
      action: "create",
      expectedFeedbackRevision: 0,
      text: "Original feedback",
      target: env.target,
    });
    const core = await env.host.run((service) => service);
    env.holdPinned(async () => {
      if (change === "plan")
        env.record(env.a, { type: "todo.updated", items: [{ text: "A😀B\nμC", status: "pending" }] });
      else
        core.savePlanComment(env.id, {
          action: "edit",
          expectedFeedbackRevision: 1,
          commentId: core.get(env.id).snapshot.planComments[0]?.id ?? "missing",
          text: "Edited while preparing",
        });
    });
    const stream = vi.spyOn(env.gateway, "stream");
    await expect(
      handlers["session.plan.review"]({ ...env.scope, expectedPlanRevision: 1, expectedFeedbackRevision: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(core.get(env.id).snapshot.planComments[0]?.text).toBe(
      change === "plan" ? "Original feedback" : "Edited while preparing",
    );
    expect(core.get(env.id).snapshot.planReviews).toEqual([]);
    expect(stream).not.toHaveBeenCalled();
  }
});

it("keeps late review callbacks bound to the captured database and refuses effects after replacement", async () => {
  const env = await fixture(true),
    handlers = mainSessions.planReviewHandlers(env.host, env.containsSecret);
  await handlers["session.plan.comment.save"]({
    ...env.scope,
    action: "create",
    expectedFeedbackRevision: 0,
    target: env.target,
    text: "Review",
  });
  let release = () => {},
    entered = () => {};
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  env.gateway.stream = async function* () {
    entered();
    await held;
    yield {
      type: "done",
      message: {
        role: "assistant",
        api: "replay",
        provider: "replay",
        model: "chat",
        timestamp: 1,
        usage: zeroUsage(),
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "late", name: "todo", arguments: { items: [] } }],
      },
    };
  };
  await handlers["session.plan.review"]({
    ...env.scope,
    expectedPlanRevision: 1,
    expectedFeedbackRevision: 1,
  });
  const captured = await env.host.run((service) => service);
  await started;
  try {
    env.switchToB();
    release();
    expect(await captured.waitIdle(env.id)).toEqual({ stopReason: "error" });
    for (const store of [env.a, env.b])
      expect(new SessionHub(store.db, () => "").get(env.id).snapshot.todos).toEqual([
        { text: "A😀B\nμC", status: "pending" },
      ]);
    expect(new SessionHub(env.b.db, () => "").get(env.id).snapshot.planReviews).toEqual([]);
  } finally {
    release();
  }
});
