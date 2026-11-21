import { veraError, type WorkbenchSnapshot } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { type WorkbenchRuntime, WorkbenchRuntimes } from "./workbench-runtimes.js";

/** A scripted runtime: one workbench folder at most, owned work switched by the test. */
class ScriptedRuntime implements WorkbenchRuntime {
  folder: string | undefined;
  /** Owned work: queued operations, active turns, approvals or compaction. */
  work = false;
  failClose = false;
  constructor(
    readonly name: string,
    readonly settled: () => void,
    private readonly events: string[],
    private readonly failing: Set<string>,
    private readonly gates: Map<string, Promise<void>>,
  ) {}
  private record(action: string) {
    this.events.push(`${this.name}:${action}`);
  }
  readonly workbench = {
    locate: async (input: string) => {
      if (input === "missing") throw veraError("NOT_FOUND");
      // Canonical form: a trailing slash names the same folder.
      return input.replace(/\/$/, "");
    },
    open: async (input: string) => {
      const folder = input.replace(/\/$/, "");
      this.record(`open ${folder}`);
      await this.gates.get(folder);
      if (this.failing.has(folder)) throw veraError("INVALID");
      this.folder = folder;
      return this.snapshot();
    },
    create: async (input: string, name: string) => {
      this.record(`create ${input} ${name}`);
      if (this.failing.has(input)) throw veraError("CONFLICT");
      this.folder = input;
      return this.snapshot();
    },
    close: async () => {
      this.record("close");
      if (this.failClose) throw veraError("BUSY");
      this.folder = undefined;
    },
    getSnapshot: () => this.snapshot(),
  };
  readonly sessions = {
    lifecycle: async <T>(operation: () => Promise<T>, drain = true) => {
      if (drain) this.record("drain");
      return operation();
    },
    close: async () => this.record("sessions.close"),
    idle: () => !this.work,
    busy: () => this.work,
    beginShutdown: () => {
      this.record("shutdown");
      return !this.work;
    },
    clearSubscriptions: () => this.record("unsubscribe"),
  };
  private snapshot(): WorkbenchSnapshot {
    if (!this.folder) throw veraError("NOT_FOUND");
    return {
      folder: this.folder,
      readOnly: false,
      warnings: [],
      config: { id: `wb_${this.folder}` },
    } as unknown as WorkbenchSnapshot;
  }
}

function harness() {
  const events: string[] = [];
  const failing = new Set<string>();
  const gates = new Map<string, Promise<void>>();
  const made: ScriptedRuntime[] = [];
  const logged: string[] = [];
  const changed = { count: 0 };
  const runtimes = new WorkbenchRuntimes<ScriptedRuntime>({
    create: (settled) => {
      const runtime = new ScriptedRuntime(`r${made.length}`, settled, events, failing, gates);
      made.push(runtime);
      return runtime;
    },
    stopPrograms: async (folder) => {
      events.push(`stop ${folder}`);
    },
    log: (event) => logged.push(event),
    changed: () => {
      changed.count++;
    },
  });
  const runtimeOf = (folder: string) => runtimes.all().find((runtime) => runtime.folder === folder);
  return { runtimes, events, failing, gates, made, logged, runtimeOf, changed };
}

