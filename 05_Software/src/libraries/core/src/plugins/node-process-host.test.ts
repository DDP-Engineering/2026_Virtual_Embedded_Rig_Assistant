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
  it("keeps Cmd command-line quoting verbatim on Windows", () => {
    const calls: Parameters<SpawnFunction>[] = [];
    const host = new NodeProcessHost((...call) => {
      calls.push(call);
      return new FakeChild(1);
    });
    Object.defineProperty(host, "platform", { value: "win32" });
    const args = ["/d", "/s", "/c", '"echo "A&B""'];
    host.spawn("C:\\Windows\\System32\\cmd.exe", args, { ...options, windowsVerbatimArguments: true });
    expect(calls[0]?.[1]).toEqual(args);
    expect(calls[0]?.[2].windowsVerbatimArguments).toBe(true);
  });
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

  // REQ-FUNC-ba0396c0
  it("pipes stdin only for a run with input, writes it once and closes it", () => {
    const calls: Parameters<SpawnFunction>[] = [];
    const written: string[] = [];
    let ended = 0;
    const child = Object.assign(new FakeChild(2), {
      stdin: Object.assign(new EventEmitter(), {
        end: (data: string) => {
          written.push(data);
          ended++;
        },
      }),
    });
    const host = new NodeProcessHost((...call) => {
      calls.push(call);
      return child;
    });
    host.spawn("/bin/tool", [], { ...options, input: '{"a":1}\n' });
    expect(calls[0]?.[2].stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(written).toEqual(['{"a":1}\n']);
    expect(ended).toBe(1);
    // A program that exits without reading must not crash the host with EPIPE.
    expect(() =>
      child.stdin.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" })),
    ).not.toThrow();
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
