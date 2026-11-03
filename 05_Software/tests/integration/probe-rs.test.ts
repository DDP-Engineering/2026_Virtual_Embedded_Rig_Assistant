import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  classifyCommand,
  type PluginManifest,
  type SessionEvent,
  validatePluginManifest,
} from "@vera/shared";
import { afterAll, expect, it } from "vitest";
import { parse } from "yaml";

const software = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(software, "plugins/probe-rs");
const windows = process.platform === "win32";
const platform = windows ? "windows-x64" : "linux-x64";
const roots: string[] = [];
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const id = (n: number) => `01JB8Z6Q4M7N2K5R9T3V8X1Y${String(n).padStart(2, "0")}`;
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function temp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-plg19-")));
  roots.push(root);
  return root;
}
async function manifest(): Promise<PluginManifest> {
  return parse(await readFile(join(source, "plugin.yaml"), "utf8"));
}

it("declares pinned official archives, find precedence and exact supported version", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(Object.keys(m.programs)).toEqual(["probe-rs"]);
  expect(m.platforms).toEqual(["windows-x64", "linux-x64", "linux-arm64"]);
  const p = m.programs["probe-rs"];
  expect(p?.version).toEqual({
    args: ["--version"],
    match: "probe-rs (\\d+\\.\\d+\\.\\d+)",
    range: "==0.32.0",
  });
  expect(p?.timeout).toBe(120);
  if (!p || !("find" in p.install) || !p.install.download) throw Error("combined sources");
  expect(p.install.find).toEqual({ windows: ["%PATH%", "~/.cargo/bin"], linux: ["$PATH", "~/.cargo/bin"] });
  const entries = [
    [
      "windows-x64",
      "probe-rs-tools-x86_64-pc-windows-msvc.zip",
      "56fc0564cc23d604b27dc2d57606194159c49f951999f3e47bd2cbffcba64103",
      "probe-rs.exe",
    ],
    [
      "linux-x64",
      "probe-rs-tools-x86_64-unknown-linux-gnu.tar.xz",
      "c2ccc46049e52a5d403ef212078cd637ecda55b662708327960558f83e851ff5",
      "probe-rs-tools-x86_64-unknown-linux-gnu/probe-rs",
    ],
    [
      "linux-arm64",
      "probe-rs-tools-aarch64-unknown-linux-gnu.tar.xz",
      "7c818cfd77808e806bf8f4d108c9137910b4fb28e0fe5c464d39782dbbc8af31",
      "probe-rs-tools-aarch64-unknown-linux-gnu/probe-rs",
    ],
  ];
  expect(Object.entries(p.install.download)).toHaveLength(3);
  for (const [key, file, sha256, path] of entries)
    expect(p.install.download[key as keyof typeof p.install.download]).toEqual({
      url: `https://github.com/probe-rs/probe-rs/releases/download/v0.32.0/${file}`,
      sha256,
      path,
    });
});

