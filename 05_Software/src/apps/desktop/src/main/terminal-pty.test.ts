import type { ProcessHost } from "@vera/core";
import { beforeEach, expect, it, vi } from "vitest";
import { stopTerminalProcesses } from "./terminal-processes.js";
import { createPtyFactory } from "./terminal-pty.js";

const native = vi.hoisted(() => {
  let exit = () => {};
  const pty = {
    pid: 100,
    kill: vi.fn(),
    onExit: (listener: () => void) => {
      exit = listener;
      return { dispose: vi.fn() };
    },
  };
  return { pty, finish: () => exit(), spawn: vi.fn(() => pty) };
});
vi.mock("node:module", () => ({ createRequire: () => () => native }));
vi.mock("./terminal-processes.js", () => ({ stopTerminalProcesses: vi.fn(async () => {}) }));
beforeEach(() => vi.clearAllMocks());

it("retires Linux session cleanup at shell exit so later close cannot signal a reused SID", async () => {
  const factory = createPtyFactory({ platform: "linux" } as ProcessHost);
  const pty = factory.spawn("bash", ["-il"], { cwd: "/bench", env: {}, cols: 80, rows: 24 });
  native.finish();
  await vi.waitFor(() => expect(stopTerminalProcesses).toHaveBeenCalledTimes(1));
  await factory.stop(pty);
  // The numeric PID/SID may now belong to a replacement session; this PTY must never rescan it.
  vi.mocked(stopTerminalProcesses).mockClear();
  await factory.stop(pty);
  expect(stopTerminalProcesses).not.toHaveBeenCalled();
  expect(native.pty.kill).not.toHaveBeenCalled();
});

it("shares one cleanup promise when explicit close and shell exit overlap", async () => {
  const factory = createPtyFactory({ platform: "linux" } as ProcessHost);
  const pty = factory.spawn("bash", ["-il"], { cwd: "/bench", env: {}, cols: 80, rows: 24 });
  const closing = factory.stop(pty);
  native.finish();
  await closing;
  await factory.stop(pty);
  expect(stopTerminalProcesses).toHaveBeenCalledTimes(1);
});

it("closes the Windows native console handle after stopping its running shell tree", async () => {
  const factory = createPtyFactory({ platform: "win32" } as ProcessHost);
  const pty = factory.spawn("powershell", [], { cwd: "C:/bench", env: {}, cols: 80, rows: 24 });
  await factory.stop(pty);
  expect(stopTerminalProcesses).toHaveBeenCalledWith(expect.anything(), 100, expect.anything(), true);
  expect(native.pty.kill).toHaveBeenCalledTimes(1);
});
