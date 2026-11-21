import { type CommandShell, capToolResult } from "@vera/core";
import { describe, expect, it, vi } from "vitest";
import { TerminalService, type UserPty } from "./terminals.js";

function fixture() {
  const limits = { terminals: 8, bufferChars: 262144, agentChars: 12000 };
  let masking = true;
  let agent = true;
  let current = { id: "bench-a", folder: "/workbench" };
  const processes: ReturnType<typeof pty>[] = [];
  function pty() {
    let data = (_text: string) => {};
    let exit = (_value: { exitCode: number }) => {};
    return {
      pid: 123,
      write: vi.fn(),
      resize: vi.fn(),
      print: (text: string) => data(text),
      finish: () => exit({ exitCode: 7 }),
      onData: (listener: typeof data) => {
        data = listener;
        return {
          dispose: () => {
            data = () => {};
          },
        };
      },
      onExit: (listener: typeof exit) => {
        exit = listener;
        return {
          dispose: () => {
            exit = () => {};
          },
        };
      },
    };
  }
  const spawn = vi.fn(() => {
    const child = pty();
    processes.push(child);
    return child;
  });
  const stop = vi.fn(async (_pty: UserPty) => {});
  const shell = {
    resolve: vi.fn(async (): Promise<CommandShell> => ({ executable: "/bin/bash", kind: "bash" })),
    environment: () => ({ PATH: "/bin", HOME: "/home/user" }),
  };
  const service = new TerminalService({
    current: () => current,
    maskUserOutput: () => masking,
    maskAgentOutput: () => agent,
    shell,
    pty: { spawn, stop },
    scrub: (text) => text.replaceAll("private-token-123", "[REDACTED]"),
    secrets: () => ["private-token-123"],
    limits: () => limits,
  });
  return {
    service,
    limits,
    agent: (value: boolean) => {
      agent = value;
    },
    masking: (value: boolean) => {
      masking = value;
    },
    processes,
    spawn,
    stop,
    shell,
    switch: () => {
      current = { id: "bench-b", folder: "/other" };
    },
  };
}