it("covers every risk row, global options, equals syntax and highest-risk escalation", async () => {
  const m = await manifest();
  const classify = (...args: string[]) => classifyCommand(m.rules, "probe-rs", args);
  const rows = [
    ["safe", ["--version", "-V", "--help", "-h", "help", "chip", "list"]],
    ["device-read", ["info", "mi", "read", "verify", "attach", "profile", "trace", "reset"]],
    ["device-write", ["download", "run", "erase", "benchmark", "itm"]],
    ["irreversible", ["write"]],
    ["blocked", ["debug", "gdb", "dap-server", "serve", "complete"]],
  ] as const;
  for (const [risk, commands] of rows)
    for (const command of commands)
      for (const args of [[command], ["--log-file", "probe.log", command], [command, "--help"]]) {
        expect(classify(...args).risk, args.join(" ")).toBe(risk);
        if (risk !== "safe") expect(classify(...args).notes.join(" ").length).toBeGreaterThan(10);
      }
  for (const width of ["b8", "b16", "b32", "b64"]) {
    expect(classify("write", width, "0x40000000", "1")).toMatchObject({
      risk: "irreversible",
      confirm: "write",
    });
    expect(classify("--log-file", "x", "write", width, "0x40000000", "1")).toMatchObject({
      risk: "irreversible",
      confirm: "write",
    });
  }
  expect(classify("write").notes.join(" ")).toMatch(/option register/);
  expect(classify("write").notes.join(" ")).toMatch(/GPIO/);
  expect(classify("reset").notes.join(" ")).toMatch(/Resets/);
  for (const command of ["--version", "help", "chip", "list", "info", "read", "download", "run", "write"])
    for (const args of [
      ["--host", "remote", command],
      [command, "--host", "remote"],
      [command, "--host=remote"],
      [command, "--host"],
    ])
      expect(classify(...args), args.join(" ")).toMatchObject({ risk: "blocked", confirm: null });
  expect(classify("help", "write").risk).toBe("irreversible");
  expect(classify("help", "serve").risk).toBe("blocked");
  expect(classify("unknown")).toMatchObject({ risk: "device-write", notes: [] });
  for (const args of [
    ["itm", "memory", "16000000", "--log-file", "list"],
    ["itm", "--log-file=chip", "memory", "16000000"],
    ["--log-file", "help", "itm", "swo", "1000", "80000000", "2000000"],
  ])
    expect(classify(...args).risk, args.join(" ")).toBe("device-write");
  const help = await readFile(join(software, "tests/fixtures/probe-rs/probe-rs-0.32.0-help.txt"), "utf8");
  const commands = [...help.matchAll(/^ {2}([a-z][a-z-]*) {2,}/gm)].map((m) => m[1] as string);
  expect(commands).toContain("itm");
  expect(commands.length).toBeGreaterThanOrEqual(20);
  // Explicit coverage keeps a safe option value from overriding the fallback of a real hardware command.
  for (const command of commands) {
    expect(
      m.rules.some((r) =>
        classifyCommand([{ ...r, note: "command-hit" }], "probe-rs", [command]).notes.includes("command-hit"),
      ),
      command,
    ).toBe(true);
    const base = classify(command).risk;
    for (const name of ["help", "chip", "list"])
      expect(classify(command, "--log-file", name).risk, `${command} --log-file ${name}`).toBe(base);
  }
  // Every declared rule must actually match a representative line (rather than the default).
  for (const rule of m.rules) {
    const token = rule.match.split(/\s+/).find((s) => s !== "probe-rs" && s !== "*");
    const command = token?.replace(/[{}]/g, "").split(",")[0];
    expect(
      classifyCommand([{ ...rule, note: "row-hit" }], "probe-rs", [command as string]).notes,
      rule.match,
    ).toContain("row-hit");
  }
});

it("loads four installed skills and includes the plugin in the official catalog", async () => {
  const root = await temp();
  const store = new core.PluginStore({ root: join(root, "plugins") });
  await store.install(source);
  const plugin = await store.load("probe-rs");
  const skills = new core.SkillCatalog({
    root,
    disabled: () => [],
    plugins: async () => [{ id: "probe-rs", folder: plugin.folder }],
  });
  expect((await skills.list()).filter((s) => s.plugin === "probe-rs").map((s) => s.name)).toEqual([
    "probe-rs-connect",
    "probe-rs-flash",
    "probe-rs-inspect",
    "probe-rs-rtt",
  ]);
  const checks = {
    "probe-rs-connect": [
      "--non-interactive",
      "--probe",
      "--chip",
      "chip info",
      "69-probe-rs.rules",
      "plugdev",
      "STSW-LINK009",
      "J-Link Configurator",
      "Zadig",
      "CMSIS-DAP",
    ],
    "probe-rs-flash": ["download", "verify", "reset", "ELF", "SHA-256", "approval", "--binary-format elf"],
    "probe-rs-rtt": [
      "background: true",
      "program_output",
      "until",
      "program_stop",
      "stdin",
      "down channel",
      "--scan-region",
      "run",
      "attach",
    ],
    "probe-rs-inspect": [
      "read b32",
      "hex-table",
      "simple-hex",
      "decode_register",
      "CAP-02",
      "SVD",
      "PC",
      "LR",
      "arm-none-eabi-addr2line",
      "riscv-none-elf-addr2line",
    ],
  };
  for (const [name, words] of Object.entries(checks)) {
    const body = (await skills.read("plugin", name)).content;
    for (const word of words) expect(body, `${name}: ${word}`).toContain(word);
  }
  const catalog = parse(await readFile(join(software, "plugins/catalog.yaml"), "utf8"));
  expect(catalog.official).toContain("probe-rs");
  expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
});

