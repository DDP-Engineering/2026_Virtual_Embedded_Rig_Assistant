import type { SessionService } from "@vera/core";
import { type SessionSummary, veraError, type WorkbenchSnapshot } from "@vera/shared";
import { expect, it, vi } from "vitest";
import type { InvokeSender } from "./ipc-router.js";
import { type RoutedRuntime, SessionRouter } from "./session-router.js";

const A = "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0A";
const B = "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0B";
const SHARED = "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0S";
const MISSING = "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0M";
const sender = { senderFrame: {} } as unknown as InvokeSender;

/** A database whose sessions table holds `ids`. */
function database(ids: string[]) {
  return { open: true, prepare: () => ({ get: (id: string) => (ids.includes(id) ? { 1: 1 } : undefined) }) };
}

/** A scripted runtime: one workbench and its sessions; its host runs operations through a queue. */
class Runtime implements RoutedRuntime {
  open = true;
  db: ReturnType<typeof database>;
  readonly ran: string[] = [];
  readonly subscriptions = new Set<string>();
  active: SessionSummary[] = [];
  /** Holds the next queued operation until released. */
  hold: Promise<void> | undefined;
  constructor(
    readonly id: string,
    public folder: string,
    sessions: string[],
  ) {
    this.db = database(sessions);
  }
  readonly service = { name: "service" } as unknown as SessionService;
  readonly workbench = {
    getSnapshot: () => {
      if (!this.open) throw veraError("NOT_FOUND");
      return { config: { id: this.id }, folder: this.folder } as unknown as WorkbenchSnapshot;
    },
    getDatabase: () => {
      if (!this.open) throw veraError("NOT_FOUND");
      return this.db as never;
    },
  };
  readonly sessions = {
    run: async <T>(
      operation: (service: SessionService) => T | Promise<T>,
      _prepare?: boolean,
      guard?: () => void,
    ) => {
      await this.hold;
      guard?.();
      return operation(this.service);
    },
    subscription: vi.fn(async (_event: InvokeSender, action: unknown, raw: unknown, guard?: () => void) => {
      const request = raw as { subscriptionId: string };
      if (action === "subscribe") {
        guard?.();
        this.subscriptions.add(request.subscriptionId);
      } else this.subscriptions.delete(request.subscriptionId);
      return { ok: true as const, value: {} };
    }),
    holdsSubscription: (id: string) => this.subscriptions.has(id),
    authorized: (event: InvokeSender) => event === sender,
    activity: async () => this.active,
  };
}

function harness() {
  // Foreground B first, then background A; the clone of A shares A's workbench ID and a session.
  const b = new Runtime("wb_B", "/b", [B, SHARED]);
  const a = new Runtime("wb_A", "/a", [A, SHARED]);
  const runtimes = [b, a];
  const router = new SessionRouter(() => runtimes);
  const owner = (sessionId: string, workbenchId?: string) =>
    router.inSession(sessionId, (_service, snapshot) => snapshot.folder, false, workbenchId);
  return { a, b, runtimes, router, owner };
}

// REQ-FUNC-038c9b9b
it("runs a request in the runtime that holds its session, whichever is in the foreground", async () => {
  const { a, b, runtimes, owner } = harness();
  expect(await owner(A)).toBe("/a");
  expect(await owner(B)).toBe("/b");
  expect(await owner(A, "wb_A")).toBe("/a");
  // A session both hold (a copied folder) goes to the foreground one.
  expect(await owner(SHARED)).toBe("/b");
  runtimes.reverse();
  expect(await owner(SHARED)).toBe("/a");
  expect([a.open, b.open]).toEqual([true, true]);
});