describe("user terminal host", () => {
  it("fails closed on shell mismatch, exited terminals, invalid text and foreign workbench destinations", async () => {
    const f = fixture();
    const terminal = await f.service.create("bench-a", 80, 24);
    await expect(
      f.service.execute("bench-a", terminal.id, "powershell", "Get-Content README.MD"),
    ).rejects.toBeDefined();
    for (const text of ["", "x".repeat(16385), "echo x\u001b[200~", "echo x\0"])
      await expect(f.service.execute("bench-a", terminal.id, "bash", text)).rejects.toBeDefined();
    await expect(f.service.execute("bench-b", terminal.id, "bash", "pwd")).rejects.toBeDefined();
    f.processes[0]!.finish();
    await expect(f.service.execute("bench-a", terminal.id, "bash", "pwd")).rejects.toBeDefined();
    expect(f.processes[0]!.write).not.toHaveBeenCalled();
    f.switch();
    await expect(f.service.execute("bench-b", terminal.id, "bash", "pwd")).rejects.toBeDefined();
    await f.service.closeAll();
  });
  it("does not create an incompatible terminal or finish creation after a workbench switch", async () => {
    const f = fixture();
    await expect(f.service.create("bench-a", 80, 24, "powershell")).rejects.toMatchObject({
      messageKey: "chatActions.shellMismatch",
    });
    let release: ((shell: CommandShell) => void) | undefined;
    f.shell.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.service.create("bench-a", 80, 24, "bash");
    f.switch();
    release!({ executable: "/bin/bash", kind: "bash" });
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.spawn).not.toHaveBeenCalled();
  });
  it.each(["powershell", "cmd", "bash", "sh"] as const)(
    "starts new %s terminals with interactive arguments",
    async (kind) => {
      const f = fixture();
      f.shell.resolve.mockResolvedValue({ executable: kind, kind });
      await f.service.create("bench-a", 80, 24);
      expect(f.spawn).toHaveBeenCalledWith(
        kind,
        kind === "powershell" ? ["-NoLogo"] : kind === "cmd" ? ["/d"] : kind === "bash" ? ["-il"] : ["-i"],
        expect.objectContaining({ cwd: "/workbench", cols: 80, rows: 24 }),
      );
      await f.service.closeAll();
    },
  );
  it("publishes a consented control-heavy capture after the registry caps serialized JSON", async () => {
    const f = fixture(),
      a = await f.service.create("bench-a", 80, 24);
    f.service.consent("bench-a", a.id, true);
    f.processes[0]?.print("\0".repeat(12000));
    const reader = f.service.reader("bench-a");
    const capped = capToolResult(reader.read(a.id));
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(32000);
    const published = JSON.parse(reader.publish(capped.text));
    expect(published.truncated).toBe(true);
    expect(published.text).toContain("[truncated]");
    expect(published).not.toHaveProperty("leases");
    f.service.consent("bench-a", a.id, false);
    expect(() => reader.publish(capped.text)).toThrow();
  });
  it("cleans session jobs for finished terminals on user close and workbench close", async () => {
    const f = fixture();
    const a = await f.service.create("bench-a", 80, 24);
    await f.service.create("bench-a", 80, 24);
    f.processes[0]?.finish();
    f.processes[1]?.finish();
    await f.service.close("bench-a", a.id);
    await f.service.closeAll();
    expect(f.stop.mock.calls).toEqual([[f.processes[0]], [f.processes[1]]]);
  });
  it("rejects an old read capability when the current workbench changes before close notification", async () => {
    const f = fixture(),
      terminal = await f.service.create("bench-a", 80, 24);
    f.service.consent("bench-a", terminal.id, true);
    const reader = f.service.reader("bench-a"),
      output = JSON.stringify(reader.read(terminal.id));
    f.switch();
    expect(() => reader.read(terminal.id)).toThrow();
    expect(() => reader.publish(output)).toThrow();
    expect(() => f.service.output("bench-b", terminal.id)).toThrow();
    await f.service.closeAll();
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
  it("starts an interactive shell in the host folder with user input and PTY dimensions", async () => {
    const f = fixture();
    const terminal = await f.service.create("bench-a", 80, 24);
    expect(f.spawn).toHaveBeenCalledWith("/bin/bash", ["-il"], {
      cwd: "/workbench",
      env: { PATH: "/bin", HOME: "/home/user" },
      cols: 80,
      rows: 24,
    });
    f.service.input("bench-a", terminal.id, "pwd\r");
    f.service.resize("bench-a", terminal.id, 50, 10);
    expect(f.processes[0]?.write).toHaveBeenCalledWith("pwd\r");
    expect(f.processes[0]?.resize).toHaveBeenCalledWith(50, 10);
    f.processes[0]?.finish();
    expect(f.service.output("bench-a", terminal.id)).toMatchObject({ running: false, exitCode: 7 });
    expect(() => f.service.input("bench-a", terminal.id, "x")).toThrow();
  });
  it("denies by default, shares one terminal and revokes captured leases immediately", async () => {
    const f = fixture(),
      reader = f.service.reader("bench-a");
    const a = await f.service.create("bench-a", 80, 24),
      b = await f.service.create("bench-a", 80, 24);
    f.processes[0]?.print("\u001b[31mhello\u001b[0m\r\n");
    expect(() => reader.read(a.id)).toThrow(/consent/);
    expect(reader.read()).toMatchObject({ terminals: [] });
    f.service.consent("bench-a", a.id, true);
    expect(() => reader.read(b.id)).toThrow(/consent/);
    const result = JSON.stringify(reader.read(a.id));
    expect(JSON.parse(reader.publish(result))).toMatchObject({ text: "hello\r\n" });
    expect(reader.publish(result)).not.toContain("leases");
    f.service.consent("bench-a", a.id, false);
    expect(() => reader.publish(result)).toThrow(/revoked/);
    f.service.consent("bench-a", a.id, true);
    expect(() => reader.publish(result)).toThrow(/revoked/);
  });
  it("refuses foreign/stale workbenches and closed IDs at read and publication", async () => {
    const f = fixture(),
      reader = f.service.reader("bench-a");
    const a = await f.service.create("bench-a", 80, 24);
    f.service.consent("bench-a", a.id, true);
    const result = JSON.stringify(reader.read(a.id));
    expect(() => f.service.output("bench-b", a.id)).toThrow();
    await f.service.close("bench-a", a.id);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(() => reader.publish(result)).toThrow();
    expect(() => reader.read(a.id)).toThrow();
    f.switch();
    expect(() => reader.publish(result)).toThrow();
    expect(() => f.service.list("bench-a")).toThrow();
  });
  it("masks split credentials, strips VT for agents and bounds recent output", async () => {
    const f = fixture(),
      a = await f.service.create("bench-a", 80, 24);
    f.processes[0]?.print("prefix private-token-");
    expect(f.service.output("bench-a", a.id).output).toBe("prefix ");
    f.processes[0]?.print("123\n");
    expect(f.service.output("bench-a", a.id).output).toBe("prefix [REDACTED]\n");
    f.processes[0]?.print("0123456789\n".repeat(50000));
    expect(f.service.output("bench-a", a.id).output.length).toBeLessThanOrEqual(262144);
    f.service.consent("bench-a", a.id, true);
    const reader = f.service.reader("bench-a");
    const result = JSON.parse(reader.publish(JSON.stringify(reader.read(a.id))));
    expect(result.text.length).toBeLessThanOrEqual(12000);
    expect(result.text).toContain("0123456789");
  });
  it("reports how many characters a full buffer dropped so a poll can append the new tail", async () => {
    const f = fixture(),
      a = await f.service.create("bench-a", 80, 24);
    f.masking(false);
    f.processes[0]?.print("first\n");
    expect(f.service.output("bench-a", a.id).start).toBe(0);
    f.processes[0]?.print("0123456789\n".repeat(30000));
    const full = f.service.output("bench-a", a.id);
    expect(full.start).toBeGreaterThan(0);
    expect(full.start + full.output.length).toBe(330006);
    f.processes[0]?.print("tail\n");
    const next = f.service.output("bench-a", a.id);
    expect(next.start).toBeGreaterThan(full.start);
    expect(next.output).toBe(`${full.output.slice(next.start - full.start)}tail\n`);
  });
  it("masks credentials split by terminal formatting before renderer disclosure", async () => {
    const f = fixture(),
      a = await f.service.create("bench-a", 80, 24);
    f.processes[0]?.print("private-\u001b[31mtoken-");
    expect(f.service.output("bench-a", a.id).output).not.toContain("private-");
    f.processes[0]?.print("123\u001b[0m\n");
    const output = f.service.output("bench-a", a.id).output;
    expect(output).not.toContain("private-");
    expect(output).toContain("[REDACTED]");
  });
  it("holds a credential prefix when a CSI escape itself is split across PTY callbacks", async () => {
    for (const [partial, completion] of [
      ["\u001b[", "31mtoken-123\u001b[0m\n"],
      ["\u001b[31", "mtoken-123\u001b[0m\n"],
      ["\u001b]0;title", "\u0007token-123\n"],
      ["\u001bPpayload", "\u001b\\token-123\n"],
    ]) {
      const f = fixture(),
        a = await f.service.create("bench-a", 80, 24);
      f.service.consent("bench-a", a.id, true);
      const reader = f.service.reader("bench-a");
      f.processes[0]?.print(`private-${partial}`);
      expect(f.service.output("bench-a", a.id).output).toBe("");
      expect(JSON.parse(reader.publish(JSON.stringify(reader.read(a.id)))).text).toBe("");
      f.processes[0]?.print(completion ?? "");
      expect(f.service.output("bench-a", a.id).output).toBe("[REDACTED]\n");
      expect(JSON.parse(reader.publish(JSON.stringify(reader.read(a.id)))).text).toBe("[REDACTED]\n");
    }
  });
  it("closes all processes and invalidates an in-flight shell resolution", async () => {
    const f = fixture();
    await f.service.create("bench-a", 80, 24);
    let resolve!: (value: { executable: string; kind: "bash" }) => void;
    f.shell.resolve.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = f.service.create("bench-a", 80, 24);
    await f.service.closeAll();
    resolve({ executable: "/bin/bash", kind: "bash" });
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.service.list("bench-a")).toEqual([]);
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
  it("blocks new shells and captured reads throughout an asynchronous workbench transition", async () => {
    const f = fixture(),
      a = await f.service.create("bench-a", 80, 24);
    f.service.consent("bench-a", a.id, true);
    const reader = f.service.reader("bench-a"),
      captured = JSON.stringify(reader.read(a.id));
    expect(f.service).toHaveProperty("suspend");
    f.service.suspend();
    await expect(f.service.create("bench-a", 80, 24)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(() => reader.publish(captured)).toThrow();
    await f.service.closeAll();
    await expect(f.service.create("bench-a", 80, 24)).rejects.toMatchObject({ code: "CONFLICT" });
    f.service.resume();
    expect(await f.service.create("bench-a", 80, 24)).toMatchObject({ shared: false });
  });
  // REQ-FUNC-7509bd1e
  it("refuses a terminal above the resolved count and keeps open ones when it is lowered", async () => {
    const f = fixture();
    f.limits.terminals = 2;
    await f.service.create("bench-a", 80, 24);
    await f.service.create("bench-a", 80, 24);
    await expect(f.service.create("bench-a", 80, 24)).rejects.toMatchObject({ code: "BUSY" });
    f.limits.terminals = 1;
    expect(f.service.list("bench-a")).toHaveLength(2);
    await expect(f.service.create("bench-a", 80, 24)).rejects.toMatchObject({ code: "BUSY" });
    f.limits.terminals = 12;
    await Promise.all(Array.from({ length: 7 }, () => f.service.create("bench-a", 80, 24)));
    expect(f.service.list("bench-a")).toHaveLength(9);
  });
  // REQ-FUNC-240f4e02
  it("keeps the buffer each terminal had when it opened, trimmed at a line", async () => {
    const f = fixture();
    f.masking(false);
    f.limits.bufferChars = 64 * 1024;
    const a = await f.service.create("bench-a", 80, 24);
    f.limits.bufferChars = 256 * 1024;
    const b = await f.service.create("bench-a", 80, 24);
    f.processes[0]?.print("0123456789\n".repeat(10000));
    f.processes[1]?.print("0123456789\n".repeat(10000));
    const small = f.service.output("bench-a", a.id);
    expect(small.output.length).toBeLessThanOrEqual(64 * 1024);
    expect(small.output.startsWith("0123456789\n")).toBe(true);
    expect(small.start + small.output.length).toBe(110000);
    expect(f.service.output("bench-a", b.id).output).toHaveLength(110000);
  });
  // REQ-FUNC-ef931b1f
  it("gives the agent the resolved output size within the given tool result size", async () => {
    const f = fixture();
    const a = await f.service.create("bench-a", 80, 24);
    f.service.consent("bench-a", a.id, true);
    f.processes[0]?.print("0123456789\n".repeat(5000));
    const reader = f.service.reader("bench-a");
    const read = () => JSON.parse(reader.publish(JSON.stringify(reader.read(a.id)), 64000)).text as string;
    expect(read()).toHaveLength(12000);
    f.limits.agentChars = 3000;
    expect(read()).toHaveLength(3000);
    f.limits.agentChars = 40000;
    expect(read()).toHaveLength(40000);
    expect(JSON.parse(reader.publish(JSON.stringify(reader.read(a.id)))).truncated).toBe(true);
  });
  it("refuses malformed dimensions/input and limits simultaneous terminals", async () => {
    const f = fixture();
    await expect(f.service.create("bench-a", 0, 24)).rejects.toThrow();
    const a = await f.service.create("bench-a", 80, 24);
    expect(() => f.service.resize("bench-a", a.id, Infinity, 1)).toThrow();
    expect(() => f.service.input("bench-a", a.id, "x".repeat(16385))).toThrow();
    await Promise.all(Array.from({ length: 7 }, () => f.service.create("bench-a", 80, 24)));
    await expect(f.service.create("bench-a", 80, 24)).rejects.toMatchObject({ code: "BUSY" });
  });
});

it("toggles local snapshots live while agent reads hold split secrets independently", async () => {
  const f = fixture();
  const terminal = await f.service.create("bench-a", 80, 24);
  f.masking(false);
  f.processes[0]?.print("prefix private-token-");
  expect(f.service.output("bench-a", terminal.id).output).toBe("prefix private-token-");
  f.service.consent("bench-a", terminal.id, true);
  const reader = f.service.reader("bench-a");
  expect(JSON.parse(reader.publish(JSON.stringify(reader.read(terminal.id)))).text).toBe("prefix ");
  f.processes[0]?.print("123\n");
  expect(f.service.output("bench-a", terminal.id).output).toContain("private-token-123");
  expect(JSON.parse(reader.publish(JSON.stringify(reader.read(terminal.id)))).text).toBe(
    "prefix [REDACTED]\n",
  );
  f.processes[0]?.finish();
  f.masking(true);
  expect(f.service.output("bench-a", terminal.id).output).toBe("prefix [REDACTED]\n");
  f.masking(false);
  expect(f.service.output("bench-a", terminal.id).output).toBe("prefix private-token-123\n");
  f.service.consent("bench-a", terminal.id, false);
  expect(() => reader.read(terminal.id)).toThrow();
  await f.service.closeAll();
});

it.each([true, false])(
  "keeps terminal agent disclosure independent of runs=%s and rechecks live policy",
  async (runs) => {
    const f = fixture();
    f.masking(runs);
    const terminal = await f.service.create("bench-a", 80, 24);
    f.service.consent("bench-a", terminal.id, true);
    f.processes[0]?.print("private-token-123\n");
    const reader = f.service.reader("bench-a");
    const capture = JSON.stringify(reader.read(terminal.id));
    expect(JSON.parse(reader.publish(capture)).text).toBe("[REDACTED]\n");
    f.agent(false);
    expect(JSON.parse(reader.publish(capture)).text).toBe("private-token-123\n");
    expect(f.service.output("bench-a", terminal.id).output).toBe(
      runs ? "[REDACTED]\n" : "private-token-123\n",
    );
    f.agent(true);
    expect(JSON.parse(reader.publish(capture)).text).toBe("[REDACTED]\n");
    f.service.consent("bench-a", terminal.id, false);
    expect(() => reader.publish(capture)).toThrow(/revoked/);
  },
);

it("masks complete terminal capture before bounding and uses clean VT projection when agent is off", async () => {
  const f = fixture(),
    terminal = await f.service.create("bench-a", 80, 24);
  f.service.consent("bench-a", terminal.id, true);
  f.processes[0]?.print(`${"x".repeat(12000)}private-token-123 end`);
  const reader = f.service.reader("bench-a");
  const capture = JSON.stringify(reader.read(terminal.id));
  const masked = JSON.parse(reader.publish(capture)).text;
  expect(masked).toContain("[REDACTED]");
  expect(masked).not.toContain("token-123");
  f.agent(false);
  f.processes[0]?.print("\x1b]0;pending");
  expect(JSON.parse(reader.publish(capture)).text).not.toContain("pending");
  f.processes[0]?.print("\x07private-token-\x1b[");
  expect(JSON.parse(reader.publish(capture)).text).toContain("private-token-");
  f.processes[0]?.print("31m123");
  expect(JSON.parse(reader.publish(capture)).text).toContain("private-token-123");
});
