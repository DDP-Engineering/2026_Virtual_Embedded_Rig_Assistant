import { win32 } from "node:path";
import type { Clock, ProcessHost } from "../ports.js";

/** Value of an environment variable, case-insensitively on Windows. */
export function hostVariable(host: ProcessHost, name: string): string | undefined {
  if (host.platform !== "win32") return host.env[name];
  const key = Object.keys(host.env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : host.env[key];
}

const WINDOWS_KILL_MS = 20_000;

/**
 * Kills a program and every process it started (plugins architecture §3.2). Windows: System32 `taskkill /T /F /PID`, followed by reaping children
 * created during its enumeration, waiting at most 20 s for it. Elsewhere the program leads its own process group: SIGTERM to the group, then
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
    const script = windowsTreeKill(pid, systemRoot);
    const helper = host.spawn(
      win32.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      {
        cwd: systemRoot,
        env: { SystemRoot: systemRoot, PATHEXT: ".EXE" },
        group: false,
        output: () => {},
      },
    );
    // A PowerShell that hangs must not keep the caller (a run waiting to finish) waiting forever.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, WINDOWS_KILL_MS);
    });
    await Promise.race([helper.exit, timeout]).finally(() => clearTimeout(timer));
    return;
  }
  if (!host.signal(-pid, "SIGTERM")) return;
  await clock.sleep(graceMs);
  host.signal(-pid, "SIGKILL");
}

// taskkill snapshots the tree before terminating it: a starting shell can create a child after that snapshot.
function windowsTreeKill(pid: number, systemRoot: string): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error("Invalid process id.");
  const taskkill = win32.join(systemRoot, "System32/taskkill.exe").replaceAll("'", "''");
  return `
$ErrorActionPreference = 'Stop'
$targetPid = ${pid}
$rootProcess = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
if (!$rootProcess) { exit 0 }
$born = $rootProcess.StartTime
try {
$snapshot = @(Get-CimInstance Win32_Process)
$parents = @{}
$parents[$targetPid] = $born
# Retain identities of descendants which taskkill might remove before their late children are visible.
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($entry in $snapshot) {
    $parentId = [int]$entry.ParentProcessId
    $id = [int]$entry.ProcessId
    if ($parents.ContainsKey($parentId) -and !$parents.ContainsKey($id) -and $entry.CreationDate -ge $parents[$parentId]) {
      $parents[$id] = $entry.CreationDate
      $changed = $true
    }
  }
}
if (!$rootProcess.HasExited) { & '${taskkill}' /T /F /PID $targetPid | Out-Null }
$cutoffs = @{}
$ended = Get-Date
foreach ($id in $parents.Keys) { $cutoffs[$id] = $ended }
while ($parents.Count) {
  $next = @{}
  $nextCutoffs = @{}
  foreach ($entry in @(Get-CimInstance Win32_Process)) {
    $parentId = [int]$entry.ParentProcessId
    if (!$parents.ContainsKey($parentId) -or $entry.CreationDate -lt $parents[$parentId] -or $entry.CreationDate -gt $cutoffs[$parentId]) { continue }
    $id = [int]$entry.ProcessId
    $child = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($child) {
      try {
        # CIM timestamps have microsecond precision; compare before killing through the acquired process handle.
        if ([Math]::Abs(($child.StartTime - $entry.CreationDate).Ticks) -ge 10) { continue }
        $child.Kill()
        if (!$child.WaitForExit(5000)) { throw 'Process tree termination timed out.' }
      } finally { $child.Dispose() }
    }
    $next[$id] = $entry.CreationDate
    $nextCutoffs[$id] = Get-Date
  }
  $parents = $next
  $cutoffs = $nextCutoffs
}
} catch {
  # Preserve best-effort tree termination when CIM is unavailable, only while the original process is alive.
  if (!$rootProcess.HasExited) { & '${taskkill}' /T /F /PID $targetPid | Out-Null }
  exit 1
} finally { $rootProcess.Dispose() }
`;
}
