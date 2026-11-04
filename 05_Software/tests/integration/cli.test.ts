import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { NodeWorkerPool, openDb, PluginStore, SessionService, SkillCatalog } from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import type { SessionEvent } from "@vera/shared";
import Database from "better-sqlite3";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prepareCase, sections, sha256 } from "../fixtures/firmware-comparator/harness.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let compiled: string;
let evidence: string | undefined;
let invocation = 0;
const cleanup: string[] = [];
const servers: Server[] = [];
beforeAll(async () => {
  await mkdir(join(root, "node_modules/.cache"), { recursive: true });
  compiled = await mkdtemp(join(root, "node_modules/.cache/vera-cli-test-"));
  cleanup.push(compiled);
  buildSync({
    entryPoints: {
      index: join(root, "src/apps/cli/src/index.ts"),
      "grep-worker": join(root, "src/apps/cli/src/grep-worker.ts"),
    },
    outdir: compiled,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "external",
    alias: {
      "@vera/core": join(root, "src/libraries/core/src/index.ts"),
      "@vera/core/replay": join(root, "src/libraries/core/src/llm/replay.ts"),
      "@vera/core/grep-worker": join(root, "src/libraries/core/src/tools/grep-worker.ts"),
      "@vera/shared": join(root, "src/libraries/shared/src/index.ts"),
    },
  });
  await writeFile(
    join(compiled, "signal.mjs"),
    `const original = process.stdout.write.bind(process.stdout); let sent = false;
process.stdout.write = (...args) => { const result = original(...args); if (!sent && String(args[0]).includes('"turn.started"')) { sent = true; setTimeout(() => process.emit(process.env.VERA_CLI_SIGNAL_TEST), 30); } return result; };`,
  );
  buildSync({
    entryPoints: [join(root, "tests/network-guard.ts")],
    outfile: join(compiled, "guard.mjs"),
    platform: "node",
    format: "esm",
    bundle: true,
    footer: { js: "installTestNetworkGuard();" },
  });
  if (process.env.VERA_CLI_EVIDENCE_DIR) {
    await mkdir(process.env.VERA_CLI_EVIDENCE_DIR, { recursive: true });
    evidence = await mkdtemp(join(process.env.VERA_CLI_EVIDENCE_DIR, `suite-${process.pid}-`));
    await cp(compiled, join(evidence, "bundle"), { recursive: true, errorOnExist: true, force: false });
  }
});
afterAll(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  for (const path of cleanup) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "vera-cli-process-"));
  cleanup.push(dir);
  const workbench = join(dir, "Board ă");
  await cp(join(root, "tests/fixtures/workbenches/demo-board"), workbench, { recursive: true });
  // Keep the replay input identical to native sessions acceptance.
  await writeFile(join(workbench, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  return { dir, workbench };
}
function launch(
  args: string[],
  env: Record<string, string> = {},
  mode: "compiled" | "npm" | "pty" = "compiled",
) {
  const environment = { ...process.env, ...env };
  delete environment.VERA_TEST;
  delete environment.OPENAI_API_KEY;
  Object.assign(environment, env);
  // npm launches build/CLI Node children through a shell: inherit the same loopback guard.
  if (mode === "npm")
    environment.NODE_OPTIONS =
      `${environment.NODE_OPTIONS ?? ""} --import=${pathToFileURL(join(compiled, "guard.mjs")).href}`.trim();
  const number = ++invocation,
    start = new Date().toISOString();
  const npmCandidates = [
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const npm = npmCandidates.find(existsSync);
  if (mode === "npm" && !npm) throw Error("Pinned npm CLI unavailable");
  const argv = [
    "--import",
    pathToFileURL(join(compiled, "guard.mjs")).href,
    ...(env.VERA_CLI_SIGNAL_TEST ? ["--import", pathToFileURL(join(compiled, "signal.mjs")).href] : []),
    ...(mode !== "npm" ? [join(compiled, "index.js"), ...args] : [npm ?? "", "run", "vera", "--", ...args]),
  ];
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const executable = mode === "pty" ? "script" : process.execPath;
  const executedArgv =
    mode === "pty"
      ? [
          "-q",
          "-e",
          "-c",
          `stty -echo; exec ${[process.execPath, ...argv].map(quote).join(" ")}`,
          "/dev/null",
        ]
      : argv;
  const child = spawn(executable, executedArgv, {
    cwd: root,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (mode !== "pty") child.stdin.end();
  let stdout = "",
    stderr = "";
  const outBytes: Buffer[] = [],
    errBytes: Buffer[] = [];
  child.stdout.on("data", (data) => {
    outBytes.push(data);
    stdout += data.toString();
  });
  child.stderr.on("data", (data) => {
    errBytes.push(data);
    stderr += data.toString();
  });
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    child.on("error", reject);
    child.on("close", async (code) => {
      try {
        if (evidence) {
          const folder = evidence;
          const name = `process-${number}`;
          const stdoutBytes = Buffer.concat(outBytes),
            stderrBytes = Buffer.concat(errBytes);
          const executedRoot = mode === "npm" ? join(root, "src/apps/cli/dist") : compiled;
          const executedFiles = ["index.js", "grep-worker.js"];
          const executableHashes: Record<string, string> = {};
          await mkdir(join(folder, `${name}-executed-bundle`));
          for (const file of executedFiles) {
            const bytes = await readFile(join(executedRoot, file));
            await writeFile(join(folder, `${name}-executed-bundle`, file), bytes, { flag: "wx" });
            executableHashes[file] = createHash("sha256").update(bytes).digest("hex");
          }
          await writeFile(join(folder, `${name}.stdout`), stdoutBytes, { flag: "wx" });
          await writeFile(join(folder, `${name}.stderr`), stderrBytes, { flag: "wx" });
          await writeFile(
            join(folder, `${name}.json`),
            JSON.stringify(
              {
                argv: [executable, ...executedArgv],
                nodeArgv: [process.execPath, ...argv],
                cwd: root,
                startUTC: start,
                endUTC: new Date().toISOString(),
                exit: code,
                platform: process.platform,
                networkGuard: true,
                networkGuardScope: mode === "npm" ? "inherited-node-preload" : "child-preload",
                NODE_OPTIONS: environment.NODE_OPTIONS ?? null,
                executionMode: mode,
                executableRoot: executedRoot,
                executableSHA256: executableHashes,
                VERA_TEST: environment.VERA_TEST ?? null,
                stdoutSHA256: createHash("sha256").update(stdoutBytes).digest("hex"),
                stderrSHA256: createHash("sha256").update(stderrBytes).digest("hex"),
                bundle: Object.fromEntries(
                  await Promise.all(
                    (await readdir(compiled)).map(async (file) => [
                      file,
                      createHash("sha256")
                        .update(await readFile(join(compiled, file)))
                        .digest("hex"),
                    ]),
                  ),
                ),
              },
              null,
              2,
            ),
            { flag: "wx" },
          );
        }
        done({ code, stdout, stderr });
      } catch (error) {
        reject(error);
      }
    });
  });
  return { child, result, output: () => stdout };
}
const events = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const replay = (
  workbench: string,
  script = join(root, "tests/fixtures/llm-scripts/read-then-answer.jsonl"),
) => [
  "run",
  "--workbench",
  workbench,
  "--prompt",
  "Read the board",
  "--provider",
  "replay",
  "--script",
  script,
];
// CAP03 replay proves real wiring/persistence only; it does not grade model semantics.
it("firmware-comparator loads from a folder plugin and saves the cited comparison through SessionService and CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-cap03-replay-"));
  cleanup.push(dir);
  const workbench = await prepareCase(root, dir, "comparable-pair");
  const data = join(dir, "data"),
    scripts = join(dir, "scripts");
  await mkdir(scripts);
  const index = await launch(["index", "--workbench", workbench, "--data", data], {}, "npm").result;
  expect(index.code, index.stderr).toBe(0);
  const name = "firmware-comparison-boot-0412-boot-0413.md";
  const baselineSHA = sha256(await readFile(join(workbench, "logs/boot-0412.log")));
  const candidateSHA = sha256(await readFile(join(workbench, "logs/boot-0413.log")));
  const report = `# Firmware comparison\n\n## Scope and sources\nBaseline firmware1.0.0 logs/boot-0412.log SHA256 ${baselineSHA}; candidate firmware1.1.0 logs/boot-0413.log SHA256 ${candidateSHA}; profile iso. [[logs/boot-0412.log#L1-L4]] [[logs/boot-0413.log#L1-L4]]\n\n## Comparability\ncomparable documented conditions: VERA-DEMO-01 revisionA, DEMO-001, boot@1, bench@1. Firmware is the intentional variable; image hashes unknown. Notes do not establish actual bench equivalence. [[docs/runs.md#L1-L10]]\n\n## Observed differences\nComplete scans. error0->1, warn1->1, info3->2. Candidate first new ERROR i2c initialization failed [[logs/boot-0413.log#L4-L4]]. Baseline-only ready event [[logs/boot-0412.log#L4-L4]]. No timing delta for those different messages.\n\n## Criterion\nboot@1: reaches i2c ready and no ERROR. Baseline criterion met; candidate not met. [[docs/boot-test.md#h=boot-criterion-boot1]] [[logs/boot-0412.log#L4-L4]] [[logs/boot-0413.log#L4-L4]]\n\n## Binary differences\nskipped: two build folders not supplied; no program plugin enabled.\n\n## Interpretation\nFact: firmware1.1.0 documents I2C initialization timing change. [[docs/release-notes.md#h=firmware-110-release-notes]] Cause remains unknown. Hypothesis: changed timing may contribute; reject by reviewing initialization ordering against the exact source/build and controlled manual evidence.\n\n## Recommended checks\n1. Confirm actual bench conditions against notes before attributing a firmware regression.\n2. Review I2C ordering and obtain a sourced manual test plan; no checks executed.\n`;
  const script = join(scripts, "comparison.jsonl");
  await writeFile(
    script,
    [
      { toolCalls: [{ name: "load_skill", args: { name: "firmware-comparator" } }] },
      {
        toolCalls: [
          { name: "load_skill", args: { name: "firmware-comparator", file: "templates/comparison.md" } },
        ],
      },
      { toolCalls: [{ name: "read", args: { path: "docs/runs.md" } }] },
      {
        toolCalls: [
          { name: "parse_log", args: { path: "logs/boot-0412.log", profile: "iso" } },
          { name: "parse_log", args: { path: "logs/boot-0413.log", profile: "iso" } },
        ],
      },
      { toolCalls: [{ name: "search_docs", args: { query: "I2C initialization timing", mode: "keyword" } }] },
      {
        toolCalls: [
          {
            name: "read_doc",
            args: { path: "docs/release-notes.md", heading: "firmware-110-release-notes" },
          },
          { name: "read_doc", args: { path: "docs/boot-test.md", heading: "boot-criterion-boot1" } },
        ],
      },
      { toolCalls: [{ name: "artifact_save", args: { name, content: report } }] },
      { text: report },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const workers = new NodeWorkerPool(pathToFileURL(join(compiled, "grep-worker.js")));
  const handle = await openDb(join(workbench, ".vera/vera.db"), {
    workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    appVersion: "0",
  });
  const plugin = await new PluginStore({ root: join(data, "plugins") }).load("analysis-skills");
  const skills = new SkillCatalog({
    root: workbench,
    disabled: () => [],
    plugins: async () => [{ id: "analysis-skills", folder: plugin.folder }],
  });
  const service = new SessionService({
    db: handle.db,
    root: workbench,
    skills,
    workers,
    gateway: new ReplayGateway({ dir: scripts, now: () => 123 }),
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/comparison",
    prompt: () => "CAP03 integration replay",
  });
  const agent: SessionEvent[] = [];
  try {
    const session = service.create();
    service.subscribe(session.id, 0, (_seq, event) => agent.push(event));
    service.send(session.id, "Compare selected fictional captures");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const summaries = service.listArtifacts(session.id);
    expect(summaries).toHaveLength(1);
    const artifact = await service.openArtifact(summaries[0]?.artifactId ?? "");
    expect(artifact).toMatchObject({ name, content: report });
    expect(artifact.content.match(/^## .+$/gm)).toEqual(sections.map((section) => `## ${section}`));
    expect(service.verifiedArtifact(artifact.artifactId).path).toBeTruthy();
    const cli = await launch([...replay(workbench, script), "--data", data], {}, "npm").result;
    expect(cli.code).toBe(0);
    const records: SessionEvent[] = events(cli.stdout).map((record) => record.event);
    for (const output of [agent, records]) {
      const tools = output.filter((event) => event.type === "tool.done");
      expect(tools).toHaveLength(9);
      expect(tools.every((event) => event.ok)).toBe(true);
      const values = tools.map((event) => JSON.parse(event.summary));
      expect(values.find((value) => value.source?.path === "logs/boot-0412.log")).toMatchObject({
        counts: { error: 0, warn: 1, info: 3 },
        scan: { complete: true },
        source: { sha256: baselineSHA },
      });
      expect(values.find((value) => value.source?.path === "logs/boot-0413.log")).toMatchObject({
        counts: { error: 1, warn: 1, info: 2 },
        scan: { complete: true },
        source: { sha256: candidateSHA },
        events: expect.arrayContaining([
          expect.objectContaining({ ref: "logs/boot-0413.log#L4-L4", level: "error" }),
        ]),
      });
      const last = output.filter((event) => event.type === "message.done").at(-1);
      expect(last?.citations?.length).toBeGreaterThan(5);
      expect(last?.citations?.every((citation) => citation.valid)).toBe(true);
    }
    const cliDb = new Database(join(workbench, ".vera/vera.db"), { readonly: true });
    try {
      const artifacts = cliDb.prepare("SELECT name,sha256 FROM artifacts WHERE name=?").all(name);
      expect(artifacts).toHaveLength(2);
      expect(artifacts).toEqual([
        { name, sha256: sha256(report) },
        { name, sha256: sha256(report) },
      ]);
    } finally {
      cliDb.close();
    }
    if (evidence) {
      await writeFile(
        join(evidence, "firmware-comparison-agent.json"),
        JSON.stringify({ events: agent, artifact }, null, 2),
        { flag: "wx" },
      );
      await writeFile(join(evidence, name), artifact.content, { flag: "wx" });
    }
  } finally {
    await service.close();
    handle.close();
    await workers.dispose();
  }
}, 120000);
it("parse_log returns identical cited evidence through agent sessions and vera run", async () => {
  const { dir, workbench } = await fixture();
  await writeFile(join(workbench, "logs/control.log"), "2026-04-12T08:00:00Z INFO ready\n\u0000\n");
  const scripts = join(dir, "scripts");
  await mkdir(scripts);
  const script = join(scripts, "parse-log.jsonl");
  await writeFile(
    script,
    [
      { toolCalls: [{ name: "parse_log", args: { path: "logs/boot-0412.log", profile: "iso" } }] },
      {
        toolCalls: [
          { name: "parse_log", args: { path: "logs/boot-0413.log", profile: "iso", levels: ["error"] } },
        ],
      },
      { toolCalls: [{ name: "parse_log", args: { path: "logs/control.log", profile: "iso" } }] },
      {
        text: "Baseline WARN [[logs/boot-0412.log#L3-L3]]. Candidate ERROR [[logs/boot-0413.log#L4-L4]]. UTF8 log [[logs/control.log#L1-L1]].",
      },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const workers = new NodeWorkerPool(pathToFileURL(join(compiled, "grep-worker.js")));
  const handle = await openDb(join(dir, "agent.db"), { workbenchId: "wb_test", appVersion: "0" });
  const service = new SessionService({
    db: handle.db,
    root: workbench,
    workers,
    gateway: new ReplayGateway({ dir: scripts, now: () => 123 }),
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/parse-log",
    prompt: () => "Cite inspected events.",
  });
  const agent: SessionEvent[] = [];
  try {
    const session = service.create();
    service.subscribe(session.id, 0, (_seq, event) => agent.push(event));
    service.send(session.id, "Parse the captured boot logs");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const cli = await launch([...replay(workbench, script), "--data", join(dir, "cli-data")], {}, "npm")
      .result;
    expect(cli.code).toBe(0);
    const cliEvents = events(cli.stdout).map((record) => record.event);
    const outputs = (records: SessionEvent[]) =>
      records.flatMap((event) => (event.type === "tool.done" ? [JSON.parse(event.summary)] : []));
    expect(outputs(cliEvents)).toEqual(outputs(agent));
    expect(outputs(agent)[0]).toMatchObject({ counts: { info: 3, warn: 1, error: 0 } });
    expect(outputs(agent)[1]).toMatchObject({
      counts: { error: 1 },
      events: [{ ref: "logs/boot-0413.log#L4-L4" }],
    });
    expect(outputs(agent)[2]).toMatchObject({ counts: { info: 1, unparsed: 1 } });
    for (const records of [agent, cliEvents])
      expect(records.filter((event: SessionEvent) => event.type === "message.done").at(-1)).toMatchObject({
        citations: [
          { ref: "logs/boot-0412.log#L3-L3", valid: true },
          { ref: "logs/boot-0413.log#L4-L4", valid: true },
          { ref: "logs/control.log#L1-L1", valid: true },
        ],
      });
    const answer = service
      .get(session.id)
      .snapshot.items.filter((item) => item.kind === "assistant")
      .at(-1);
    if (answer?.kind !== "assistant") throw Error("Missing cited answer.");
    expect(await service.openCitation(session.id, answer.id, "logs/control.log#L1-L1")).toMatchObject({
      kind: "text",
      lines: ["2026-04-12T08:00:00Z INFO ready", "\u0000"],
      start: 1,
      end: 1,
    });
  } finally {
    await service.close();
    handle.close();
    await workers.dispose();
  }
}, 60000);
it("decode_register returns identical complete cited evidence through agent sessions and vera run", async () => {
  const { dir, workbench } = await fixture();
  const definitionPath = "definitions/registers/vera-demo-01.json";
  const bytes = await readFile(join(workbench, definitionPath));
  const definitionRef = `${definitionPath}#L1-L${bytes.toString().trimEnd().split("\n").length}`;
  const manualRef = "sources/reference-manual.md#L7-L7";
  const scripts = join(dir, "scripts");
  await mkdir(scripts);
  const script = join(scripts, "decode-register.jsonl");
  await writeFile(
    script,
    [
      {
        toolCalls: [
          { name: "decode_register", args: { definitionPath, register: "I2C1_CR1", value: "0x81" } },
        ],
      },
      { text: `Captured value129 [[${definitionRef}]]. Field meanings [[${manualRef}]].` },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const handle = await openDb(join(dir, "agent.db"), { workbenchId: "wb_test", appVersion: "0" });
  const options = {
    db: handle.db,
    root: workbench,
    gateway: new ReplayGateway({ dir: scripts, now: () => 123 }),
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/decode-register",
    prompt: () => "Cite captured register evidence.",
  };
  let service = new SessionService(options);
  const agent: SessionEvent[] = [];
  try {
    const session = service.create();
    service.subscribe(session.id, 0, (_seq, event) => agent.push(event));
    service.send(session.id, "Decode the captured register");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const cli = await launch([...replay(workbench, script), "--data", join(dir, "cli-data")], {}, "npm")
      .result;
    expect(cli.code).toBe(0);
    const cliEvents = events(cli.stdout).map((record) => record.event);
    const outputs = (records: SessionEvent[]) =>
      records.flatMap((event) => (event.type === "tool.done" ? [JSON.parse(event.summary)] : []));
    expect(outputs(cliEvents)).toEqual(outputs(agent));
    expect(outputs(agent)).toHaveLength(1);
    expect(outputs(agent)[0]).toMatchObject({
      valueDec: "129",
      unmappedMaskHex: "0xffffff78",
      unmappedSetBitsHex: "0x00000000",
      source: { ref: definitionRef, sha256: createHash("sha256").update(bytes).digest("hex") },
      sourceRefs: [manualRef],
    });
    for (const records of [agent, cliEvents]) {
      expect(
        records
          .filter((event: SessionEvent) => event.type === "tool.done")
          .every((event: SessionEvent) => event.type === "tool.done" && event.ok),
      ).toBe(true);
      expect(records.filter((event: SessionEvent) => event.type === "message.done").at(-1)).toMatchObject({
        citations: [
          { ref: definitionRef, valid: true },
          { ref: manualRef, valid: true },
        ],
      });
    }
    const answer = service
      .get(session.id)
      .snapshot.items.filter((item) => item.kind === "assistant")
      .at(-1);
    if (answer?.kind !== "assistant") throw Error("Missing cited answer.");
    for (const ref of [definitionRef, manualRef])
      expect(await service.openCitation(session.id, answer.id, ref)).toMatchObject({ kind: "text" });
    await service.close();
    service = new SessionService(options);
    expect(
      service
        .get(session.id)
        .snapshot.items.filter((item) => item.kind === "assistant")
        .at(-1),
    ).toMatchObject({
      citations: [
        { ref: definitionRef, valid: true },
        { ref: manualRef, valid: true },
      ],
    });
    expect(await service.openCitation(session.id, answer.id, manualRef)).toMatchObject({
      kind: "text",
      start: 7,
      end: 7,
    });
    if (evidence)
      await writeFile(
        join(evidence, "decode-register-agent.json"),
        JSON.stringify({ events: agent, snapshot: service.get(session.id).snapshot }, null, 2),
        { flag: "wx" },
      );
  } finally {
    await service.close();
    handle.close();
  }
}, 60000);
it("CLI loads a separately authorized user skill and extra file", async () => {
  const { workbench } = await fixture();
  const data = join(workbench, "user-data"),
    dir = join(data, "skills", "reader"),
    script = join(workbench, "skill-replay.jsonl");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    "---\nname: reader\ndescription: Use for CLI board review.\n---\nCLI BODY\n",
  );
  await writeFile(join(dir, "extra.md"), "CLI EXTRA");
  await writeFile(
    script,
    [
      { toolCalls: [{ name: "load_skill", args: { name: "reader" } }] },
      { text: "{{text}}", toolCalls: [{ name: "load_skill", args: { name: "reader", file: "extra.md" } }] },
      { text: "{{text}}" },
    ]
      .map((s) => JSON.stringify(s))
      .join("\n"),
  );
  const result = await launch([...replay(workbench, script), "--data", data]).result;
  expect(result.code).toBe(0);
  const records = events(result.stdout);
  const tool = records.filter((r) => r.event.type === "tool.done");
  expect(tool).toHaveLength(2);
  expect(tool.every((r) => r.event.ok)).toBe(true);
  expect(
    records
      .filter((r) => r.event.type === "message.done")
      .map((r) => r.event.text)
      .join("\n"),
  ).toContain("CLI BODY");
  expect(records.filter((r) => r.event.type === "message.done").at(-1)?.event.text).toBe("CLI EXTRA");
});
// REQ-FUNC-59308834
it("CLI offers the enabled plugin's skill and program tools and runs a resolved program", async () => {
  const { workbench } = await fixture();
  const data = join(workbench, "user-data"),
    script = join(workbench, "plugin-replay.jsonl");
  await new PluginStore({ root: join(data, "plugins") }).install(
    join(root, "tests/fixtures/plugins/echo-tools"),
  );
  const config = join(workbench, ".vera/workbench.yaml");
  await writeFile(config, `${await readFile(config, "utf8")}plugins:\n  enabled: [echo-tools]\n`);
  await writeFile(
    script,
    [
      { toolCalls: [{ name: "load_skill", args: { name: "echo-guide" } }] },
      { toolCalls: [{ name: "run_program", args: { program: "echo", args: ["version"] } }] },
      { text: "Done" },
    ]
      .map((s) => JSON.stringify(s))
      .join("\n"),
  );
  // REQ-FUNC-565e908d: the find program resolves through provisioning to this Node executable.
  const result = await launch([...replay(workbench, script), "--data", data], {
    VERA_TEST_NODE: process.execPath,
  }).result;
  expect(result.code).toBe(0);
  const tools = events(result.stdout).filter((r) => r.event.type === "tool.done");
  expect(tools.map((r) => r.event.ok)).toEqual([true, true]);
  expect(String(tools[0]?.event.summary)).toContain("Run `echo version` first.");
  const summary = String(tools[1]?.event.summary);
  expect(summary).toContain('"exitCode":0');
  expect(summary).toContain('"risk":"safe"');
  // echo-tools' echo.mjs reports the command it received.
  expect(summary).toContain('{\\"command\\":\\"version\\"');
  // Without the variable the program is not found, so it is not available to the agent.
  const missing = await launch([...replay(workbench, script), "--data", data]).result;
  const failed = events(missing.stdout).filter((r) => r.event.type === "tool.done");
  expect(String(failed[1]?.event.summary)).toMatch(/Program echo is not available/);
});
// REQ-FUNC-c44675ed, REQ-UX-46085ddf
it("CLI installs a plugin and its programs and prints their statuses", async () => {
  const { dir } = await fixture();
  const data = join(dir, "user-data"),
    plugin = join(dir, "bench-tools");
  await mkdir(plugin);
  await writeFile(
    join(plugin, "plugin.yaml"),
    [
      "format: 1",
      "id: bench-tools",
      "version: 1.0.0",
      "name: Bench tools",
      "description: Node and a missing analyser.",
      "ecosystem: general",
      "platforms: [windows-x64, linux-x64]",
      "programs:",
      "  node:",
      '    install: { find: { windows: ["%VERA_TEST_NODE%"], linux: ["$VERA_TEST_NODE"] } }',
      "    version: { args: [--version], match: 'v(\\d+\\.\\d+\\.\\d+)', range: '>=20' }",
      "  tshark:",
      '    install: { find: { windows: ["C:/nonexistent/tshark.exe"], linux: ["/nonexistent/tshark"] }, hint: "Install Wireshark from https://www.wireshark.org/download.html." }',
      "    version: { args: [--version], match: 'TShark (\\S+)' }",
      "",
    ].join("\n"),
  );
  const result = await launch(["plugin", "install", "--path", plugin, "--data", data], {
    VERA_TEST_NODE: process.execPath,
  }).result;
  expect(result.code).toBe(1);
  const lines = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  expect(lines).toEqual([
    { name: "node", kind: "find", state: "ready", version: process.versions.node, range: ">=20" },
    {
      name: "tshark",
      kind: "find",
      state: "missing",
      problem: "notFound",
      hint: "Install Wireshark from https://www.wireshark.org/download.html.",
      link: "https://www.wireshark.org/download.html",
    },
  ]);
  expect(existsSync(join(data, "plugins", "installed", "bench-tools", "install.json"))).toBe(true);
  for (const args of [
    ["plugin", "install", "--data", data],
    ["plugin", "install", "--path", plugin],
    ["plugin", "remove"],
  ]) {
    const usage = await launch(args).result;
    expect(usage.code, args.join(" ")).toBe(2);
  }
});
// REQ-FUNC-3b9f62f8 REQ-SEC-5fa5cd5e REQ-FUNC-f4381792
it("CLI checks a catalog source and builds its release", async () => {
  const { dir } = await fixture();
  const source = join(dir, "catalog"),
    out = join(dir, "release");
  await cp(join(root, "plugins"), source, { recursive: true });
  const clean = await launch(["catalog", "check", "--source", source]).result;
  expect(clean.code).toBe(0);
  expect(clean.stdout).toBe("");
  const built = await launch(["catalog", "build", "--source", source, "--out", out]).result;
  expect(built.code).toBe(0);
  expect(built.stdout.trim()).toBe(`2 plugins written to ${out}`);
  const index = JSON.parse(await readFile(join(out, "index.json"), "utf8"));
  expect(index.plugins.map((plugin: { url: string }) => plugin.url)).toEqual([
    "esp32-esptool-1.0.0.zip",
    "serial-monitor-1.0.0.zip",
  ]);
  const manifest = join(source, "serial-monitor", "plugin.yaml");
  await writeFile(
    manifest,
    (await readFile(manifest, "utf8")).replace(
      /^rules:\r?\n/m,
      'rules:\n  - { match: "serial * burn *", risk: device-read }\n',
    ),
  );
  const burn = await launch(["catalog", "check", "--source", source]).result;
  expect(burn.code).toBe(1);
  expect(burn.stdout.trim()).toBe('serial-monitor: token: burn in "serial * burn *" at device-read');
  const refused = await launch(["catalog", "build", "--source", source, "--out", join(dir, "other")]).result;
  expect(refused.code).toBe(1);
  expect(existsSync(join(dir, "other"))).toBe(false);
  for (const args of [
    ["catalog", "check"],
    ["catalog", "build", "--source", source],
    ["catalog", "publish"],
  ]) {
    const usage = await launch(args).result;
    expect(usage.code, args.join(" ")).toBe(2);
  }
  // Seven CLI processes: under a full parallel suite they outlast the default 5 s.
}, 30000);
// REQ-FUNC-bf809842 REQ-DATA-e3d4d5ba REQ-FUNC-997412a4
it("CLI saves a session artifact without approval and emits valid/missing references", async () => {
  const { workbench } = await fixture();
  const result = await launch([
    ...replay(workbench, join(root, "tests/fixtures/llm-scripts/save-artifact.jsonl")),
    "--approve",
    "none",
  ]).result;
  expect(result.code).toBe(0);
  const records = events(result.stdout);
  const saved = records.find((r) => r.event.type === "artifact.saved");
  expect(saved?.event).toMatchObject({ name: "summary.md", bytes: 37 });
  expect(records.some((r) => r.event.type === "approval.requested")).toBe(false);
  expect(await readFile(join(workbench, ".vera/artifacts", saved.sessionId, "summary.md"), "utf8")).toBe(
    "# Session summary\n\nBoard uses 3.3 V.\n",
  );
  expect(records.filter((r) => r.event.type === "message.done").at(-1)?.event.citations).toEqual([
    { ref: "artifact:summary.md", valid: true },
    { ref: "artifact:missing.md", valid: false },
  ]);
});
// REQ-FUNC-2e8a54c7 REQ-DATA-d968385c
it("CLI emits each whole Plan replacement without approvals", async () => {
  const { workbench } = await fixture();
  const result = await launch([
    ...replay(workbench, join(root, "tests/fixtures/llm-scripts/plan-updates.jsonl")),
    "--approve",
    "none",
  ]).result;
  expect(result.code).toBe(0);
  const records = events(result.stdout);
  const updates = records.filter((r) => r.event.type === "todo.updated");
  expect(updates.map((r) => r.event.items)).toEqual([
    [
      { id: "inspect", text: "Inspect the board", status: "in_progress" },
      { text: "Verify the pins", status: "pending" },
    ],
    [
      { text: "Verify the pins", status: "in_progress" },
      { id: "inspect", text: "Inspect the board", status: "done" },
    ],
    [{ id: "summary", text: "Board verification complete", status: "done" }],
  ]);
  expect(records.some((r) => r.event.type === "approval.requested")).toBe(false);
  expect(records.filter((r) => r.event.type === "tool.done").every((r) => r.event.ok)).toBe(true);
});
it.each(["all", "none"])("CLI --approve %s decides ask edits and ends zero", async (policy) => {
  const { dir, workbench } = await fixture();
  const script = join(dir, "edit.jsonl");
  await writeFile(
    script,
    [
      { match: "Read", toolCalls: [{ name: "read", args: { path: "board.txt" } }] },
      { toolCalls: [{ name: "edit", args: { path: "board.txt", oldString: "3.3 V", newString: "5 V" } }] },
      { text: "Done" },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  const result = await launch([...replay(workbench, script), "--approve", policy]).result;
  expect(result.code).toBe(0);
  const records = events(result.stdout);
  expect(records.at(-1).event).toMatchObject({ type: "turn.done", stopReason: "end" });
  expect(records.find((r) => r.event.type === "approval.decided")?.event).toMatchObject({
    decision: policy === "all" ? "approved" : "denied",
    by: "user",
  });
  expect(await readFile(join(workbench, "board.txt"), "utf8")).toBe(
    policy === "all" ? "Board uses 5 V.\nSecond source line.\n" : "Board uses 3.3 V.\nSecond source line.\n",
  );
  if (policy === "none") expect(result.stdout).toContain("The user denied this change.");
});

it("denies an unflagged non-TTY approval without blocking or changing bytes", async () => {
  const { workbench } = await fixture();
  const result = await launch(replay(workbench, join(root, "tests/fixtures/llm-scripts/edit-deny.jsonl")))
    .result;
  expect(result.code).toBe(0);
  expect(result.stderr).not.toContain("Choose A");
  expect(events(result.stdout).find((r) => r.event.type === "approval.decided")?.event).toMatchObject({
    decision: "denied",
    by: "user",
  });
  expect(await readFile(join(workbench, "board.txt"), "utf8")).toContain("3.3 V");
});

it.skipIf(process.platform !== "linux").each(["a", "d", "interrupt"])(
  "real Linux PTY approval accepts %s and drains the CLI",
  async (choice) => {
    const { workbench } = await fixture();
    const launched = launch(
      replay(workbench, join(root, "tests/fixtures/llm-scripts/edit-approve.jsonl")),
      {},
      "pty",
    );
    let answered = false;
    launched.child.stdout.on("data", () => {
      if (!answered && launched.output().includes("Choose A to approve or D to deny: ")) {
        answered = true;
        launched.child.stdin?.write(choice === "interrupt" ? "\u0003" : `${choice}\n`);
      }
    });
    const result = await launched.result;
    expect(answered, "the real process must observe both stdin and stderr as TTY").toBe(true);
    expect(result.code).toBe(choice === "interrupt" ? 1 : 0);
    expect(result.stdout).toContain(
      `"decision":"${choice === "a" ? "approved" : choice === "d" ? "denied" : "aborted"}"`,
    );
    expect(result.stdout).toContain(`"stopReason":"${choice === "interrupt" ? "aborted" : "end"}"`);
    expect(await readFile(join(workbench, "board.txt"), "utf8")).toContain(choice === "a" ? "5 V" : "3.3 V");
    await expect(readFile(join(workbench, ".vera/lock"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("runs ordered read/list/cited events and resumes a durable session in a new process", async () => {
  const { workbench, dir } = await fixture();
  const first = await launch([...replay(workbench), "--data", join(dir, "data")]).result;
  expect(first.code).toBe(0);
  const rows = events(first.stdout);
  const types = rows.map((row) => row.event.type);
  const selected = types.filter((type) =>
    ["message.user", "turn.started", "tool.started", "tool.done", "turn.done"].includes(type),
  );
  expect(selected).toEqual([
    "message.user",
    "turn.started",
    "tool.started",
    "tool.done",
    "tool.started",
    "tool.done",
    "turn.done",
  ]);
  expect(rows.findLast((row) => row.event.type === "message.done").event).toMatchObject({
    text: "The board uses 3.3 V [[board.txt#L1-L2]].",
    citations: [{ valid: true }],
  });
  expect(rows.filter((row) => row.event.type === "message.delta").every((row) => row.seq === undefined)).toBe(
    true,
  );
  const id = rows[0].sessionId;
  const persisted = rows.filter((row) => row.seq !== undefined).map((row) => row.seq);
  expect(persisted).toEqual([...persisted].sort((a, b) => a - b));
  const second = await launch([...replay(workbench), "--session", id]).result;
  expect(second.code).toBe(0);
  expect(events(second.stdout).every((row) => row.sessionId === id)).toBe(true);
  expect(events(second.stdout).filter((row) => row.event.type === "message.user")).toHaveLength(1);
  expect(
    events(second.stdout)
      .filter((row) => row.seq !== undefined)
      .every((row) => row.seq > Math.max(...persisted)),
  ).toBe(true);
  await expect(readFile(join(workbench, ".vera/lock"))).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["literal", "unicode", "template", "keyfile-template"])(
  "scrubs explicit replay before fragmented output and SQLite persistence (%s)",
  async (encoding) => {
    const { workbench, dir } = await fixture();
    const key = encoding.includes("template")
      ? `sk-${"fictional-proj-15".repeat(4)}`
      : `${"fictional-long-key-15".repeat(4)}"\\tail`;
    const script = join(dir, "split.jsonl");
    let source = [
      { toolCalls: [{ name: "list", args: { glob: `${key}*` } }] },
      { text: `${"prefix ".repeat(5)}${key} safe` },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n");
    if (encoding.includes("template")) {
      await writeFile(join(workbench, key.slice(3)), "safe source\n");
      source = [
        { toolCalls: [{ name: "read", args: { path: key.slice(3) } }] },
        {
          text: `${"prefix ".repeat(5)}sk-{{ref}} safe`,
          toolCalls: [{ name: "list", args: { glob: "sk-{{ref}}" } }],
        },
        { text: "Finished safely." },
      ]
        .map((step) => JSON.stringify(step))
        .join("\n");
      expect(source).not.toContain(key);
    }
    if (encoding === "unicode") {
      const encoded = Array.from(key)
        .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
        .join("");
      source = source.replaceAll(JSON.stringify(key).slice(1, -1), encoded);
      expect(JSON.parse(source.split("\n")[1] ?? "").text).toContain(key);
    }
    // Preserve ReplayGateway's documented blank/comment-line support while staging.
    await writeFile(script, `// fixture\n\n${source}\n`);
    const args = replay(workbench, script);
    const environment: Record<string, string> = { OPENAI_API_KEY: key };
    if (encoding === "keyfile-template") {
      const keyFile = join(dir, "key.txt");
      await writeFile(keyFile, `${key}\n`);
      args.push("--key-file", keyFile);
      delete environment.OPENAI_API_KEY;
    }
    const result = await launch(args, environment).result;
    expect(result.code).toBe(0);
    const deltas = events(result.stdout)
      .filter((row) => row.event.type === "message.delta")
      .map((row) => row.event.text)
      .join("");
    expect(deltas).not.toContain(key);
    expect(deltas).toContain("[REDACTED]");
    const db = new Database(join(workbench, ".vera/vera.db"), { readonly: true });
    try {
      const stored = JSON.stringify({
        messages: db.prepare("SELECT content_json FROM messages").all(),
        events: db.prepare("SELECT payload_json FROM events").all(),
        tools: db.prepare("SELECT args_json, result_json FROM tool_calls").all(),
      });
      expect(stored).not.toContain(key);
      expect(stored).not.toContain(JSON.stringify(key).slice(1, -1));
      const messages = db.prepare("SELECT content_json FROM messages WHERE role='assistant'").all() as {
        content_json: string;
      }[];
      expect(
        messages
          .flatMap((row) => JSON.parse(row.content_json).content)
          .map((block) => block.text ?? "")
          .join(""),
      ).not.toContain(key);
    } finally {
      db.close();
    }
  },
);
it("the public npm run vera command emits parsable JSONL and scrubs raw usage arguments", async () => {
  const { workbench } = await fixture();
  const result = await launch(replay(workbench), {}, "npm").result;
  expect(result.code).toBe(0);
  expect(events(result.stdout).find((row) => row.event.type === "turn.done").event.stopReason).toBe("end");
  const key = "fictional-npm-reflected-key-15";
  const invalid = await launch(["run", `--${key}`], { OPENAI_API_KEY: key }, "npm").result;
  expect(invalid.code).toBe(2);
  expect(invalid.stdout + invalid.stderr).not.toContain(key);
  expect(invalid.stderr).toContain("Usage:");
});
it.each([["run", "--unknown"], ["run"], ["run", "--prompt", "x", "--prompt", "y"], ["wrong"]])(
  "returns usage exit2 for %j",
  async (...args) => {
    const result = await launch(args as string[]).result;
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Usage:");
  },
);
it("prints pretty one-line events and cleans resources on a failed provider", async () => {
  const { workbench } = await fixture();
  const good = await launch([...replay(workbench), "--format", "pretty"]).result;
  expect(good.code).toBe(0);
  expect(good.stdout).toContain("turn.done");
  expect(good.stdout).toContain('"stopReason":"end"');
  const failed = await launch([
    "run",
    "--workbench",
    workbench,
    "--prompt",
    "Read",
    "--provider",
    "openai",
    "--model",
    "gpt-4o",
  ]).result;
  expect(failed.code).toBe(1);
  expect(failed.stdout + failed.stderr).toContain("PROVIDER");
  await expect(readFile(join(workbench, ".vera/lock"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("scrubs environment/key-file secrets even in invalid arguments and explicit replay text", async () => {
  const { workbench, dir } = await fixture();
  const ambient = "fictional-env-key-15",
    key = "fictional-file-key-15";
  const file = join(dir, "key.txt"),
    script = join(dir, "secret.jsonl");
  await writeFile(file, `${key}\n`);
  await writeFile(script, `${JSON.stringify({ text: `${ambient} and ${key}` })}\n`);
  const result = await launch([...replay(workbench, script), "--key-file", file], { OPENAI_API_KEY: ambient })
    .result;
  expect(result.code).toBe(0);
  expect(result.stdout + result.stderr).not.toContain(ambient);
  expect(result.stdout + result.stderr).not.toContain(key);
  expect(result.stdout).toContain("[REDACTED]");
  const bad = await launch(["run", `--${ambient}`], { OPENAI_API_KEY: ambient }).result;
  expect(bad.code).toBe(2);
  expect(bad.stdout + bad.stderr).not.toContain(ambient);
  const invalidWithFile = await launch(["run", "--key-file", file, `--${key}`]).result;
  expect(invalidWithFile.code).toBe(2);
  expect(invalidWithFile.stderr).not.toContain(key);
});
it("rejects an irreducible first turn with structured CONTEXT_LIMIT and exit1", async () => {
  const { workbench } = await fixture();
  const args = replay(workbench);
  args[args.indexOf("--prompt") + 1] = "input".repeat(6000);
  const result = await launch(args).result;
  expect(result.code).toBe(1);
  expect(events(result.stdout).find((row) => row.event.type === "error").event).toMatchObject({
    code: "CONTEXT_LIMIT",
    messageKey: "context.budget_exceeded",
  });
  expect(events(result.stdout).find((row) => row.event.type === "turn.done").event.stopReason).toBe("limit");
});

async function endpoint(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  return `http://127.0.0.1:${address.port}/v1`;
}
const custom = (workbench: string, url: string, prompt = "Read the board") => [
  "run",
  "--workbench",
  workbench,
  "--prompt",
  prompt,
  "--provider",
  "custom",
  "--base-url",
  url,
  "--model",
  "org/model",
];
it.each([false, true])(
  "scrubs a forced provider error with key-file=%j and logs no secrets",
  async (fromFile) => {
    const { workbench, dir } = await fixture();
    const key = 'fictional-key-15-"\\escaped';
    const url = await endpoint((_req, res) => {
      res
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { message: `forced ${key}` } }));
    });
    const file = join(dir, "key.txt");
    await writeFile(file, `${key}\n`);
    const result = await launch(
      [...custom(workbench, url), ...(fromFile ? ["--key-file", file] : [])],
      fromFile ? {} : { OPENAI_API_KEY: key },
    ).result;
    expect(result.code).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain(key);
    expect(output).not.toContain(JSON.stringify(key).slice(1, -1));
    expect(
      events(result.stdout).some((row) => row.event.type === "error" && row.event.code === "PROVIDER"),
    ).toBe(true);
    await expect(readFile(join(workbench, ".vera/lock"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it("scrubs a streaming key split across provider chunks", async () => {
  const { workbench } = await fixture(),
    key = "fictional-cross-chunk-15";
  const url = await endpoint((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const text of [key.slice(0, 10), key.slice(10), " safe"])
      res.write(
        `data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
      );
    res.end(
      `data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  const result = await launch(custom(workbench, url), { OPENAI_API_KEY: key }).result;
  expect(result.code).toBe(0);
  const text = events(result.stdout)
    .filter((row) => row.event.type === "message.delta")
    .map((row) => row.event.text)
    .join("");
  expect(text).toBe("[REDACTED] safe");
});
it("budgets a long first turn before each real gateway request and refuses an irreducible request locally", async () => {
  const { workbench, dir } = await fixture();
  await writeFile(join(workbench, "large.txt"), "long source ".repeat(3000));
  const requests: { messages: { role: string; content: unknown }[]; max_tokens?: number }[] = [];
  const url = await endpoint((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const step = requests.length;
      const delta =
        step < 3
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${step}`,
                  type: "function",
                  function: { name: "read", arguments: JSON.stringify({ path: "large.txt" }) },
                },
              ],
            }
          : { content: "Budget respected." };
      res.end(
        `data: ${JSON.stringify({ id: `x${step}`, choices: [{ index: 0, delta, finish_reason: step < 3 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  const good = await launch(custom(workbench, url)).result;
  expect(good.code).toBe(0);
  expect(requests).toHaveLength(3);
  const usages = events(good.stdout)
    .filter((row) => row.event.type === "usage.updated" && row.event.contextTokens !== undefined)
    .map((row) => row.event);
  expect(usages).toHaveLength(3);
  expect(usages.every((usage) => usage.contextTokens <= usage.inputBudgetTokens)).toBe(true);
  expect(JSON.stringify(requests.slice(1))).toContain("context truncated");
  const transcriptFile = join(dir, "data", "settings.json");
  const bad = await launch([...custom(workbench, url, "input".repeat(6000)), "--data", join(dir, "data")])
    .result;
  expect(bad.code).toBe(1);
  expect(requests).toHaveLength(3);
  expect(bad.stdout).toContain("CONTEXT_LIMIT");
  expect(await readFile(transcriptFile, "utf8")).not.toContain("api_key");
});
it("times out real pathological grep at the production deadline then replaces the worker for a later grep", async () => {
  const { workbench, dir } = await fixture();
  await writeFile(join(workbench, "00-good.txt"), "ok\n");
  await writeFile(join(workbench, "99-bad.txt"), `${"a".repeat(30000)}!`);
  const script = join(dir, "timeout.jsonl");
  await writeFile(
    script,
    [
      {
        toolCalls: [
          { name: "grep", args: { pattern: "ok|(a+)+$", glob: "*good.txt", maxResults: 500 } },
          { name: "grep", args: { pattern: "(a+)+$", glob: "*bad.txt" } },
        ],
      },
      { toolCalls: [{ name: "grep", args: { pattern: "ok", glob: "00*" } }] },
      { text: "Worker recovered." },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const result = await launch(replay(workbench, script)).result;
  expect(result.code).toBe(0);
  const done = events(result.stdout)
    .filter((row) => row.event.type === "tool.done")
    .map((row) => row.event);
  expect(done).toHaveLength(3);
  expect(done[1].summary).toContain('"reason":"timeout"');
  expect(done[1].durationMs).toBeGreaterThanOrEqual(9500);
  expect(done[2]).toMatchObject({ ok: true });
  expect(done[2].summary).toContain("00-good.txt");
}, 25000);
it.skipIf(process.platform === "win32")(
  "aborts an active streamed turn on native SIGINT and removes its workbench lock",
  async () => {
    const { workbench } = await fixture();
    const url = await endpoint((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "Started" }, finish_reason: null }] })}\n\n`,
      );
    });
    const running = launch(custom(workbench, url));
    try {
      // Process startup is separate from the production turn/worker deadlines.
      await expect.poll(running.output, { timeout: 10000 }).toContain("turn.started");
      running.child.kill("SIGINT");
      const result = await running.result;
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('"stopReason":"aborted"');
      await expect(readFile(join(workbench, ".vera/lock"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      // Drain even after a readiness assertion fails, before suite bundle cleanup.
      if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGTERM");
      await running.result;
    }
  },
  20000,
);
it.each(["SIGINT", "SIGTERM"])(
  "drains an active real CLI process when its %s handler fires",
  async (signal) => {
    const { workbench } = await fixture();
    const url = await endpoint((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "Started" }, finish_reason: null }] })}\n\n`,
      );
    });
    const result = await launch(custom(workbench, url), { VERA_CLI_SIGNAL_TEST: signal }).result;
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"stopReason":"aborted"');
    await expect(readFile(join(workbench, ".vera/lock"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it("cleans owned temporary data/scripts on success and startup failure while retaining supplied data", async () => {
  const { workbench, dir } = await fixture();
  const temporary = join(dir, "owned");
  await mkdir(temporary);
  const env = { TMPDIR: temporary, TEMP: temporary, TMP: temporary };
  expect((await launch(replay(workbench), env).result).code).toBe(0);
  expect(await readdir(temporary)).toEqual([]);
  const failed = await launch(replay(workbench, join(dir, "missing.jsonl")), env).result;
  expect(failed.code).toBe(1);
  expect(await readdir(temporary)).toEqual([]);
  const supplied = join(dir, "supplied");
  await mkdir(supplied);
  await writeFile(join(supplied, "keep.txt"), "original");
  expect((await launch([...replay(workbench), "--data", supplied], env).result).code).toBe(0);
  expect(await readFile(join(supplied, "keep.txt"), "utf8")).toBe("original");
  expect(await readFile(join(supplied, "settings.json"), "utf8")).not.toContain("api_key");
  expect(await readdir(temporary)).toEqual([]);
});

// REQ-FUNC-13ab0001 REQ-SEC-13ab0002 REQ-SEC-13ab0003 REQ-FUNC-13ab0007
it("scoped CLI local Git clone and pulled helper require explicit machine hash review before real execution", async () => {
  const { dir, workbench: source } = await fixture(),
    bench = join(dir, "clone"),
    data = join(dir, "machine"),
    other = join(dir, "other-machine");
  await mkdir(join(source, ".vera/plugins"), { recursive: true });
  await cp(join(root, "tests/fixtures/plugins/echo-tools"), join(source, ".vera/plugins/echo-tools"), {
    recursive: true,
  });
  const config = join(source, ".vera/workbench.yaml");
  await writeFile(
    config,
    `${(await readFile(config, "utf8")).replace("permission_mode: ask", "permission_mode: bypass")}plugins:\n  enabled: [echo-tools]\n`,
  );
  const script = join(dir, "scoped.jsonl");
  await writeFile(
    script,
    [
      { toolCalls: [{ name: "load_skill", args: { name: "echo-guide" } }] },
      { toolCalls: [{ name: "run_program", args: { program: "echo", args: ["version"] } }] },
      { text: "Done" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n"),
  );
  const git = async (cwd: string, ...args: string[]) =>
    promisify(execFile)("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    });
  await git(source, "init");
  await git(source, "add", ".");
  await git(
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@invalid",
    "commit",
    "-m",
    "portable package",
  );
  await git(dir, "clone", "--local", source, bench);
  const command = async (action: string, extra: string[] = [], machine = data) =>
    launch(["plugin", action, "--workbench", bench, "--data", machine, ...extra], {
      VERA_TEST_NODE: process.execPath,
    }).result;
  const requests: string[] = [];
  const url = await endpoint((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body) as { messages: { role: string; content: unknown }[] };
      requests.push(JSON.stringify(payload.messages.filter((message) => message.role === "system")));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ id: "scoped", choices: [{ index: 0, delta: { content: "Ready" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "scoped", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  const prompt = async () => {
    const result = await launch([...custom(bench, url), "--data", data], {
      OPENAI_API_KEY: "fixture-scoped-local-only",
      VERA_TEST_NODE: process.execPath,
    }).result;
    expect(result.code).toBe(0);
    return requests.at(-1) ?? "";
  };
  const listed = await command("list");
  expect(listed.code).toBe(0);
  expect(JSON.parse(listed.stdout)).toMatchObject([
    { id: "echo-tools", source: "workbench", issues: [{ code: "untrusted" }] },
  ]);
  const run = async () =>
    launch([...replay(bench, script), "--data", data, "--approve", "all"], {
      VERA_TEST_NODE: process.execPath,
    }).result;
  const denied = await run();
  expect(denied.code).toBe(0);
  const deniedTools = events(denied.stdout).filter((row) => row.event.type === "tool.done");
  expect(deniedTools.map((row) => row.event.ok)).toEqual([false, false]);
  expect((await command("provision", ["--id", "echo-tools"])).code).toBe(1);
  const untrustedPrompt = await prompt();
  expect(untrustedPrompt).not.toContain("echo-guide");
  expect(untrustedPrompt).not.toContain("<programs>");
  const review = await command("review", ["--id", "echo-tools"]);
  expect(review.code).toBe(0);
  const hash = JSON.parse(review.stdout).sha256;
  expect((await command("trust", ["--id", "echo-tools", "--sha256", hash])).code).toBe(0);
  expect((await command("provision", ["--id", "echo-tools"])).code).toBe(0);
  const used = await run();
  expect(used.code).toBe(0);
  const trustedPrompt = await prompt();
  expect(trustedPrompt).toContain("echo-guide");
  expect(trustedPrompt).toContain("<programs>");
  const tools = events(used.stdout).filter((row) => row.event.type === "tool.done");
  expect(tools.map((row) => row.event.ok)).toEqual([true, true]);
  expect(String(tools[1]?.event.summary)).toContain('"exitCode":0');
  expect(String(tools[1]?.event.summary)).toContain("command");
  expect(JSON.parse((await command("list", [], other)).stdout)[0].issues).toContainEqual({
    code: "untrusted",
  });
  const helper = join(source, ".vera/plugins/echo-tools/echo.mjs");
  await writeFile(helper, `${await readFile(helper, "utf8")}\nconsole.log('PULLED-HELPER');\n`);
  await git(source, "add", ".");
  await git(
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@invalid",
    "commit",
    "-m",
    "helper change",
  );
  await git(bench, "pull", "--ff-only");
  expect(JSON.parse((await command("list")).stdout)[0].issues).toContainEqual({ code: "changed" });
  expect((await command("trust", ["--id", "echo-tools", "--sha256", hash])).code).toBe(1);
  const pulledDenied = await run();
  expect(
    events(pulledDenied.stdout)
      .filter((row) => row.event.type === "tool.done")
      .map((row) => row.event.ok),
  ).toEqual([false, false]);
  const changedPrompt = await prompt();
  expect(changedPrompt).not.toContain("echo-guide");
  expect(changedPrompt).not.toContain("<programs>");
  const nextHash = JSON.parse((await command("review", ["--id", "echo-tools"])).stdout).sha256;
  expect(nextHash).not.toBe(hash);
  expect((await command("trust", ["--id", "echo-tools", "--sha256", nextHash])).code).toBe(0);
  const after = await run();
  expect(
    events(after.stdout)
      .filter((row) => row.event.type === "tool.done")
      .at(-1)?.event.summary,
  ).toContain("PULLED-HELPER");
  expect((await git(bench, "status", "--porcelain", "--untracked-files=no")).stdout).toBe("");
}, 120000);
