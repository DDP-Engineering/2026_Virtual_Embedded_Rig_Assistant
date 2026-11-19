import type { CommandBlockShell } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { TerminalService } from "./terminals.js";

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
    ready: () => {
      const [, args, options] = spawn.mock.calls[0]!;
      const startup = options.env.PS1 ?? Buffer.from(args.at(-1)!, "base64").toString("utf16le");
      const nonce = startup.match(/VERA;([a-f0-9-]+)/)![1];
      output(`\u001b]633;VERA;${nonce}\u0007`);
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
