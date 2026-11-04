// REQ-SEC-13ab0003: real approval gate + process at the verify/spawn replacement boundary.
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeProcessHost, openDb, PluginStore, ProgramRunner, SessionService } from "@vera/core";
import { expect, it, vi } from "vitest";
import { ReplayGateway } from "../../src/libraries/core/src/llm/replay.js";

it("an approved run executes its original helper when a new hash is trusted after final verification", async () => {
  const base = await mkdtemp(join(tmpdir(), "vera-scoped-spawn-")),
    root = join(base, "bench"),
    source = join(root, ".vera/plugins/echo-tools");
  await mkdir(join(root, ".vera/plugins"), { recursive: true });
  await cp("tests/fixtures/plugins/echo-tools", source, { recursive: true });
  await writeFile(
    join(source, "echo.mjs"),
    "const helper=await import('./helper.mjs');console.log(helper.value);\n",
  );
  await writeFile(join(source, "helper.mjs"), "export const value='OLD-HASH-CODE';\n");
  const store = new PluginStore({ root: join(base, "data/plugins"), workbench: root });
  const first = (await store.reviewScoped("echo-tools")).sha256;
  await store.trustScoped("echo-tools", first);
  const old = await store.load("echo-tools");
  const replay = join(base, "replay");
  await mkdir(replay);
  await writeFile(
    join(replay, "run.jsonl"),
    [
      {
        match: "run",
        toolCalls: [{ name: "run_program", args: { program: "echo", args: ["write", "payload"] } }],
      },
      { text: "Done" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n"),
  );
  const gateway = new ReplayGateway({ dir: replay, now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  const database = await openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const clock = {
    now: () => new Date(),
    sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  };
  const runner = new ProgramRunner({ host: new NodeProcessHost(spawn), clock });
  let changed = false;
  const start = runner.start.bind(runner);
  const hook = vi.spyOn(runner, "start").mockImplementation((request) =>
    start({
      ...request,
      beforeSpawn: async () => {
        await request.beforeSpawn?.();
        // Deterministic barrier: old approval already consumed and its final integrity check succeeded.
        await writeFile(join(source, "helper.mjs"), "export const value='NEW-HASH-CODE';\n");
        await store.trustScoped("echo-tools", (await store.reviewScoped("echo-tools")).sha256);
        changed = true;
      },
    }),
  );
  const service = new SessionService({
    root,
    db: database.db,
    gateway,
    clock,
    mode: "ask",
    model: () => "replay/run",
    prompt: () => "Fixture",
    programs: {
      runner,
      clock,
      plugins: async () => [await store.load("echo-tools")],
      resolver: { resolve: async () => ({ executable: process.execPath }) },
    },
  });
  try {
    await service.waitReady();
    const session = service.create(null, "ask");
    service.send(session.id, "run");
    await expect
      .poll(() => service.get(session.id).snapshot.approvals.find((a) => !a.decision)?.tool)
      .toBe("run_program");
    const approval = service.get(session.id).snapshot.approvals.find((a) => !a.decision);
    if (!approval) throw Error("Missing real approval");
    service.decideApproval({
      sessionId: session.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision: "approved",
    });
    await service.waitIdle(session.id);
    const runs = await runner.list(root);
    expect(changed).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.exitCode).toBe(0);
    const log = await readFile(join(root, runs[0]?.log ?? ""), "utf8");
    expect(log).toContain("OLD-HASH-CODE");
    expect(log).not.toContain("NEW-HASH-CODE");
    expect(database.db.prepare("SELECT status FROM tool_calls WHERE name='run_program'").get()).toEqual({
      status: "ok",
    });
    const current = await store.load("echo-tools");
    expect(current.record.sha256).not.toBe(first);
    expect(await readFile(join(old.folder, "helper.mjs"), "utf8")).toContain("OLD-HASH-CODE");
    if (process.env.VERA_TEST_EVIDENCE_DIR) {
      await mkdir(process.env.VERA_TEST_EVIDENCE_DIR, { recursive: true });
      await writeFile(
        join(process.env.VERA_TEST_EVIDENCE_DIR, "scoped-spawn.json"),
        JSON.stringify(
          {
            platform: process.platform,
            approvalDigest: approval.requestSha256,
            oldHash: first,
            newHash: current.record.sha256,
            oldFolder: old.folder,
            newFolder: current.folder,
            run: runs[0],
            toolStatus: "ok",
            output: log,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    hook.mockRestore();
    await service.close();
    await runner.stopAll();
    database.close();
    await rm(base, { recursive: true, force: true });
  }
}, 30000);
