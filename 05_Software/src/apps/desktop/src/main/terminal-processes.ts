import { readdir, readFile } from "node:fs/promises";
import { type Clock, killProcessTree, type ProcessHost } from "@vera/core";

async function sessionGroups(session: number): Promise<number[]> {
  const groups = new Set<number>();
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await readFile(`/proc/${name}/stat`, "utf8");
      // comm can contain spaces and parentheses; fields after its final ')' start at state.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
      const group = Number(fields[2]);
      if (Number(fields[3]) === session && group > 0) groups.add(group);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
    }
  }
  return [...groups];
}

/** Interactive Linux jobs have distinct process groups within node-pty's dedicated session. */
export async function stopTerminalProcesses(
  host: ProcessHost,
  pid: number,
  clock: Pick<Clock, "sleep">,
  running = true,
): Promise<void> {
  if (host.platform !== "linux") {
    if (running) await killProcessTree(host, pid, clock, 100);
    return;
  }
  for (const group of await sessionGroups(pid)) host.signal(-group, "SIGTERM");
  await clock.sleep(100);
  // Rescan for jobs started during the grace period; kill the shell last so it can reap jobs first.
  for (const group of (await sessionGroups(pid)).sort((a, b) => Number(a === pid) - Number(b === pid)))
    host.signal(-group, "SIGKILL");
}