it("finds PATH before cargo, never installs implicitly and rejects an unsupported found version", async () => {
  const root = await temp();
  const store = new core.PluginStore({ root: join(root, "plugins") });
  await store.install(source);
  const exe = windows ? "probe-rs.exe" : "probe-rs";
  const paths = [join(root, "path", exe), join(root, ".cargo/bin", exe)];
  for (const path of paths) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "fake", { mode: 0o755 });
  }
  const probes: string[] = [];
  let version = "0.32.0";
  const host: core.ProcessHost = {
    platform: windows ? "win32" : "linux",
    env: { PATH: join(root, "path"), HOME: root, USERPROFILE: root },
    spawn(executable, args, options) {
      probes.push(executable);
      expect(args).toEqual(["--version"]);
      options.output("stdout", Buffer.from(`probe-rs ${version} (git commit: test)\n`));
      return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
    },
    signal: () => true,
  };
  const provisioner = new core.Provisioner({
    store,
    root: join(root, "runtime"),
    host,
    clock: { sleep },
    platform,
    settings: () => undefined,
    fetch: async () => {
      throw Error("unexpected download");
    },
  });
  try {
    const plugin = await store.load("probe-rs");
    for (const path of paths) {
      expect(await provisioner.resolve(plugin, "probe-rs")).toMatchObject({
        executable: path,
        version: "0.32.0",
      });
      version = "0.31.0";
      provisioner.invalidate();
      expect(await provisioner.statuses("probe-rs")).toMatchObject([
        { state: "unavailable", problem: "range", version },
      ]);
      expect(await provisioner.resolve(plugin, "probe-rs")).toBeUndefined();
      expect(await provisioner.install("probe-rs")).toMatchObject([
        { state: "unavailable", problem: "range" },
      ]);
      version = "0.32.0";
      await rm(path);
      provisioner.invalidate();
    }
    expect(await provisioner.resolve(plugin, "probe-rs")).toBeUndefined();
    expect(await provisioner.statuses("probe-rs")).toMatchObject([{ state: "missing" }]);
    expect([...new Set(probes)]).toEqual(paths);
    expect((await store.load("probe-rs")).record.programs).toEqual({});
  } finally {
    provisioner.close();
  }
});

const run = (args: string[], background = false) => ({
  toolCalls: [{ name: "run_program", args: { program: "probe-rs", args, background } }],
});
async function replay(steps: object[]) {
  const root = await temp();
  const bench = join(root, "bench");
  await mkdir(join(bench, ".vera"), { recursive: true });
  await mkdir(join(bench, "build"));
  await cp(join(software, "tests/fixtures/elf/arm-none-eabi-after.elf"), join(bench, "build/app.elf"));
  const store = new core.PluginStore({ root: join(root, "plugins") });
  await store.install(source);
  let n = 0;
  const runner = new core.ProgramRunner({
    host: new core.NodeProcessHost(spawn),
    clock: { sleep },
    id: () => id(++n),
  });
  const plugin = await store.load("probe-rs");
  plugin.record.programs["probe-rs"] = "0.32.0";
  const programs: core.ProgramHost = {
    runner,
    clock: { sleep },
    plugins: async () => [plugin],
    resolver: {
      resolve: async () => ({
        executable: process.execPath,
        prefix: [join(software, "tests/fixtures/probe-rs/replay.mjs")],
        version: "0.32.0",
      }),
    },
  };
  const skills = new core.SkillCatalog({
    root: bench,
    disabled: () => [],
    plugins: async () => [{ id: "probe-rs", folder: plugin.folder }],
  });
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "scripts/probe.jsonl"), steps.map((s) => JSON.stringify(s)).join("\n"));
  const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
  await gateway.models("replay", new AbortController().signal);
  const db = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const service = new core.SessionService({
    root: bench,
    db: db.db,
    gateway,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/probe",
    prompt: () => "Test probe-rs",
    skills,
    programs,
  });
  await service.waitReady();
  const session = service.create(null, "auto-edit");
  const events: SessionEvent[] = [];
  service.subscribe(session.id, 0, (_seq, event) => events.push(event));
  const pending = async () => {
    await expect
      .poll(() => service.get(session.id).snapshot.approvals.find((a) => !a.decision), { timeout: 10_000 })
      .toBeDefined();
    const a = service.get(session.id).snapshot.approvals.find((a) => !a.decision);
    if (!a) throw Error("approval missing");
    return a;
  };
  return {
    root,
    bench,
    runner,
    service,
    session,
    events,
    pending,
    approve: (a: Awaited<ReturnType<typeof pending>>) =>
      service.decideApproval({
        sessionId: session.id,
        approvalId: a.approvalId,
        requestSha256: a.requestSha256,
        decision: "approved",
      }),
    close: async () => {
      await service.close();
      await runner.stopAll();
      db.close();
    },
  };
}

