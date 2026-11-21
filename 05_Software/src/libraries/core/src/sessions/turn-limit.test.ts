import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { veraError } from "@vera/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { createToolContext } from "../tools/context.js";
import { bindDelegatedSessionHost, delegatedSessionTools } from "../tools/delegated-sessions.js";
import { TurnLimit } from "./admission.js";
import type { SessionHost } from "./service.js";
import { SessionService } from "./service.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
const turnLimit = (limit: number) => expect.objectContaining({ code: "TURN_LIMIT", params: { limit } });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** The text of the request's last user message. */
function userText(request: LlmRequest): string {
  const last = [...request.messages].reverse().find((message) => message.role === "user");
  return JSON.stringify(last?.content ?? "");
}

/**
 * One replay folder and gateway shared by several workbenches: a message containing "hold" waits until the
 * test releases it (or the turn is aborted), "fail" ends with a provider failure, "edit" asks to write.
 */
async function harness() {
  const fixtures = await mkdtemp(join(tmpdir(), "vera-turn-limit-replay-"));
  cleanup.push(() => rm(fixtures, { recursive: true, force: true }));
  const scripts = {
    "a-edit": [
      { match: "^edit", toolCalls: [{ name: "write", args: { path: "created.txt", content: "new\n" } }] },
      { text: "Written." },
    ],
    "b-reply": [{ match: ".", text: "Done." }],
  };
  for (const [name, steps] of Object.entries(scripts))
    await writeFile(join(fixtures, `${name}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
  const requests: LlmRequest[] = [];
  const holds: { text: string; release: () => void }[] = [];
  const clock = { now: () => new Date("2026-11-21T12:00:00Z"), sleep: async () => {} };
  const gateway = new (class extends ReplayGateway {
    override async *stream(request: LlmRequest) {
      requests.push(request);
      const text = userText(request);
      if (text.includes("fail")) throw veraError("PROVIDER");
      if (text.includes("hold")) {
        const gate = deferred();
        const abort = deferred();
        holds.push({ text, release: gate.resolve });
        request.signal.addEventListener("abort", abort.resolve, { once: true });
        try {
          if (!request.signal.aborted) await Promise.race([gate.promise, abort.promise]);
          request.signal.throwIfAborted();
        } finally {
          request.signal.removeEventListener("abort", abort.resolve);
        }
      }
      yield* super.stream(request);
    }
  })({ dir: fixtures, now: () => clock.now().getTime() });
  const prepareModel = vi.spyOn(gateway, "prepareModel");

  async function workbench(admission: TurnLimit, overrides: Partial<SessionHost> = {}) {
    const root = await mkdtemp(join(tmpdir(), "vera-turn-limit-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, ".vera"));
    await writeFile(join(root, "note.txt"), "old\n");
    const handle = await openDb(join(root, ".vera", "vera.db"), {
      workbenchId: `wb_${basename(root)}`,
      appVersion: "0.0.0",
    });
    cleanup.push(async () => handle.close());
    const service = new SessionService({
      db: handle.db,
      root,
      gateway,
      clock,
      mode: "ask",
      model: (model) => model ?? "replay/auto",
      prompt: () => "Fixture workbench.",
      admission,
      ...overrides,
    });
    cleanup.push(() => service.close());
    await service.waitReady();
    const count = (table: "events" | "messages", id: string) =>
      (handle.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id=?`).get(id) as { n: number }).n;
    const sessions = () => (handle.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;
    return { service, handle, count, sessions, root };
  }
  /** Settles once the gateway has received `n` requests. */
  const streams = (n: number) => expect.poll(() => requests.length, { timeout: 2000 }).toBe(n);
  const held = (n: number) => expect.poll(() => holds.length, { timeout: 2000 }).toBe(n);
  return { workbench, requests, holds, streams, held, prepareModel };
}

