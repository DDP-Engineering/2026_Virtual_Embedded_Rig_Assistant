import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommandTool } from "../../src/libraries/core/src/plugins/command-tools.js";
import { NodeProcessHost } from "../../src/libraries/core/src/plugins/node-process-host.js";
import {
  ProgramSession,
  programOutputTool,
  programStopTool,
} from "../../src/libraries/core/src/plugins/program-tools.js";
import { ProgramRunner } from "../../src/libraries/core/src/plugins/runner.js";
import { createCommandShellHost } from "../../src/libraries/core/src/plugins/shell.js";
import type { ProcessHost } from "../../src/libraries/core/src/ports.js";
import type { ToolContext } from "../../src/libraries/core/src/tools/context.js";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const quote = (value: string) =>
  process.platform === "win32" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\"'\"'")}'`;
const nodeCommand = (source: string) =>
  `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} -e ${quote(source)}`;

/** Execute the TERM-01 acceptance against actual shell processes; scratch stays inside the supplied root. */
export async function commandPlatformProbe(root: string) {
  await mkdir(root, { recursive: true });
  await mkdir(join(root, ".vera"), { recursive: true });
  const native = new NodeProcessHost(spawn);
  const secret = "term01-fixture-stored-secret";
  const host: ProcessHost = {
    platform: native.platform,
    env: {
      ...native.env,
      VERA_PROVIDER_KEY: secret,
      OPENAI_API_KEY: secret,
      ALIAS_WITH_PRIVATE_VALUE: `x${secret}x`,
      TERM01_USER_FLAG: "inherited",
    },
    spawn: native.spawn.bind(native),
    signal: native.signal.bind(native),
  };
  const runner = new ProgramRunner({ host, clock: { sleep }, killGraceMs: 50 });
  let configured = "";
  const shell = createCommandShellHost(
    host,
    () => configured,
    (value) => value.replaceAll(secret, "[redacted]"),
  );
  const epoch = new AbortController();
  const ctx: ToolContext = {
    root,
    lastReads: new Map(),
    permissionMode: () => "bypass",
    bypassSignal: () => epoch.signal,
    programs: {
      sessionId: "ses_probe",
      turnId: "turn_probe",
      callId: "call_probe",
      session: new ProgramSession(),
      consume: () => {},
      host: {
        runner,
        shell,
        clock: { sleep },
        plugins: async () => [],
        resolver: { resolve: async () => undefined },
      },
    },
  };
  const controller = new AbortController();
  const signal = controller.signal;
  const run = async (command: string, extra: Record<string, unknown> = {}) => {
    const call = await runCommandTool.prepare?.(ctx, { command, ...extra }, signal);
    assert(call);
    return call.apply(signal);
  };
  const receipt: Record<string, unknown> = {
    platform: process.platform,
    node: process.version,
    executable: process.execPath,
    shell: await shell.resolve(),
  };
  const pids: number[] = [];
  try {
    const one = await run(nodeCommand("console.log(1)"));
    assert.equal(one.exitCode, 0);
    assert.equal(String(one.output).trim(), "1");
    receipt.foreground = one;
    const expectedUnicode = 'héllo Ω și $HOME; ` & \' "quoted"';
    const unicode = await run(nodeCommand(`console.log(${JSON.stringify(expectedUnicode)})`));
    assert.equal(unicode.exitCode, 0);
    assert.equal(String(unicode.output).trim(), expectedUnicode);
    receipt.utf8 = unicode;
    const exit = await run(nodeCommand("process.exit(7)"));
    assert.equal(exit.exitCode, 7);
    receipt.nonzero = exit;
    const recovery = await run(
      `${nodeCommand("process.exit(7)")}; ${process.platform === "win32" ? "Write-Output recovered" : "printf recovered"}`,
    );
    assert.equal(recovery.exitCode, 0);
    assert.match(String(recovery.output), /recovered/);
    receipt.recovery = recovery;
    const eof = await run(
      nodeCommand(
        "let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{console.log('EOF:'+input);process.exit(2)}); process.stdin.resume()",
      ),
      { timeout: 5 },
    );
    assert.equal(eof.exitCode, 2);
    assert.notEqual(eof.timedOut, true);
    assert.match(String(eof.output), /EOF:/);
    receipt.stdinEof = eof;
    const clean = await run(
      nodeCommand(
        "console.log(JSON.stringify({flag:process.env.TERM01_USER_FLAG,keys:Object.keys(process.env).filter(k=>/VERA_|OPENAI_API_KEY|ALIAS_WITH_PRIVATE_VALUE/i.test(k)),leaked:Object.values(process.env).some(v=>v.includes('term01-fixture-stored-secret'))}))",
      ),
    );
    assert.equal(clean.exitCode, 0);
    assert.deepEqual(JSON.parse(String(clean.output).trim()), { flag: "inherited", keys: [], leaked: false });
    receipt.environment = clean;
    const tail = await run(nodeCommand("process.stdout.write('x'.repeat(14000))"));
    assert.equal(String(tail.output).length, 12000);
    assert.equal((await readFile(join(root, String(tail.log)), "utf8")).length, 14000);
    receipt.tail = { ...tail, output: "[12000 characters checked]" };
    const childSource = "setInterval(()=>{},1000)";
    const server =
      "const {spawn}=require('node:child_process'); const http=require('node:http'); const child=spawn(process.execPath,['-e'," +
      JSON.stringify(childSource) +
      "],{stdio:'ignore'}); http.createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log('READY '+process.pid+' '+child.pid+' '+this.address().port)});setInterval(()=>{},1000)";
    const background = await run(nodeCommand(server), { background: true });
    controller.abort();
    const ready = await programOutputTool.execute(
      ctx,
      { handle: background.handle, waitMs: 10000, until: "READY \\d+ \\d+ \\d+" },
      new AbortController().signal,
    );
    assert.equal(ready.matched, true);
    assert.equal(ready.running, true);
    const match = /READY (\d+) (\d+) (\d+)/.exec(String(ready.output));
    assert(match);
    pids.push(Number(match[1]), Number(match[2]));
    assert(pids.every(alive));
    const stopped = await programStopTool.execute(
      ctx,
      { handle: background.handle },
      new AbortController().signal,
    );
    for (let i = 0; i < 60 && pids.some(alive); i++) await sleep(50);
    assert(
      pids.every((pid) => !alive(pid)),
      `Process tree still alive: ${pids}`,
    );
    receipt.background = { ...background, readiness: ready, stopped, pids, allDead: true };
    const nextSignal = new AbortController().signal;
    const startAgain = async (extra: Record<string, unknown> = {}) => {
      const call = await runCommandTool.prepare?.(
        ctx,
        { command: nodeCommand("setInterval(()=>{},1000)"), background: true, ...extra },
        nextSignal,
      );
      assert(call);
      return call.apply(nextSignal);
    };
    const timed = await startAgain({ timeout: 1 });
    const timeout = await programOutputTool.execute(ctx, { handle: timed.handle, waitMs: 15000 }, nextSignal);
    assert.equal(timeout.running, false);
    receipt.timeout = timeout;
    const session = await startAgain();
    await runner.stopSession("ses_probe");
    assert.equal(
      (await programOutputTool.execute(ctx, { handle: session.handle }, nextSignal)).running,
      false,
    );
    const app = await startAgain();
    await runner.stopAll();
    assert.equal((await programOutputTool.execute(ctx, { handle: app.handle }, nextSignal)).running, false);
    receipt.lifecycle = { sessionStop: true, appStop: true };
    if (process.platform === "win32") {
      configured = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      const call = await runCommandTool.prepare?.(
        ctx,
        { command: nodeCommand("console.log('fallback Ω');process.exit(7)") },
        nextSignal,
      );
      assert(call);
      const fallback = await call.apply(nextSignal);
      assert.equal(fallback.exitCode, 7);
      assert.match(String(fallback.output), /fallback Ω/);
      receipt.windowsPowerShell = fallback;
      const recoveredCall = await runCommandTool.prepare?.(
        ctx,
        { command: `${nodeCommand("process.exit(7)")}; Write-Output recovered` },
        nextSignal,
      );
      assert(recoveredCall);
      const recovered = await recoveredCall.apply(nextSignal);
      assert.equal(recovered.exitCode, 0);
      assert.match(String(recovered.output), /recovered/);
      receipt.windowsPowerShellRecovery = recovered;
      await writeFile(join(root, "fixture.cmd"), "@echo off\r\necho cmd-fixture %1\r\nexit /b 0\r\n");
      const cmd = await runCommandTool.prepare?.(
        ctx,
        { command: `& ${quote(join(root, "fixture.cmd"))} 'spaced argument'` },
        nextSignal,
      );
      assert(cmd);
      const cmdResult = await cmd.apply(nextSignal);
      assert.equal(cmdResult.exitCode, 0);
      assert.match(String(cmdResult.output), /cmd-fixture/);
      receipt.cmd = cmdResult;
    }
    await writeFile(join(root, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  } finally {
    await runner.stopAll();
    for (const pid of pids) if (alive(pid)) host.signal(pid, "SIGKILL");
  }
}

if (process.argv[2] === "--run" && process.argv[3]) {
  commandPlatformProbe(process.argv[3]).then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    },
  );
}
