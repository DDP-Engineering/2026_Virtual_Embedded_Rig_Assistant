import { win32 } from "node:path";
import type { Clock, ProcessHost } from "../ports.js";

/** Value of an environment variable, case-insensitively on Windows. */
export function hostVariable(host: ProcessHost, name: string): string | undefined {
  if (host.platform !== "win32") return host.env[name];
  const key = Object.keys(host.env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : host.env[key];
}

/**
 * Kills a program and every process it started (plugins architecture §3.2). Windows: `taskkill /T /F
 * /PID` from System32. Elsewhere the program leads its own process group: SIGTERM to the group, then
 * SIGKILL after `graceMs`, unless the group is already gone.
 */
export async function killProcessTree(
  host: ProcessHost,
  pid: number,
  clock: Pick<Clock, "sleep">,
  graceMs = 3000,
): Promise<void> {
  if (host.platform === "win32") {
    const systemRoot = hostVariable(host, "SystemRoot") ?? "C:\\Windows";
    await host.spawn(win32.join(systemRoot, "System32", "taskkill.exe"), ["/T", "/F", "/PID", String(pid)], {
      cwd: systemRoot,
      env: { SystemRoot: systemRoot },
      group: false,
      output: () => {},
    }).exit;
    return;
  }
  if (!host.signal(-pid, "SIGTERM")) return;
  await clock.sleep(graceMs);
  host.signal(-pid, "SIGKILL");
}
