import type { CommandBlockShell } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalService } from "./terminals.js";

afterEach(() => vi.useRealTimers());

function fixture(kind: CommandBlockShell = "bash") {
  let owner = "bench-a";
  let output = (_text: string) => {};
  let exited = (_event: { exitCode: number }) => {};
  const pty = {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    onData: (callback: typeof output) => {
      output = callback;
      return { dispose() {} };
    },
    onExit: (callback: typeof exited) => {
      exited = callback;
      return { dispose() {} };
    },
  };
  const spawn = vi.fn(
    (_executable: string, _args: string[], _options: { env: Record<string, string> }) => pty,
  );
  const service = new TerminalService({
    current: () => ({ id: owner, folder: "/workbench" }),
    shell: { resolve: async () => ({ executable: kind, kind }), environment: () => ({ PATH: "/bin" }) },
    pty: { spawn, stop: async () => {} },
    scrub: (text) => text,
    secrets: () => [],
    maskUserOutput: () => false,
  });
  return {
    service,
    pty,
    finish: () => exited({ exitCode: 0 }),
    ready: (constrained = false) => {
      const [, args, options] = spawn.mock.calls[0]!;
      const startup = options.env.PS1 ?? Buffer.from(args.at(-1)!, "base64").toString("utf16le");
      const nonce = startup.match(/VERA;([a-f0-9-]+)/)![1];
      output(`\u001b]633;VERA;${nonce}${constrained ? ";constrained" : ""}\u0007`);
    },
    switch: () => {
      owner = "bench-b";
    },
  };
}

it.each(["powershell", "bash"] as const)(
  "dispatches the entire %s block once at its proven initial prompt without editing shortcuts",
  async (kind) => {
    const f = fixture(kind);
    const terminal = await f.service.create("bench-a", 80, 24, kind);
    expect(terminal.shell).toBe(kind);
    expect(terminal.dispatchEligible).toBe(true);
    const text = "Get-Content README.MD -TotalCount 10\r\n'Știință 🧪'\n\n\\tail\tend";
    const execution = f.service.execute("bench-a", terminal.id, kind, text);
    expect(f.pty.write).not.toHaveBeenCalled();
    f.ready();
    await execution;
    expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(false);
    expect(f.pty.write).toHaveBeenCalledTimes(1);
    const data = f.pty.write.mock.calls[0]![0] as string;
    expect(data).not.toContain("\u0015");
    expect(data.endsWith("\r")).toBe(true);
    expect(data.slice(0, -1)).not.toMatch(/[\r\n]/);
    if (kind === "powershell") {
      expect(data).toContain(". ([scriptblock]::Create(");
      const encoded = data.match(/FromBase64String\('([^']+)'\)/)![1]!;
      expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(text);
    } else expect(data).toContain("\\r\\n\\'Știință 🧪\\'\\n\\n\\\\tail\\tend");
    await f.service.closeAll();
  },
);

it("dispatches a Constrained Language PowerShell block once as its exact UTF-16 code units", async () => {
  const f = fixture("powershell");
  const terminal = await f.service.create("bench-a", 80, 24, "powershell");
  const text = "Get-Content README.MD -TotalCount 10\r\n'Știință 🧪' \"quoted\" `tick $HOME\n\n\\tail\tend";
  const execution = f.service.execute("bench-a", terminal.id, "powershell", text);
  f.ready(true);
  await execution;
  expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(false);
  expect(f.pty.write).toHaveBeenCalledTimes(1);
  const data = f.pty.write.mock.calls[0]![0] as string;
  // One ASCII line that needs no .NET call: Constrained Language refuses [Convert] and [Text.Encoding].
  expect(data).toMatch(/^[\x20-\x7e]+\r$/);
  const codes = data.match(/^Invoke-Expression \(-join \[char\[\]\]\(([0-9,]+)\)\)\r$/)![1]!;
  expect(String.fromCharCode(...codes.split(",").map(Number))).toBe(text);
  await f.service.closeAll();
});

it("refuses ordinary terminals without touching their input", async () => {
  const f = fixture();
  const terminal = await f.service.create("bench-a", 80, 24);
  expect(terminal.dispatchEligible).toBe(false);
  expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(false);
  await expect(f.service.execute("bench-a", terminal.id, "bash", "pwd")).rejects.toMatchObject({
    messageKey: "chatActions.promptNotReady",
  });
  expect(f.pty.write).not.toHaveBeenCalled();
  await f.service.closeAll();
});