describe("App-wide concurrent-turn limit", () => {
  // REQ-FUNC-52e97b95
  it("refuses a fourth turn across two workbenches before recording or requesting anything", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 3 });
    const a = await h.workbench(limit);
    const b = await h.workbench(limit);
    const [a1, a2, a3] = [a.service.create(), a.service.create(), a.service.create()];
    const [b1, b2] = [b.service.create(), b.service.create()];
    a.service.send(a1.id, "hold one");
    a.service.send(a2.id, "hold two");
    b.service.send(b1.id, "hold three");
    await h.held(3);
    const before = { events: b.count("events", b2.id), messages: b.count("messages", b2.id) };
    expect(() => b.service.send(b2.id, "fourth")).toThrow(turnLimit(3));
    expect(() => a.service.send(a3.id, "fourth too")).toThrow(turnLimit(3));
    expect({ events: b.count("events", b2.id), messages: b.count("messages", b2.id) }).toEqual(before);
    expect(h.requests).toHaveLength(3);
    expect(b.service.get(b2.id).snapshot.status).toBe("idle");
    expect(limit.state()).toEqual({ active: 3, limit: 3 });

    h.holds[0]?.release();
    await a.service.waitIdle(a1.id);
    expect(limit.state().active).toBe(2);
    const sent = b.service.send(b2.id, "fourth again");
    expect(sent.turnId).toBeTruthy();
    await b.service.waitIdle(b2.id);
    for (const hold of h.holds) hold.release();
  });

  // REQ-FUNC-76e132bb
  it("queues a steering message into an active turn without a new slot at the limit", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 1 });
    const a = await h.workbench(limit);
    const b = await h.workbench(limit);
    const session = a.service.create();
    const other = b.service.create();
    const started = a.service.send(session.id, "hold steer");
    await h.held(1);
    const steered = a.service.send(session.id, "and also this");
    expect(steered.turnId).toBe(started.turnId);
    expect(
      a.service.get(session.id).snapshot.items.some((item) => item.kind === "user" && item.pending),
    ).toBe(true);
    expect(limit.state()).toEqual({ active: 1, limit: 1 });
    expect(() => b.service.send(other.id, "new turn")).toThrow(turnLimit(1));
    h.holds[0]?.release();
    await a.service.waitIdle(session.id);
  });

  // REQ-REL-11f00fcd
  it("holds a slot through an approval wait and releases it once on Stop, failure, completion and close", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 3 });
    const a = await h.workbench(limit);
    const b = await h.workbench(limit);
    const waiting = a.service.create();
    a.service.send(waiting.id, "edit the note");
    await expect
      .poll(() => a.service.get(waiting.id).snapshot.approvals.find((approval) => !approval.decision), {
        timeout: 2000,
      })
      .toBeDefined();
    expect(limit.state().active).toBe(1);
    expect(a.service.stop(waiting.id)).toBe(true);
    await a.service.waitIdle(waiting.id);
    expect(limit.state().active).toBe(0);

    const failing = a.service.create();
    a.service.send(failing.id, "fail now");
    await a.service.waitIdle(failing.id);
    expect(limit.state().active).toBe(0);

    const completing = b.service.create();
    b.service.send(completing.id, "reply please");
    await b.service.waitIdle(completing.id);
    expect(limit.state().active).toBe(0);

    const closing = b.service.create();
    b.service.send(closing.id, "hold until close");
    await h.held(1);
    expect(limit.state().active).toBe(1);
    await b.service.close();
    await b.service.close();
    expect(limit.state()).toEqual({ active: 0, limit: 3 });
  });

  // REQ-REL-11f00fcd
  it("releases the slot when a turn cannot be created after admission", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 1 });
    const a = await h.workbench(limit, {
      runtime: () => {
        throw Error("Runtime unavailable.");
      },
    });
    const session = a.service.create();
    expect(() => a.service.send(session.id, "reply please")).toThrow("Runtime unavailable.");
    expect(limit.state()).toEqual({ active: 0, limit: 1 });
  });

  // REQ-REL-1b33797f
  it("never admits more simultaneous starts than the limit across workbenches", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 2 });
    const a = await h.workbench(limit);
    const b = await h.workbench(limit);
    const targets = [a, b, a, b, a].map((bench) => ({ bench, id: bench.service.create().id }));
    const results = await Promise.allSettled(
      targets.map(({ bench, id }) => Promise.resolve().then(() => bench.service.send(id, "hold at once"))),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const refused = results.filter((result) => result.status === "rejected");
    expect(refused).toHaveLength(3);
    for (const result of refused) expect(result.reason).toEqual(turnLimit(2));
    expect(limit.state()).toEqual({ active: 2, limit: 2 });
    await h.held(2);
    for (const hold of h.holds) hold.release();
    for (const { bench, id } of targets) await bench.service.waitIdle(id);
    expect(limit.state().active).toBe(0);
  });

  // REQ-FUNC-56f63014
  it("applies a lowered limit to later sends and lets admitted turns finish", async () => {
    const h = await harness();
    let value = 3;
    const limit = new TurnLimit({ limit: () => value });
    const a = await h.workbench(limit);
    const running = [a.service.create(), a.service.create(), a.service.create()];
    for (const session of running) a.service.send(session.id, "hold before the change");
    await h.held(3);
    value = 1;
    const next = a.service.create();
    expect(() => a.service.send(next.id, "after the change")).toThrow(turnLimit(1));
    h.holds[0]?.release();
    h.holds[1]?.release();
    await a.service.waitIdle(running[0]?.id ?? "");
    await a.service.waitIdle(running[1]?.id ?? "");
    for (const session of running.slice(0, 2))
      expect(a.service.get(session.id).snapshot.items.some((item) => item.kind === "assistant")).toBe(true);
    expect(() => a.service.send(next.id, "still one running")).toThrow(turnLimit(1));
    h.holds[2]?.release();
    await a.service.waitIdle(running[2]?.id ?? "");
    a.service.send(next.id, "now there is room");
    await a.service.waitIdle(next.id);
    expect(limit.state()).toEqual({ active: 0, limit: 1 });
  });

  // REQ-FUNC-74c5be27
  it("refuses a delegated launch at the limit before preparing its model or creating a child", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 1 });
    const a = await h.workbench(limit);
    const parent = a.service.create();
    a.service.send(parent.id, "hold the parent");
    await h.held(1);
    const prepared = h.prepareModel.mock.calls.length;
    await expect(
      a.service.launchDelegated(parent.id, { requestId: "request-1", instruction: "Inspect the note." }),
    ).rejects.toEqual(turnLimit(1));
    expect(h.prepareModel.mock.calls.length).toBe(prepared);
    expect(a.sessions()).toBe(1);

    // The parent agent's session_launch tool reports the same refusal as its result.
    const ctx = createToolContext(a.root);
    ctx.delegation = bindDelegatedSessionHost(
      a.service,
      parent.id,
      () => "turn-parent",
      () => [],
    );
    const launch = delegatedSessionTools.find((tool) => tool.name === "session_launch");
    expect(
      await launch?.execute(
        ctx,
        { instruction: "Inspect the note." },
        new AbortController().signal,
        "call-1",
      ),
    ).toMatchObject({ isError: true, code: "TURN_LIMIT" });
    expect(h.prepareModel.mock.calls.length).toBe(prepared);
    expect(a.sessions()).toBe(1);
    h.holds[0]?.release();
    await a.service.waitIdle(parent.id);
  });

  // REQ-FUNC-74c5be27 REQ-REL-1b33797f REQ-REL-11f00fcd
  it("refuses a delegated launch whose slot is taken while its model is prepared, creating no child", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 1 });
    const a = await h.workbench(limit);
    const parent = a.service.create();
    const other = a.service.create();
    const preparing = deferred();
    const prepared = deferred();
    h.prepareModel.mockImplementationOnce(async () => {
      prepared.resolve();
      await preparing.promise;
    });
    const launching = a.service.launchDelegated(parent.id, {
      requestId: "request-1",
      instruction: "Inspect the note.",
    });
    await prepared.promise;
    a.service.send(other.id, "hold the last slot");
    expect(limit.state()).toEqual({ active: 1, limit: 1 });
    preparing.resolve();
    await expect(launching).rejects.toEqual(turnLimit(1));
    expect(a.sessions()).toBe(2);
    expect(limit.state()).toEqual({ active: 1, limit: 1 });
    await h.held(1);
    h.holds[0]?.release();
    await a.service.waitIdle(other.id);
    expect(limit.state().active).toBe(0);
  });

  // REQ-FUNC-74c5be27 REQ-FUNC-261cdc27
  it("keeps the per-workbench delegations cap below the app-wide limit", async () => {
    const h = await harness();
    const limit = new TurnLimit({ limit: () => 8 });
    const a = await h.workbench(limit, {
      advanced: { app: () => ({ delegations: 1 }), workbench: () => undefined },
    });
    const parent = a.service.create();
    const child = await a.service.launchDelegated(parent.id, {
      requestId: "request-1",
      instruction: "hold the child",
    });
    expect(limit.state().active).toBe(1);
    await expect(
      a.service.launchDelegated(parent.id, { requestId: "request-2", instruction: "Inspect the note." }),
    ).rejects.toEqual(expect.objectContaining({ code: "BUSY" }));
    expect(limit.state().active).toBe(1);
    await h.held(1);
    h.holds[0]?.release();
    await a.service.waitIdle(child.sessionId);
    expect(limit.state().active).toBe(0);
  });
});
