import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = new URL("wireshark-tshark/", plugins);
const sample = fileURLToPath(new URL("../fixtures/wireshark-tshark/sample.pcapng", import.meta.url));
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));
const hint =
  "Install Wireshark (Windows: includes TShark and offers Npcap) from https://www.wireshark.org/download.html, or your distribution's tshark package.";

it("publishes the official find-only tshark package, its pack and two skills", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "wireshark-tshark",
    ecosystem: "wireshark",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(m.programs.tshark?.install).toEqual({
    find: { windows: ["%PATH%", "%ProgramFiles%/Wireshark/tshark.exe"], linux: ["$PATH", "/usr/bin/tshark"] },
    hint,
  });
  expect(m.programs.tshark?.version).toEqual({
    args: ["--version"],
    match: "^TShark \\(Wireshark\\) (\\d+\\.\\d+\\.\\d+)",
  });
  expect(m.programs.tshark?.optionSyntax).toBe("tshark");
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("wireshark-tshark");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs).toContainEqual({
    id: "wireshark",
    name: "Wireshark",
    groups: [{ name: "Capture analysis", plugins: ["wireshark-tshark"], default: true }],
  });
});

it("classifies parsed tshark option roles at the highest risk", async () => {
  const m = await manifest();
  const classify = (args: string[]) =>
    classifyCommand(m.rules, "tshark", args, m.programs.tshark?.optionSyntax);
  const cases = [
    // Information-only commands exit before any capture.
    ["safe", ["--version"]],
    ["safe", ["-v"]],
    ["safe", ["-nv"]],
    ["safe", ["-h"]],
    ["safe", ["--help"]],
    ["safe", ["--vers"]],
    ["safe", ["-D"]],
    ["safe", ["-nD"]],
    ["safe", ["--list-interfaces"]],
    ["safe", ["--list-i"]],
    ["safe", ["--list-sources"]],
    ["safe", ["-G", "protocols"]],
    ["safe", ["-G"]],
    ["safe", ["-n", "-G", "protocols"]],
    ["safe", ["-nGfields"]],
    // Reading a capture file, with every output and processing option.
    ["safe", ["-r", "cap.pcapng"]],
    ["safe", ["-rcap.pcapng"]],
    ["safe", ["--read-file", "cap.pcapng"]],
    ["safe", ["--read-file=cap.pcapng"]],
    ["safe", ["-nr", "cap.pcapng", "-Y", "coap"]],
    ["safe", ["-r", "cap.pcapng", "-T", "fields", "-e", "frame.number", "-E", "header=y"]],
    ["safe", ["-r", "cap.pcapng", "-q", "-z", "io,phs"]],
    ["safe", ["-r", "cap.pcapng", "-x", "-V", "-O", "coap"]],
    ["safe", ["-r", "cap.pcapng", "--hexdump", "frames"]],
    ["safe", ["-r", "cap.pcapng", "-2", "-R", "udp", "-w", "udp.pcapng"]],
    ["safe", ["-r", "cap.pcapng", "--export-objects", "http,objects"]],
    ["safe", ["-r", "cap.pcapng", "-o", "tcp.check_checksum:TRUE", "-d", "udp.port==5684,coap"]],
    ["safe", ["-r", "cap.pcapng", "-X", "read_format:pcapng"]],
    ["safe", ["-r", "cap.pcapng", "--selected-frame", "3", "--print-timers"]],
    ["safe", ["-r", "cap.pcapng", "-Y", "-i"]],
    ["safe", ["-r", "cap.pcapng", "-e", "-I"]],
    ["safe", ["-r", "cap.pcapng", "coap"]],
    ["safe", ["-r", "cap.pcapng", "--", "-v"]],
    // Live capture: an interface option, a link or timestamp type query, or no capture file at all.
    ["device-read", ["-i", "eth0"]],
    ["device-read", ["-ieth0"]],
    ["device-read", ["--interface", "eth0", "-c", "10"]],
    ["device-read", ["--interface=1", "-a", "duration:5", "-w", "live.pcapng"]],
    ["device-read", ["--inter=eth0"]],
    ["device-read", ["--source", "eth0"]],
    ["device-read", ["-ni", "eth0"]],
    ["device-read", ["-pI", "-i", "wlan0"]],
    ["device-read", ["-L", "-i", "eth0"]],
    ["device-read", ["--list-data-link-types"]],
    ["device-read", ["--list-time-stamp-types"]],
    ["device-read", ["--monitor-mode"]],
    ["device-read", ["-r", "cap.pcapng", "-i", "eth0"]],
    ["device-read", ["-c", "5"]],
    ["device-read", ["-Y", "coap"]],
    ["device-read", ["-n"]],
    ["device-read", []],
    ["device-read", ["udp", "port", "5683"]],
    ["device-read", ["foo", "-v"]],
    ["device-read", ["foo", "-r", "cap.pcapng"]],
    ["device-read", ["--", "-r", "cap.pcapng"]],
    ["device-read", ["-v", "-i", "eth0"]],
    ["device-read", ["-G", "protocols", "-i", "eth0"]],
    ["device-read", ["-r", "cap.pcapng", "coap", "-i", "eth0"]],
    ["device-read", ["-r", "cap.pcapng", "--", "--source=eth0"]],
    // Unrecognised or ambiguous options.
    ["device-write", ["-r", "cap.pcapng", "--log", "x"]],
    ["device-write", ["--read=cap.pcapng"]],
    ["device-write", ["-r", "cap.pcapng", "--no-such-option"]],
    ["device-write", ["-r", "cap.pcapng", "-k"]],
    ["device-write", ["-r", "cap.pcapng", "-Z", "user"]],
    // Lua scripts and command-line RPCAP credentials.
    ["blocked", ["-r", "cap.pcapng", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "-Xlua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "-X", "lua_script1:argument"]],
    ["blocked", ["-r", "cap.pcapng", "-Xlua_script1:argument"]],
    ["blocked", ["-nXlua_script1:argument", "-r", "cap.pcapng"]],
    ["blocked", ["-r", "cap.pcapng", "-X", "LUA_SCRIPT:dissector.lua"]],
    ["blocked", ["-nX", "lua_script:dissector.lua", "-r", "cap.pcapng"]],
    ["blocked", ["-v", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-G", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "coap", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "--", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-i", "rpcap://host/eth0", "-A", "user:secret"]],
    ["blocked", ["-Auser:secret", "-i", "rpcap://host/eth0"]],
    ["blocked", ["-r", "cap.pcapng", "coap", "-A", "user:secret"]],
  ] as const;
  for (const [risk, args] of cases) expect(classify([...args]).risk, args.join(" ")).toBe(risk);
  expect(classify(["-i", "eth0"]).notes.join(" ")).toContain("Npcap");
  expect(classify(["-r", "cap.pcapng", "-X", "lua_script:x.lua"]).notes.join(" ")).toContain("Lua");
});

const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
const version = "TShark (Wireshark) 4.6.8 (v4.6.8-0-ge677bf052328).\n";

it("finds tshark on PATH or in the Wireshark folder and shows the hint when it is missing", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-tshark-find-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("wireshark-tshark");
    const onPath = join(root, "bin");
    const programFiles = join(root, "Program Files");
    await mkdir(onPath);
    await mkdir(join(programFiles, "Wireshark"), { recursive: true });
    const spawned: string[] = [];
    const provisioner = (system: "win32" | "linux", env: Record<string, string>) =>
      new core.Provisioner({
        store,
        root: join(root, "runtime"),
        platform: system === "win32" ? "windows-x64" : "linux-x64",
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("tshark must never download");
        },
        host: {
          platform: system,
          env,
          spawn(executable, _args, options) {
            spawned.push(executable);
            options.output("stdout", Buffer.from(version));
            return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
          },
          signal: () => true,
        },
      });
    const missing = provisioner("win32", { PATH: join(root, "empty"), ProgramFiles: join(root, "empty") });
    expect(await missing.statuses("wireshark-tshark")).toEqual([
      {
        name: "tshark",
        kind: "find",
        state: "missing",
        problem: "notFound",
        hint,
        link: "https://www.wireshark.org/download.html",
      },
    ]);
    expect(await missing.resolve(plugin, "tshark")).toBeUndefined();
    expect(spawned).toEqual([]);
    missing.close();

    const standard = join(programFiles, "Wireshark", "tshark.exe");
    await writeFile(standard, "fixture");
    const installed = provisioner("win32", { PATH: join(root, "empty"), ProgramFiles: programFiles });
    expect(await installed.resolve(plugin, "tshark")).toMatchObject({
      executable: standard,
      version: "4.6.8",
    });
    installed.close();

    const path = join(onPath, "tshark.exe");
    await writeFile(path, "fixture");
    const first = provisioner("win32", { PATH: onPath, ProgramFiles: programFiles });
    expect(await first.resolve(plugin, "tshark")).toMatchObject({ executable: path, version: "4.6.8" });
    first.close();

    // A Linux PATH splits on ':', which a Windows drive letter would break.
    if (!windows) {
      const linux = join(onPath, "tshark");
      await writeFile(linux, "fixture", { mode: 0o755 });
      const onLinux = provisioner("linux", { PATH: onPath });
      expect(await onLinux.resolve(plugin, "tshark")).toMatchObject({ executable: linux, version: "4.6.8" });
      onLinux.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const step = (args: readonly string[]) => ({
  toolCalls: [{ name: "run_program", args: { program: "tshark", args } }],
});
const script = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n");

/**
 * A workbench with the catalog-installed plugin, its skills and the host's real tshark. The host keeps
 * PATH and ProgramFiles for discovery but isolates the personal Wireshark profile through HOME.
 */
async function workbench(scripts: Record<string, unknown[]>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-tshark-replay-")));
  const bench = join(root, "bench");
  const home = join(root, "home");
  const native = new core.NodeProcessHost(spawn);
  const starts: (readonly string[])[] = [];
  const host: core.ProcessHost = {
    platform: native.platform,
    env: { ...native.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData") },
    spawn(executable, args, options) {
      starts.push([...args]);
      return native.spawn(executable, args, options);
    },
    signal: native.signal.bind(native),
  };
  const runner = new core.ProgramRunner({ host, clock: { sleep } });
  const opened: {
    service?: core.SessionService;
    provisioner?: core.Provisioner;
    database?: Awaited<ReturnType<typeof core.openDb>>;
  } = {};
  const close = async () => {
    await opened.service?.close();
    await runner.stopAll();
    opened.provisioner?.close();
    opened.database?.close();
    await rm(root, { recursive: true, force: true });
  };
  await mkdir(join(bench, ".vera"), { recursive: true });
  await mkdir(join(bench, "captures"));
  await mkdir(home);
  await writeFile(join(bench, "captures/sample.pcapng"), await readFile(sample));
  await mkdir(join(root, "scripts"));
  for (const [name, items] of Object.entries(scripts))
    await writeFile(join(root, `scripts/${name}.jsonl`), script(items));
  const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
  expect(release.issues).toEqual([]);
  expect(release.index?.plugins.find((item) => item.id === "wireshark-tshark")?.tier).toBe("official");
  const store = new core.PluginStore({ root: join(root, "plugins") });
  await store.install(join(root, "release/wireshark-tshark-1.0.0.zip"));
  const plugin = await store.load("wireshark-tshark");
  const skills = new core.SkillCatalog({
    root: bench,
    disabled: () => [],
    plugins: async () => [{ id: "wireshark-tshark", folder: plugin.folder }],
  });
  const provisioner = new core.Provisioner({
    store,
    host,
    root: join(root, "runtime"),
    platform: windows ? "windows-x64" : "linux-x64",
    clock: { sleep },
    settings: () => undefined,
    fetch: async () => {
      throw Error("tshark must never download");
    },
  });
  opened.provisioner = provisioner;
  const tshark = await provisioner.resolve(plugin, "tshark");
  let model = "";
  const start = async () => {
    const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
    await gateway.models("replay", new AbortController().signal);
    opened.database = await core.openDb(join(bench, ".vera/vera.db"), {
      workbenchId: "wb_test",
      appVersion: "0",
    });
    opened.service = new core.SessionService({
      root: bench,
      db: opened.database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => model,
      prompt: () => "Use the Wireshark plugin",
      skills,
      programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver: provisioner },
    });
    await opened.service.waitReady();
    return opened.service;
  };
  const session = (service: core.SessionService, name: string, mode: "ask" | "bypass") => {
    model = `replay/${name}`;
    const created = service.create(null, mode);
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(created.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    const pending = () => service.get(created.id).snapshot.approvals.find((item) => !item.decision);
    return { id: created.id, outputs, pending };
  };
  return { skills, tshark, starts, start, session, close };
}

const results = (outputs: { summary: string }[]) =>
  outputs.map((output) => JSON.parse(output.summary) as { exitCode: number; output: string });

it("answers questions about the sample capture without approvals and gates live capture", async (ctx) => {
  const file = "captures/sample.pcapng";
  const questions = [
    ["-n", "-r", file],
    [
      "-nr",
      file,
      "-Y",
      "coap",
      "-T",
      "fields",
      "-e",
      "frame.number",
      "-e",
      "coap.opt.uri_path_recon",
      "-e",
      "coap.code",
    ],
    [
      "-nr",
      file,
      "-Y",
      "modbus.func_code == 3",
      "-T",
      "fields",
      "-e",
      "mbtcp.trans_id",
      "-e",
      "modbus.regval_uint16",
    ],
    ["-nr", file, "-q", "-z", "io,phs"],
    ["-nr", file, "-q", "-z", "conv,udp"],
  ];
  const bench = await workbench({
    analyze: [
      ...questions.map(step),
      step(["-i", "1", "-c", "5"]),
      { text: "The board answered two CoAP reads and one Modbus read." },
    ],
    lua: [
      step(["-r", file, "-X", "lua_script:dissector.lua"]),
      step(["-r", file, "-A", "user:secret"]),
      { text: "Refused." },
    ],
  });
  try {
    // The installed skills carry the analysis and bounded-capture guidance without a tshark.
    const listed = (await bench.skills.list()).filter((skill) => skill.plugin === "wireshark-tshark");
    expect(listed.map((skill) => skill.name)).toEqual(["wireshark-analyze", "wireshark-capture"]);
    const analyze = (await bench.skills.read("plugin", "wireshark-analyze")).content;
    for (const text of ["-r captures/", "-n", "-Y ", "-T fields -e ", "-z io,phs", "-z conv,udp", "-c"])
      expect(analyze).toContain(text);
    const capture = (await bench.skills.read("plugin", "wireshark-capture")).content;
    for (const text of ["tshark -D", "-a duration:", "-c ", "-f ", "-w captures/"])
      expect(capture).toContain(text);
    if (!bench.tshark) {
      ctx.skip("tshark is not installed on this host; the capture-file acceptance needs a real tshark");
      return;
    }
    const service = await bench.start();
    const analysis = bench.session(service, "analyze", "ask");
    const start = bench.starts.length;
    service.send(analysis.id, "What did the board answer in captures/sample.pcapng?");
    await expect.poll(analysis.pending, { timeout: 120_000 }).toBeDefined();
    const approval = analysis.pending();
    if (!approval) throw Error("Expected the live capture approval");
    expect(approval.program).toMatchObject({
      program: "tshark",
      risk: "device-read",
      args: ["-i", "1", "-c", "5"],
    });
    expect(service.get(analysis.id).snapshot.approvals).toHaveLength(1);
    expect(analysis.outputs).toHaveLength(questions.length);
    const answers = results(analysis.outputs);
    for (const answer of answers) expect(answer.exitCode, answer.output).toBe(0);
    expect(answers[0]?.output).toContain("/sensors/temp");
    expect(answers[1]?.output).toMatch(/3\t\/sensors\/temp\t1/);
    expect(answers[1]?.output).toMatch(/8\t\/sensors\/humidity\t69/);
    expect(answers[2]?.output).toContain("1\t235,258");
    expect(answers[3]?.output).toMatch(/coap\s+frames:4/);
    expect(answers[3]?.output).toMatch(/modbus\s+frames:2/);
    expect(answers[4]?.output).toContain("192.168.7.10:5683");
    expect(bench.starts.slice(start)).toHaveLength(questions.length);
    service.decideApproval({
      sessionId: analysis.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision: "denied",
    });
    expect(await service.waitIdle(analysis.id)).toEqual({ stopReason: "end" });
    // The denied live capture never started a process.
    expect(bench.starts.slice(start)).toHaveLength(questions.length);

    const blocked = bench.session(service, "lua", "bypass");
    const before = bench.starts.length;
    service.send(blocked.id, "Load the Lua dissector");
    expect(await service.waitIdle(blocked.id)).toEqual({ stopReason: "end" });
    expect(blocked.outputs.map((output) => output.ok)).toEqual([false, false]);
    expect(service.get(blocked.id).snapshot.approvals).toEqual([]);
    expect(bench.starts).toHaveLength(before);
  } finally {
    await bench.close();
  }
}, 240_000);

// Opt-in: VERA_TSHARK_LIVE_INTERFACE names a loopback interface (\Device\NPF_Loopback with Npcap, lo on
// Linux with dumpcap permissions). The test sends its own UDP datagrams to 127.0.0.1 and captures only them.
const live = process.env.VERA_TSHARK_LIVE_INTERFACE;
it.skipIf(!live)(
  "captures live loopback traffic after the device-read approval",
  async () => {
    const port = 59999;
    const capture = [
      "-n",
      "-i",
      live ?? "",
      "-f",
      `udp port ${port}`,
      "-c",
      "3",
      "-a",
      "duration:30",
      "-w",
      "captures/live.pcapng",
    ];
    const readBack = ["-nr", "captures/live.pcapng", "-T", "fields", "-e", "udp.dstport", "-e", "data.data"];
    const bench = await workbench({
      live: [step(capture), step(readBack), { text: "Captured three datagrams." }],
    });
    const socket = createSocket("udp4");
    try {
      if (!bench.tshark) throw Error("VERA_TSHARK_LIVE_INTERFACE needs an installed tshark");
      const service = await bench.start();
      const session = bench.session(service, "live", "ask");
      const before = bench.starts.length;
      service.send(session.id, "Capture three loopback datagrams.");
      await expect.poll(session.pending, { timeout: 60_000 }).toBeDefined();
      const approval = session.pending();
      if (!approval) throw Error("Expected the live capture approval");
      expect(approval.program).toMatchObject({ program: "tshark", risk: "device-read", args: capture });
      expect(bench.starts).toHaveLength(before);
      service.decideApproval({
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
      });
      // tshark needs a moment to open the interface; keep sending until the bounded capture ends.
      for (let index = 0; session.outputs.length === 0 && index < 120; index++) {
        socket.send(`vera-live-${index}`, port, "127.0.0.1");
        await sleep(250);
      }
      expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
      const [captured, read] = results(session.outputs);
      expect(captured?.exitCode, captured?.output).toBe(0);
      expect(captured?.output).toContain("3 packets captured");
      expect(read?.exitCode, read?.output).toBe(0);
      const lines = (read?.output ?? "").trim().split(/\r?\n/);
      expect(lines).toHaveLength(3);
      for (const line of lines)
        expect(line).toMatch(new RegExp(`^${port}\\t${Buffer.from("vera-live-").toString("hex")}`));
      if (evidence)
        await writeFile(
          join(evidence, `${process.platform}-tshark-live.json`),
          JSON.stringify({ approval: approval.program, outputs: session.outputs }, null, 2),
        );
    } finally {
      socket.close();
      await bench.close();
    }
  },
  180_000,
);
