import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { NodeProcessHost, type SpawnFunction } from "./node-process-host.js";

class FakePipe extends EventEmitter {
  destroyed = false;
  destroy() {
    this.destroyed = true;
  }
}
class FakeChild extends EventEmitter {
  readonly stdout = new FakePipe();
  readonly stderr = new FakePipe();
  constructor(readonly pid: number | undefined) {
    super();
  }
}

const options = { cwd: "/w", env: { PATH: "/bin" }, group: true, output: () => {} };

describe("NodeProcessHost", () => {
  it("spawns without a shell, hidden, with stdin closed and the requested group", () => {
    const calls: Parameters<SpawnFunction>[] = [];
    const host = new NodeProcessHost((...call) => {
      calls.push(call);
      return new FakeChild(1);
    });
    host.spawn("/bin/tool", ["a b"], options);
    expect(calls).toEqual([
      [
        "/bin/tool",
        ["a b"],
        {
          cwd: "/w",
          env: { PATH: "/bin" },
          shell: false,
          windowsHide: true,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ],
    ]);
  });

  it("reports a synchronous spawn failure as a program that could not start", async () => {
    const host = new NodeProcessHost(() => {
      throw Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" });
    });
    const spawned = host.spawn("C:\\tool.cmd", [], options);
    expect(spawned.pid).toBeUndefined();
    expect(await spawned.exit).toEqual({ code: null, signal: null, error: "EINVAL" });
  });

  it("settles after the close grace when a descendant keeps the pipes open", async () => {
    const child = new FakeChild(7);
    const host = new NodeProcessHost(() => child, 20);
    const spawned = host.spawn("/bin/tool", [], options);
    child.emit("exit", 0, null);
    expect(await spawned.exit).toEqual({ code: 0, signal: null });
    expect(child.stdout.destroyed && child.stderr.destroyed).toBe(true);
  });

  it("settles on close when the pipes close in time", async () => {
    const child = new FakeChild(7);
    const host = new NodeProcessHost(() => child, 60_000);
    const spawned = host.spawn("/bin/tool", [], options);
    child.emit("exit", 2, null);
    child.emit("close", 2, null);
    expect(await spawned.exit).toEqual({ code: 2, signal: null });
    expect(child.stdout.destroyed).toBe(false);
  });
});
