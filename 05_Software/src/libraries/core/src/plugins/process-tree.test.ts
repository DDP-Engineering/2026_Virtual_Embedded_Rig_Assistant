import { describe, expect, it } from "vitest";
import type { ProcessHost, ProcessSpawnOptions } from "../ports.js";
import { killProcessTree } from "./process-tree.js";

function fakeHost(platform: string, env: Record<string, string> = {}) {
  const spawns: { executable: string; args: readonly string[]; options: ProcessSpawnOptions }[] = [];
  const signals: [number, string][] = [];
  const host: ProcessHost = {
    platform,
    env,
    spawn(executable, args, options) {
      spawns.push({ executable, args, options });
      return { pid: 99, exit: Promise.resolve({ code: 0, signal: null }) };
    },
    signal(pid, signal) {
      signals.push([pid, signal]);
      return true;
    },
  };
  return { host, spawns, signals };
}

function manualClock() {
  const waits: { ms: number; release: () => void }[] = [];
  return {
    waits,
    sleep: (ms: number) => new Promise<void>((release) => waits.push({ ms, release })),
  };
}

describe("killProcessTree", () => {
  it("runs taskkill /T /F /PID from System32 of SystemRoot on Windows", async () => {
    const { host, spawns, signals } = fakeHost("win32", { SYSTEMROOT: "D:\\Win" });
    await killProcessTree(host, 4242, manualClock());
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.executable).toBe("D:\\Win\\System32\\taskkill.exe");
    expect(spawns[0]?.args).toEqual(["/T", "/F", "/PID", "4242"]);
    expect(spawns[0]?.options.group).toBe(false);
    expect(signals).toEqual([]);
  });

  it("sends SIGTERM to the Linux process group, then SIGKILL after the 3 s grace", async () => {
    const { host, spawns, signals } = fakeHost("linux");
    const clock = manualClock();
    const killing = killProcessTree(host, 4242, clock);
    await Promise.resolve();
    expect(signals).toEqual([[-4242, "SIGTERM"]]);
    expect(clock.waits.map((wait) => wait.ms)).toEqual([3000]);
    clock.waits[0]?.release();
    await killing;
    expect(signals).toEqual([
      [-4242, "SIGTERM"],
      [-4242, "SIGKILL"],
    ]);
    expect(spawns).toEqual([]);
  });

  it("skips the grace when the Linux group no longer exists", async () => {
    const { host, signals } = fakeHost("linux");
    host.signal = (pid, signal) => {
      signals.push([pid, signal]);
      return false;
    };
    const clock = manualClock();
    await killProcessTree(host, 7, clock);
    expect(signals).toEqual([[-7, "SIGTERM"]]);
    expect(clock.waits).toEqual([]);
  });
});
