import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommandTool } from "../../src/libraries/core/src/plugins/command-tools.js";
import { NodeProcessHost } from "../../src/libraries/core/src/plugins/node-process-host.js";
import { ProgramSession } from "../../src/libraries/core/src/plugins/program-tools.js";
import { ProgramRunner } from "../../src/libraries/core/src/plugins/runner.js";
import { createCommandShellHost } from "../../src/libraries/core/src/plugins/shell.js";
import { createToolContext, type ToolContext } from "../../src/libraries/core/src/tools/context.js";
import { grepTool } from "../../src/libraries/core/src/tools/grep.js";
import { readTool } from "../../src/libraries/core/src/tools/read.js";
import { NodeWorkerPool } from "../../src/libraries/core/src/workers/node-host.js";

/** Real file and shell access under live folder grants; no native database dependency. */
export async function additionalFolderPlatformProbe(workerUrl?: URL) {
  const base = await mkdtemp(join(tmpdir(), "vera-term03-platform-"));
  const root = join(base, "bench");
  const sibling = join(base, "sibling");
  const data = join(base, "data");
  await Promise.all([root, sibling, data].map((path) => mkdir(path)));
  await mkdir(join(root, ".vera"));
  await writeFile(join(sibling, "notes.txt"), "sibling");
  await writeFile(join(data, "private.txt"), "protected");
  await symlink(data, join(sibling, "alias"), process.platform === "win32" ? "junction" : "dir");
  const native = new NodeProcessHost(spawn);
  const runner = new ProgramRunner({
    host: native,
    clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
    killGraceMs: 50,
  });
  let folders = [sibling];
  const signal = new AbortController().signal;
  const ctx: ToolContext = {
    ...createToolContext(root),
    permissionMode: () => "ask",
    additionalFolders: () => folders,
    managedRoots: [data],
    programs: {
      sessionId: "ses_probe",
      turnId: "turn_probe",
      callId: "call_probe",
      session: new ProgramSession(),
      consume: () => {},
      host: {
        runner,
        clock: { sleep: async () => {} },
        plugins: async () => [],
        resolver: { resolve: async () => undefined },
        shell: createCommandShellHost(
          native,
          () => "",
          (value) => value,
        ),
      },
    },
  };
  const prepare = (cwd: string) =>
    runCommandTool.prepare?.(
      ctx,
      {
        command: process.platform === "win32" ? "Write-Output sibling-command" : "printf sibling-command",
        cwd,
      },
      signal,
    );
  let workers: NodeWorkerPool | undefined;
  let workerBindings = false;
  try {
    const read = await readTool.execute(ctx, { path: join(sibling, "notes.txt") }, signal);
    assert.equal(read.text, "1: sibling");
    assert.equal(read.ref, undefined);
    assert.equal(read.path, join(sibling, "notes.txt").replaceAll("\\", "/"));
    const call = await prepare(sibling);
    assert(call);
    const result = await call.apply(signal);
    assert.equal(result.exitCode, 0);
    assert.match(String(result.output), /sibling-command/);
    assert.equal((await stat(join(root, String(result.log)))).isFile(), true);
    await assert.rejects(() => readTool.execute(ctx, { path: join(base, "unlisted.txt") }, signal));
    await assert.rejects(async () => prepare(base));
    for (const path of [join(sibling, "alias/private.txt"), join(sibling, "alias/missing/new.txt")])
      await assert.rejects(() => readTool.execute(ctx, { path }, signal), /application data/);
    if (workerUrl) {
      workers = new NodeWorkerPool(workerUrl, { deadlineMs: 5000, capacity: 1 });
      const pool = workers;
      ctx.workers = pool;
      const grep = await grepTool.execute(ctx, { path: sibling, pattern: "sibling" }, signal);
      assert.equal((grep.matches as unknown[]).length, 1);
      const unlisted = join(base, "unlisted");
      await mkdir(unlisted);
      await writeFile(join(unlisted, "notes.txt"), "private unlisted");
      ctx.workers = {
        run: async (task, lifetime) => {
          await rename(sibling, join(base, "original-sibling"));
          await symlink(unlisted, sibling, process.platform === "win32" ? "junction" : "dir");
          return pool.run(task, lifetime);
        },
        dispose: async () => {},
      };
      await assert.rejects(() => grepTool.execute(ctx, { path: sibling, pattern: "private" }, signal));
      await rename(sibling, join(base, "retargeted-link"));
      await rename(join(base, "original-sibling"), sibling);
      workerBindings = true;
    }
    const pending = await prepare(sibling);
    assert(pending);
    folders = [];
    await assert.rejects(() => pending.apply(signal));
    await assert.rejects(() => readTool.execute(ctx, { path: join(sibling, "notes.txt") }, signal));
    assert.equal(await readFile(join(data, "private.txt"), "utf8"), "protected");
    return {
      platform: process.platform,
      node: process.version,
      executable: process.execPath,
      read,
      result,
      unlistedRefused: true,
      protectedAliasesRefused: true,
      removedPendingRefused: true,
      workbenchLog: true,
      workerBindings,
    };
  } finally {
    await workers?.dispose();
    await runner.stopAll();
    await rm(base, { recursive: true, force: true });
  }
}
if (process.argv.includes("--probe")) {
  const worker = process.argv.find((arg) => arg.startsWith("--worker="))?.slice("--worker=".length);
  process.stdout.write(
    `${JSON.stringify(await additionalFolderPlatformProbe(worker ? new URL(worker) : undefined), null, 2)}\n`,
  );
}