// REQ-REL-6ca70bd2
it("answers NOT_FOUND for a session no open workbench holds, also after its workbench closed", async () => {
  const { a, owner, router } = harness();
  const run = vi.spyOn(a.sessions, "run");
  await expect(owner(MISSING)).rejects.toMatchObject({ code: "NOT_FOUND" });
  a.open = false;
  await expect(owner(A)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(run).not.toHaveBeenCalled();
  // Naming the open foreground does not send the released session there.
  expect(() => router.session(A, "wb_B")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
});

// REQ-SEC-cf233e14
it("answers CONFLICT when the named workbench is not open or does not hold the session", async () => {
  const { a, b, owner } = harness();
  const runs = [vi.spyOn(a.sessions, "run"), vi.spyOn(b.sessions, "run")];
  await expect(owner(A, "wb_B")).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(owner(A, "wb_X")).rejects.toMatchObject({ code: "CONFLICT" });
  for (const run of runs) expect(run).not.toHaveBeenCalled();
  // The named, open workbench without the session: the session is unknown there.
  await expect(owner(MISSING, "wb_A")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

// REQ-REL-6e1454c1
it("answers CONFLICT when the routed runtime changed its workbench before the request ran", async () => {
  const { a, owner, router } = harness();
  let release = () => {};
  a.hold = new Promise((resolve) => {
    release = resolve;
  });
  const pending = owner(A);
  // Another workbench (same ID, another folder) opens in the runtime before the queued slot comes.
  a.folder = "/elsewhere";
  release();
  await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
  a.folder = "/a";
  a.hold = undefined;
  // A replaced database counts as a change too; an unchanged runtime runs the request.
  const operation = vi.fn();
  const route = router.session(A);
  const db = a.db;
  a.db = database([A]);
  await expect(router.run(route, operation)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(operation).not.toHaveBeenCalled();
  a.db = db;
  await router.run(route, operation);
  expect(operation).toHaveBeenCalledOnce();
});

// REQ-FUNC-eb591891
it("runs a workbench-scoped request in the open runtime with that ID, else the foreground", async () => {
  const { a, router, runtimes } = harness();
  const folder = (id?: string) => router.inWorkbench(id, (_service, owner) => owner.folder);
  expect(await folder("wb_A")).toBe("/a");
  expect(await folder("wb_B")).toBe("/b");
  expect(await folder(undefined)).toBe("/b");
  await expect(folder("wb_X")).rejects.toMatchObject({ code: "CONFLICT" });
  // A closed foreground leaves nothing to default to; nothing open at all is NOT_FOUND.
  (runtimes[0] as Runtime).open = false;
  await expect(folder(undefined)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await folder("wb_A")).toBe("/a");
  a.open = false;
  await expect(folder("wb_A")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

// REQ-FUNC-4f478637
it("opens a subscription in the session's owner and ends it wherever it is", async () => {
  const { a, b, router } = harness();
  const subscribe = (sessionId: string, subscriptionId: string, event = sender) =>
    router.subscription(event, "subscribe", { sessionId, sinceSeq: 0, subscriptionId });
  expect(await subscribe(A, "s1")).toEqual({ ok: true, value: {} });
  expect([...a.subscriptions, ...b.subscriptions]).toEqual(["s1"]);
  expect(a.subscriptions.has("s1")).toBe(true);
  // A subscription ID is unique across runtimes; unknown sessions and foreign frames are refused.
  expect(await subscribe(B, "s1")).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  expect(await subscribe(MISSING, "s2")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  const foreign = { senderFrame: {} } as unknown as InvokeSender;
  expect(await subscribe(A, "s3", foreign)).toMatchObject({ ok: false, error: { code: "DENIED" } });
  expect(await router.subscription(sender, "unsubscribe", { subscriptionId: "s1" })).toEqual({
    ok: true,
    value: {},
  });
  expect(a.subscriptions.size + b.subscriptions.size).toBe(0);
});

// REQ-FUNC-93ec5cc7
it("lists every open runtime, foreground first, with its running and awaiting sessions", async () => {
  const { a, b, router } = harness();
  const waiting = { id: A, title: "Edit", status: "awaiting_approval" } as SessionSummary;
  a.active = [waiting];
  b.sessions.activity = async () => {
    throw veraError("CONFLICT");
  };
  const listed = await router.activity();
  expect(listed.map(({ snapshot, foreground, sessions }) => [snapshot.folder, foreground, sessions])).toEqual(
    [
      ["/b", true, []],
      ["/a", false, [waiting]],
    ],
  );
  a.open = false;
  expect((await router.activity()).map(({ snapshot }) => snapshot.folder)).toEqual(["/b"]);
});
