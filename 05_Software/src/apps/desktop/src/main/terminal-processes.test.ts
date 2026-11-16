import { readdir, readFile } from "node:fs/promises";
import type { Clock, ProcessHost } from "@vera/core";
import { expect, it, vi } from "vitest";
import { stopTerminalProcesses } from "./terminal-processes.js";

vi.mock("node:fs/promises", () => ({ readdir: vi.fn(), readFile: vi.fn() }));

it("stops all Linux job-control groups in the PTY session and rescans before escalation", async () => {
  let scan = 0;
  vi.mocked(readdir).mockImplementation(async () => {
    scan++;
    return ["100", "200", "300", "400", "500", "self"] as never;
  });
  vi.mocked(readFile).mockImplementation(async (path) => {
    const pid = Number(String(path).split("/")[2]);
    if (pid === 500 || (pid === 300 && scan === 1)) throw Object.assign(Error("gone"), { code: "ENOENT" });
    return `${pid} (name with ) spaces) S 1 ${pid} ${pid === 400 ? 999 : 100} 0`;
  });
  const signal = vi.fn(() => true);
  const host = { platform: "linux", signal } as unknown as ProcessHost;
  const sleep = vi.fn(async () => {});
  await stopTerminalProcesses(host, 100, { sleep } as unknown as Clock);
  expect(signal.mock.calls).toEqual([
    [-100, "SIGTERM"],
    [-200, "SIGTERM"],
    [-200, "SIGKILL"],
    [-300, "SIGKILL"],
    [-100, "SIGKILL"],
  ]);
  expect(readdir).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledWith(100);
});

it("surfaces an unreadable Linux process inventory instead of claiming cleanup", async () => {
  vi.mocked(readdir).mockRejectedValueOnce(Object.assign(Error("proc unavailable"), { code: "EIO" }));
  const signal = vi.fn();
  await expect(
    stopTerminalProcesses({ platform: "linux", signal } as unknown as ProcessHost, 100, {} as Clock),
  ).rejects.toThrow("proc unavailable");
  expect(signal).not.toHaveBeenCalled();
});

it("never signals an exited Windows shell PID that could have been reused", async () => {
  const signal = vi.fn(),
    spawn = vi.fn();
  await stopTerminalProcesses(
    { platform: "win32", signal, spawn } as unknown as ProcessHost,
    100,
    {} as Clock,
    false,
  );
  expect(signal).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});
