import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { NodeProcessHost } from "./node-process-host.js";
import { commandEnvironment, detectCommandShells, resolveCommandShell, shellArguments } from "./shell.js";

const host = new NodeProcessHost(spawn);
const installed = await detectCommandShells(host);
for (const option of installed) {
  it.skipIf(!option.executable)(
    `executes quoted commands and preserves exit status in ${option.id}`,
    async () => {
      if (!option.executable) throw Error("Missing installed shell");
      const shell = await resolveCommandShell(host, option.executable);
      // Cmd built-ins emit the Windows code page; other adapters emit UTF-8.
      const marker = shell.kind === "cmd" ? "quote & command" : "quote & Unicode: caf\u00e9";
      const command =
        shell.kind === "powershell"
          ? `Write-Output '${marker}'`
          : shell.kind === "cmd"
            ? `echo "${marker}"`
            : `printf '%s\\n' '${marker}'`;
      const run = async (command: string) => {
        const chunks: Buffer[] = [];
        const child = host.spawn(shell.executable, shellArguments(shell, command), {
          cwd: process.cwd(),
          env: commandEnvironment(host.env, (value) => value),
          group: false,
          ...(shell.kind === "cmd" ? { windowsVerbatimArguments: true } : {}),
          output: (_stream, data) => chunks.push(Buffer.from(data)),
        });
        const deadline = setTimeout(() => {
          if (child.pid) host.signal(child.pid, "SIGKILL");
        }, 10000);
        try {
          return { exit: await child.exit, text: Buffer.concat(chunks).toString("utf8") };
        } finally {
          clearTimeout(deadline);
        }
      };
      const result = await run(command);
      expect(result.exit.code).toBe(0);
      expect(result.text).toContain(marker);
      const failure = await run(shell.kind === "cmd" ? "exit /b 7" : "exit 7");
      expect(failure.exit.code).toBe(7);
    },
    20000,
  );
}