it.each(["attach", "run"])(
  "replays exact-ELF approval, register read and closed-stdin background %s RTT",
  async (command) => {
    const select = ["--chip", "STM32F401RETx", "--probe", "0483:374b:FIXTURE", "--non-interactive"];
    const rig = await replay([
      ...["probe-rs-connect", "probe-rs-flash", "probe-rs-inspect", "probe-rs-rtt"].map((name) => ({
        toolCalls: [{ name: "load_skill", args: { name } }],
      })),
      run(["list"]),
      run(["info", ...select]),
      run(["download", ...select, "--binary-format", "elf", "build/app.elf"]),
      run(["verify", ...select, "--binary-format", "elf", "build/app.elf"]),
      run(["reset", ...select]),
      run(["read", ...select, "b32", "0x40000000", "1", "--format", "hex-table"]),
      run([command, ...select, "build/app.elf"], true),
      { toolCalls: [{ name: "program_output", args: { handle: id(7), until: "RTT ready", waitMs: 5000 } }] },
      { toolCalls: [{ name: "program_stop", args: { handle: id(7) } }] },
      { text: "Fixture workflow completed" },
    ]);
    try {
      rig.service.send(rig.session.id, "Flash the identified fixture, read one register and monitor RTT");
      const flash = await rig.pending();
      const hash = createHash("sha256")
        .update(await readFile(join(rig.bench, "build/app.elf")))
        .digest("hex");
      expect(flash.program).toMatchObject({
        risk: "device-write",
        programVersion: "0.32.0",
        files: [{ path: "build/app.elf", sha256: hash }],
      });
      rig.approve(flash);
      if (command === "run") {
        const rtt = await rig.pending();
        expect(rtt.program).toMatchObject({
          risk: "device-write",
          files: [{ path: "build/app.elf", sha256: hash }],
        });
        rig.approve(rtt);
      }
      expect(await rig.service.waitIdle(rig.session.id)).toEqual({ stopReason: "end" });
      const done = rig.events.filter((e) => e.type === "tool.done");
      expect(done).toHaveLength(13);
      for (const d of done) expect(d.ok, d.summary).toBe(true);
      const text = done.map((d) => d.summary).join("\n");
      for (const word of [
        "Fixture ST-Link",
        "STM32F401RETx",
        "Verified",
        "40000000: 12345678",
        "stdin:closed",
        "RTT ready",
        '"matched":true',
        '"stopped":true',
      ])
        expect(text).toContain(word);
      const logs = await rig.runner.list(rig.bench);
      expect(logs).toHaveLength(7);
      expect(logs.find((r) => r.id === id(7))).toMatchObject({ state: "stopped" });
      const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
      if (evidence) {
        const target = join(evidence, `${process.platform}-replay-${command}`);
        await mkdir(target, { recursive: true });
        await cp(join(rig.bench, ".vera/runs"), join(target, "runs"), { recursive: true });
        await writeFile(join(target, "events.json"), JSON.stringify(rig.events, null, 2));
      }
    } finally {
      await rig.close();
    }
  },
  30_000,
);