it.each(["echo pending", "read answer\r"])(
  "preserves user input or a foreground reader (%s)",
  async (input) => {
    const f = fixture();
    const terminal = await f.service.create("bench-a", 80, 24, "bash");
    f.ready();
    f.service.input("bench-a", terminal.id, input);
    expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(false);
    await expect(f.service.execute("bench-a", terminal.id, "bash", "pwd")).rejects.toMatchObject({
      messageKey: "chatActions.promptNotReady",
    });
    expect(f.pty.write.mock.calls).toEqual([[input]]);
    await f.service.closeAll();
  },
);

it.each(["switch", "input", "close", "suspend"] as const)(
  "rechecks authority and readiness when %s interrupts shell startup",
  async (action) => {
    const f = fixture();
    const terminal = await f.service.create("bench-a", 80, 24, "bash");
    const pending = f.service.execute("bench-a", terminal.id, "bash", "pwd");
    const rejected = expect(pending).rejects.toBeDefined();
    if (action === "switch") f.switch();
    else if (action === "suspend") {
      f.service.suspend();
      f.service.resume();
    } else if (action === "input") f.service.input("bench-a", terminal.id, "untouched");
    else await f.service.close("bench-a", terminal.id);
    f.ready();
    await rejected;
    expect(f.pty.write.mock.calls).toEqual(action === "input" ? [["untouched"]] : []);
    await f.service.closeAll();
  },
);

it("reports pristine startup/prompt eligibility and revokes it after shell exit", async () => {
  const f = fixture();
  const terminal = await f.service.create("bench-a", 80, 24, "bash");
  expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(true);
  f.ready();
  expect(f.service.output("bench-a", terminal.id).dispatchEligible).toBe(true);
  f.finish();
  expect(f.service.list("bench-a")[0]).toMatchObject({ running: false, dispatchEligible: false });
  await expect(f.service.execute("bench-a", terminal.id, "bash", "pwd")).rejects.toBeDefined();
  expect(f.pty.write).not.toHaveBeenCalled();
  await f.service.closeAll();
});

it.each(["powershell", "bash"] as const)(
  "excludes a timed-out %s destination until its pristine prompt arrives",
  async (kind) => {
    vi.useFakeTimers();
    const f = fixture(kind);
    const terminal = await f.service.create("bench-a", 80, 24, kind);
    const pending = expect(f.service.execute("bench-a", terminal.id, kind, "pwd")).rejects.toMatchObject({
      messageKey: "chatActions.promptNotReady",
    });
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(false);
    expect(f.service.output("bench-a", terminal.id).dispatchEligible).toBe(false);
    await expect(f.service.execute("bench-a", terminal.id, kind, "pwd")).rejects.toMatchObject({
      messageKey: "chatActions.promptNotReady",
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(f.pty.write).not.toHaveBeenCalled();
    f.ready();
    expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(true);
    await f.service.execute("bench-a", terminal.id, kind, "pwd");
    expect(f.pty.write).toHaveBeenCalledTimes(1);
    expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(false);
    await f.service.closeAll();
  },
);

it.each(["input", "exit"] as const)(
  "does not restore a timed-out destination after %s when its prompt arrives late",
  async (action) => {
    vi.useFakeTimers();
    const f = fixture();
    const terminal = await f.service.create("bench-a", 80, 24, "bash");
    const pending = expect(f.service.execute("bench-a", terminal.id, "bash", "pwd")).rejects.toMatchObject({
      messageKey: "chatActions.promptNotReady",
    });
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    if (action === "input") f.service.input("bench-a", terminal.id, "preserved input");
    else f.finish();
    f.ready();
    expect(f.service.list("bench-a")[0]?.dispatchEligible).toBe(false);
    await expect(f.service.execute("bench-a", terminal.id, "bash", "pwd")).rejects.toBeDefined();
    expect(f.pty.write.mock.calls).toEqual(action === "input" ? [["preserved input"]] : []);
    expect(vi.getTimerCount()).toBe(0);
    await f.service.closeAll();
  },
);

it("atomically consumes the initial prompt so concurrent or repeated dispatch cannot reuse it", async () => {
  const f = fixture();
  const terminal = await f.service.create("bench-a", 80, 24, "bash");
  const first = f.service.execute("bench-a", terminal.id, "bash", "pwd");
  const second = f.service.execute("bench-a", terminal.id, "bash", "pwd");
  f.ready();
  expect((await Promise.allSettled([first, second])).map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  f.ready();
  await expect(f.service.execute("bench-a", terminal.id, "bash", "pwd")).rejects.toBeDefined();
  expect(f.pty.write).toHaveBeenCalledTimes(1);
  await f.service.closeAll();
});
