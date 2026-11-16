import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCommandTool } from "../../src/libraries/core/src/plugins/command-tools.js";
import { NodeProcessHost } from "../../src/libraries/core/src/plugins/node-process-host.js";
import { ProgramSession, programOutputTool } from "../../src/libraries/core/src/plugins/program-tools.js";
import { ProgramRunner } from "../../src/libraries/core/src/plugins/runner.js";
import { createCommandShellHost } from "../../src/libraries/core/src/plugins/shell.js";
import type { ToolContext } from "../../src/libraries/core/src/tools/context.js";

const root = resolve(process.argv[2] ?? "evaluation-outputs/term04/platform");
await mkdir(root, { recursive: true });
const bench = join(root, "bench"),
  sibling = join(root, "sibling");
await mkdir(join(bench, ".vera"), { recursive: true });
await mkdir(sibling, { recursive: true });
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const host = new NodeProcessHost(spawn);
const runner = new ProgramRunner({ host, clock: { sleep }, killGraceMs: 50 });
const epoch = new AbortController();
const ctx: ToolContext = {
  root: bench,
  lastReads: new Map(),
  permissionMode: () => "bypass",
  bypassSignal: () => epoch.signal,
  programs: {
    sessionId: "ses_term04",
    turnId: "turn_term04",
    callId: "call_term04",
    session: new ProgramSession(),
    consume: () => {},
    host: {
      runner,
      clock: { sleep },
      shell: createCommandShellHost(
        host,
        () => "",
        (text) => text,
      ),
      plugins: async () => [],
      resolver: { resolve: async () => undefined },
    },
  },
};
const signal = new AbortController().signal;
const quote = (text: string) => `'${text.replaceAll("'", process.platform === "win32" ? "''" : "'\"'\"'")}'`;
const command = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} server.cjs`;
await writeFile(
  join(sibling, "server.cjs"),
  `
const http=require('node:http');
console.log('FIRST');
process.stdout.write('retained-line\\n'.repeat(90000));
const server=http.createServer((req,res)=>res.end('ready'));
server.listen(0,'127.0.0.1',()=>console.log('READY:'+server.address().port));
setInterval(()=>console.log('heartbeat'),100);
`,
);
try {
  const prepared = await runCommandTool.prepare?.(ctx, { command, cwd: sibling, background: true }, signal);
  assert(prepared);
  const result = await prepared.apply(signal);
  const id = String(result.handle);
  let text = "";
  for (let index = 0; index < 100 && !/^READY:/m.test(text); index++) {
    await sleep(50);
    text = (await runner.log(bench, id)).text;
  }
  const port = Number(text.match(/^READY:(\d+)/m)?.[1]);
  assert(port > 0);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "ready");
  assert.deepEqual((await runner.list(bench))[0]?.command, { text: command, cwd: await realpath(sibling) });
  await assert.rejects(runner.stopRun(sibling, id), { code: "NOT_FOUND" });
  await runner.stopRun(bench, id);
  const output = await programOutputTool.execute(ctx, { handle: id }, signal);
  assert.equal(output.running, false);
  assert.equal(output.stopped, true);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
  const tail = await runner.log(bench, id),
    full = await runner.log(bench, id, Number.POSITIVE_INFINITY);
  console.log(
    JSON.stringify({
      fullStart: full.text.slice(0, 80),
      fullEnd: full.text.slice(-80),
      fullLength: full.text.length,
      truncated: full.truncated,
    }),
  );
  assert(tail.truncated);
  assert(!full.truncated && full.text.startsWith("FIRST\n") && full.text.includes("READY:"));
  const final = (await runner.list(bench))[0];
  assert.equal(final?.state, "stopped");
  assert.equal(typeof final?.durationMs, "number");
  await assert.rejects(runner.log(bench, "../outside", Number.POSITIVE_INFINITY), { code: "NOT_FOUND" });
  const receipt = {
    platform: process.platform,
    node: process.version,
    executable: process.execPath,
    final,
    output,
    fullBytes: Buffer.byteLength(full.text),
    tailBytes: Buffer.byteLength(tail.text),
  };
  await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await runner.stopAll();
}
