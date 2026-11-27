import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { NodeProcessHost } from "../../src/libraries/core/src/plugins/node-process-host.js";
import { detectCommandShells } from "../../src/libraries/core/src/plugins/shell.js";
import { commandPlatformProbe } from "../support/command-platform-probe.js";
import { reportSkip } from "../support/skip-marker.js";

// The probe passes double quotes to node. Windows PowerShell 5.1 drops them from the arguments of native programs,
// so on Windows the probe runs only where PowerShell 7 is the default shell.
const noPwsh =
  process.platform === "win32" &&
  !(await detectCommandShells(new NodeProcessHost(spawn))).some(
    (shell) => shell.id === "pwsh" && shell.executable,
  );
reportSkip(
  noPwsh,
  "the command probe",
  "PowerShell 7 is not installed and Windows PowerShell 5.1 drops double quotes from native arguments (install PowerShell 7)",
);

it.skipIf(noPwsh)(
  "runs actual commands, closed stdin, clean environment and background process trees",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "vera-term01-"));
    try {
      const receipt = await commandPlatformProbe(root);
      expect(receipt.background).toMatchObject({ allDead: true, stopped: { stopped: true } });
      expect(receipt).not.toHaveProperty("background.stopped.error");
      expect(receipt).not.toHaveProperty("timeout.error");
      expect(receipt.timeout).toMatchObject({ running: false, timedOut: true });
      expect(receipt.lifecycle).toEqual({ sessionStop: true, appStop: true });
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
  60000,
);