/** Lets queued registry work run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// REQ-FUNC-db6bacf7, REQ-FUNC-0dfa01fd
it("keeps a busy workbench in the background and releases it once its work settles", async () => {
  const { runtimes, events, runtimeOf } = harness();
  await runtimes.open("A");
  const a = runtimeOf("A") as ScriptedRuntime;
  a.work = true;
  await runtimes.open("B");
  expect(runtimes.foreground.folder).toBe("B");
  expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["B", "A"]);
  // A keeps its sessions, subscriptions, programs and lock in the background.
  expect(events.filter((event) => event.startsWith("r0:") || event === "stop A")).toEqual(["r0:open A"]);
  // A settled signal while work remains keeps the runtime.
  a.settled();
  await settle();
  expect(runtimes.all()).toContain(a);
  a.work = false;
  events.length = 0;
  a.settled();
  await vi.waitFor(() => expect(runtimes.all()).toEqual([runtimes.foreground]));
  expect(events).toEqual(["r0:drain", "stop A", "r0:close"]);
});

// REQ-FUNC-0dfa01fd
it("keeps a runtime that has work again or is back in the foreground when its queued release runs", async () => {
  const { runtimes, events, gates, runtimeOf } = harness();
  await runtimes.open("A");
  const a = runtimeOf("A") as ScriptedRuntime;
  a.work = true;
  await runtimes.open("B");
  const hold = (folder: string) => {
    let release = () => {};
    gates.set(
      folder,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  };
  // The settled release queues behind a pending open; A has work again when it runs.
  const releaseC = hold("C");
  const openC = runtimes.open("C");
  a.work = false;
  a.settled();
  a.work = true;
  releaseC();
  await openC;
  await settle();
  expect(runtimes.all()).toContain(a);
  // The settled release queues behind the open that brings A back to the foreground.
  const releaseA = hold("A");
  const openA = runtimes.open("A");
  a.work = false;
  a.settled();
  releaseA();
  await openA;
  await settle();
  expect(runtimes.foreground).toBe(a);
  expect(events.filter((event) => /^r0:(drain|close)$/.test(event) || event === "stop A")).toEqual([]);
});

// REQ-FUNC-0dfa01fd
it("releases an idle workbench as soon as another workbench opens", async () => {
  const { runtimes, events } = harness();
  await runtimes.open("A");
  events.length = 0;
  await runtimes.open("B");
  expect(events).toEqual(["r1:open B", "r0:drain", "stop A", "r0:close"]);
  expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["B"]);
});

// REQ-FUNC-0278c7ba
it("reopens the current workbench in place without draining its sessions", async () => {
  const { runtimes, events, made } = harness();
  await runtimes.open("A");
  const a = runtimes.foreground;
  a.work = true;
  events.length = 0;
  const snapshot = await runtimes.open("A/");
  expect(snapshot.folder).toBe("A");
  expect(runtimes.foreground).toBe(a);
  expect(made).toHaveLength(1);
  expect(events).toEqual(["r0:open A"]);
});

// REQ-FUNC-0278c7ba, REQ-FUNC-db6bacf7
it("reuses each retained runtime across repeated navigation", async () => {
  const { runtimes, events, made, runtimeOf } = harness();
  await runtimes.open("A");
  (runtimeOf("A") as ScriptedRuntime).work = true;
  await runtimes.open("B");
  (runtimeOf("B") as ScriptedRuntime).work = true;
  for (const folder of ["A", "B", "A", "B"]) {
    await runtimes.open(folder);
    expect(runtimes.foreground.folder).toBe(folder);
  }
  expect(made).toHaveLength(2);
  expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["B", "A"]);
  expect(events.filter((event) => /drain|close|stop/.test(event))).toEqual([]);
  // The busy workbenches stay open until their work settles, whatever the order of navigation.
  const a = runtimeOf("A") as ScriptedRuntime;
  a.work = false;
  a.settled();
  await vi.waitFor(() => expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["B"]));
});

// REQ-REL-b10ee7aa
it("keeps every open workbench unchanged when the target fails to open", async () => {
  const { runtimes, events, failing, made, runtimeOf } = harness();
  await runtimes.open("A");
  (runtimeOf("A") as ScriptedRuntime).work = true;
  await runtimes.open("B");
  const b = runtimes.foreground;
  b.work = true;
  failing.add("C");
  failing.add("D");
  events.length = 0;
  await expect(runtimes.open("C")).rejects.toMatchObject({ code: "INVALID" });
  await expect(runtimes.open("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(runtimes.create("D", "draft")).rejects.toMatchObject({ code: "CONFLICT" });
  expect(runtimes.foreground).toBe(b);
  expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["B", "A"]);
  expect(events.filter((event) => /drain|close|stop|unsubscribe/.test(event))).toEqual([]);
  // A later attempt starts from a fresh runtime.
  failing.delete("C");
  await runtimes.open("C");
  expect(runtimes.foreground).toBe(made.at(-1));
  expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["C", "A", "B"]);
});

// REQ-FUNC-db6bacf7
it("creates a workbench in a fresh runtime and keeps the busy previous one", async () => {
  const { runtimes, runtimeOf } = harness();
  await runtimes.open("A");
  (runtimeOf("A") as ScriptedRuntime).work = true;
  const created = await runtimes.create("N", "New");
  expect(created.folder).toBe("N");
  expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["N", "A"]);
});

// REQ-FUNC-4af886f8
it("closes only the current workbench while background workbenches keep running", async () => {
  const { runtimes, events, runtimeOf } = harness();
  await runtimes.open("A");
  const a = runtimeOf("A") as ScriptedRuntime;
  a.work = true;
  await runtimes.open("B");
  const b = runtimes.foreground;
  events.length = 0;
  await runtimes.close();
  expect(events).toEqual(["r1:drain", "stop B", "r1:close"]);
  expect(runtimes.foreground).toBe(b);
  expect(b.folder).toBeUndefined();
  expect(runtimes.all()).toEqual([b, a]);
  // The empty foreground opens the next workbench itself; A is still released when it settles.
  await runtimes.open("C");
  expect(runtimes.foreground).toBe(b);
  a.work = false;
  a.settled();
  await vi.waitFor(() => expect(runtimes.all()).toEqual([b]));
});

// REQ-FUNC-0dfa01fd
it("logs a failed release and keeps that workbench for the exit drain", async () => {
  const { runtimes, logged, runtimeOf } = harness();
  await runtimes.open("A");
  const a = runtimeOf("A") as ScriptedRuntime;
  a.failClose = true;
  await runtimes.open("B");
  expect(runtimes.foreground.folder).toBe("B");
  expect(runtimes.all()).toContain(a);
  expect(logged).toEqual(["workbench.release.failed"]);
});

// REQ-REL-61e5471c
it("refuses the safe update while any workbench or lifecycle operation is busy, then locks all", async () => {
  const { runtimes, events, gates, runtimeOf } = harness();
  await runtimes.open("A");
  const a = runtimeOf("A") as ScriptedRuntime;
  a.work = true;
  await runtimes.open("B");
  expect(runtimes.beginShutdown()).toBe(false);
  a.work = false;
  let release = () => {};
  gates.set(
    "C",
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = runtimes.open("C");
  expect(runtimes.beginShutdown()).toBe(false);
  release();
  await pending;
  await settle();
  events.length = 0;
  expect(runtimes.beginShutdown()).toBe(true);
  expect(events.filter((event) => event.endsWith(":shutdown"))).toHaveLength(runtimes.all().length);
  await expect(runtimes.open("D")).rejects.toMatchObject({ code: "BUSY" });
  await expect(runtimes.close()).rejects.toMatchObject({ code: "BUSY" });
});

// REQ-REL-436f00da
it("closes the sessions and then the workbench of every runtime on exit, past a failure", async () => {
  const { runtimes, events, runtimeOf } = harness();
  await runtimes.open("A");
  const a = runtimeOf("A") as ScriptedRuntime;
  a.work = true;
  a.failClose = true;
  await runtimes.open("B");
  events.length = 0;
  await runtimes.closeSessions();
  expect(events.sort()).toEqual(["r0:sessions.close", "r1:sessions.close"]);
  events.length = 0;
  await expect(runtimes.closeWorkbenches()).rejects.toMatchObject({ code: "BUSY" });
  expect(events.sort()).toEqual(["r0:close", "r1:close"]);
  await expect(runtimes.open("C")).rejects.toMatchObject({ code: "BUSY" });
});

// REQ-FUNC-a6aa5e7c, REQ-FUNC-4f478637
it("announces each lifecycle change and settled release, and keeps subscriptions across them", async () => {
  const { runtimes, events, failing, runtimeOf, changed } = harness();
  await runtimes.open("A");
  expect(changed.count).toBe(1);
  const a = runtimeOf("A") as ScriptedRuntime;
  a.work = true;
  await runtimes.open("B");
  expect(changed.count).toBe(2);
  failing.add("C");
  await expect(runtimes.open("C")).rejects.toMatchObject({ code: "INVALID" });
  expect(changed.count).toBe(3);
  a.work = false;
  a.settled();
  await vi.waitFor(() => expect(changed.count).toBe(4));
  expect(runtimes.all().map((runtime) => runtime.folder)).toEqual(["B"]);
  await runtimes.close();
  expect(changed.count).toBe(5);
  expect(events.filter((event) => event.endsWith("unsubscribe"))).toEqual([]);
});