it("refuses flashing an ELF changed after the approval was prepared", async () => {
  const rig = await replay([run(["download", "--chip", "STM32F401RETx", "build/app.elf"]), { text: "Done" }]);
  try {
    rig.service.send(rig.session.id, "Flash fixture");
    const approval = await rig.pending();
    await writeFile(join(rig.bench, "build/app.elf"), "rebuilt");
    rig.approve(approval);
    await rig.service.waitIdle(rig.session.id);
    expect(rig.events.filter((e) => e.type === "tool.done")).toEqual([
      expect.objectContaining({ ok: false, summary: expect.stringMatching(/changed after approval/) }),
    ]);
    expect(await rig.runner.list(rig.bench)).toEqual([]);
  } finally {
    await rig.close();
  }
});

// Genuine release archives are opt-in, local transport only; ordinary tests never need network/hardware.
const archives = process.env.VERA_PROBE_RS_ARCHIVES;
it.skipIf(!archives)(
  "provisions and runs the real downloaded and found 0.32.0 CLI offline",
  async () => {
    const root = await temp();
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const plugin = await store.load("probe-rs");
    const native = new core.NodeProcessHost(spawn);
    const downloads: string[] = [];
    const env = { ...native.env, HOME: join(root, "home"), USERPROFILE: join(root, "home"), PATH: "" };
    const host: core.ProcessHost = {
      platform: native.platform,
      env,
      spawn: native.spawn.bind(native),
      signal: native.signal.bind(native),
    };
    const make = () =>
      new core.Provisioner({
        store,
        root: join(root, "runtime"),
        host,
        clock: { sleep },
        platform,
        settings: () => undefined,
        fetch: async (url) => {
          downloads.push(url);
          return new Response(
            Readable.toWeb(
              createReadStream(join(archives as string, basename(new URL(url).pathname))),
            ) as ReadableStream<Uint8Array>,
          );
        },
      });
    let provisioner = make();
    const runner = new core.ProgramRunner({ host: native, clock: { sleep } });
    await mkdir(join(root, "bench/.vera"), { recursive: true });
    try {
      expect(await provisioner.resolve(plugin, "probe-rs")).toBeUndefined();
      expect(downloads).toEqual([]);
      expect(await provisioner.install("probe-rs")).toMatchObject([{ state: "ready", version: "0.32.0" }]);
      const installed = await provisioner.resolve(await store.load("probe-rs"), "probe-rs");
      if (!installed) throw Error("not provisioned");
      for (const mode of ["downloaded", "found"]) {
        if (mode === "found") {
          provisioner.close();
          env.PATH = dirname(installed.executable);
          provisioner = make();
        }
        const resolved = await provisioner.resolve(await store.load("probe-rs"), "probe-rs");
        expect(resolved).toMatchObject({ executable: installed.executable, version: "0.32.0" });
        const results = [];
        for (const args of [
          ["--version"],
          ["read", "--help"],
          ["write", "--help"],
          ["attach", "--help"],
          ["chip", "info", "esp32s3"],
          ["chip", "info", "esp32c3"],
          ["list"],
        ]) {
          const run = await runner.start({
            sessionId: "native",
            workbench: join(root, "bench"),
            executable: resolved?.executable as string,
            args,
            timeoutMs: 30_000,
          });
          const result = await run.done;
          expect(result.exitCode, result.output).toBe(0);
          results.push({ args, ...result });
          if (args[0] === "read") expect(result.output).toContain("[default: hex-table]");
        }
        const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
        if (evidence) {
          await mkdir(evidence, { recursive: true });
          await writeFile(
            join(evidence, `${process.platform}-real-${mode}.json`),
            JSON.stringify(results, null, 2),
          );
        }
      }
      expect(downloads).toHaveLength(1);
    } finally {
      provisioner.close();
      await runner.stopAll();
    }
  },
  120_000,
);
