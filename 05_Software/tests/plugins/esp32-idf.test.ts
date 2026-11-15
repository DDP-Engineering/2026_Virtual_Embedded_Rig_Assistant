// Deterministic vendor replay is not ESP-IDF toolchain or hardware acceptance.
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  classifyCommand,
  type PermissionMode,
  type PluginManifest,
  type SessionEvent,
  validatePluginManifest,
} from "@vera/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parse } from "yaml";

const software = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(software, "plugins/esp32-idf");
const windows = process.platform === "win32";
const python = spawnSync(
  process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3"),
  ["-c", "import sys; print(sys.executable)"],
  { encoding: "utf8" },
).stdout.trim();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
let base: string;
let manifest: PluginManifest;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "vera-esp32-idf-")));
  manifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

it("ships the vendor find declarations and both skills (REQ-FUNC-10e10007)", async () => {
  expect(validatePluginManifest(manifest).issues).toEqual([]);
  expect(manifest).toMatchObject({
    format: 1,
    id: "esp32-idf",
    requires: ["serial-monitor"],
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(manifest.programs["idf.py"]).toMatchObject({
    launcher: ["eim", "run"],
    launcherMode: "string",
    version: { range: ">=5.4,<7" },
    timeout: 1200,
  });
  for (const name of ["xtensa-addr2line", "riscv-addr2line"])
    expect(manifest.programs[name]?.install).toHaveProperty("find");
  const store = new core.PluginStore({ root: join(base, "package-store") });
  await store.install(source);
  const plugin = await store.load("esp32-idf");
  const skills = new core.SkillCatalog({
    root: base,
    disabled: () => [],
    plugins: async () => [{ id: "esp32-idf", folder: plugin.folder }],
  });
  expect((await skills.list()).filter((s) => s.plugin === "esp32-idf").map((s) => s.name)).toEqual([
    "esp32-build-fix",
    "esp32-panic",
  ]);
  const build = (await skills.read("plugin", "esp32-build-fix")).content;
  expect(build).toContain("sdkconfig.defaults");
  expect(build).toContain("Never edit `sdkconfig`");
  const panic = (await skills.read("plugin", "esp32-panic")).content;
  for (const word of [
    "Guru Meditation",
    "ELF",
    "xtensa-addr2line",
    "riscv-addr2line",
    "coredump-info",
    "serial",
  ])
    expect(panic).toContain(word);
  expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
});

it("classifies every planned IDF command and mixed action (REQ-SEC-10e10008)", () => {
  const cases = {
    safe: ["set-target", "build", "size", "size-components", "size-files", "fullclean", "reconfigure"],
    "device-read": ["coredump-info"],
    "device-write": ["flash", "app-flash", "erase-flash", "erase-otadata", "unknown-command"],
    irreversible: ["efuse-burn", "secure-boot"],
    blocked: ["monitor", "menuconfig", "gdb", "gdbtui"],
  };
  for (const [risk, commands] of Object.entries(cases))
    for (const name of commands) {
      for (const args of [[name], ["-p", "COM7", name], [name.replaceAll("-", "_")]]) {
        const result = classifyCommand(manifest.rules, "idf.py", args);
        expect(result.risk, args.join(" ")).toBe(risk);
        if (risk === "irreversible") expect(result.confirm).toBe(name);
      }
    }
  expect(classifyCommand(manifest.rules, "idf.py", ["build", "flash"]).risk).toBe("device-write");
  expect(classifyCommand(manifest.rules, "idf.py", ["build", "monitor"]).risk).toBe("blocked");
  for (const name of ["xtensa-addr2line", "riscv-addr2line"])
    expect(classifyCommand(manifest.rules, name, ["-pfiaC", "-e", "build/app.elf", "0x400d1234"]).risk).toBe(
      "safe",
    );
});

async function rig(mode: PermissionMode, steps: object[]) {
  const dir = await mkdtemp(join(base, "run-"));
  const bin = join(dir, "bin");
  await mkdir(bin);
  const setup = spawnSync(python, [join(software, "tests/fixtures/esp32-idf/make_vendor.py"), bin], {
    encoding: "utf8",
  });
  if (setup.status !== 0) throw Error(setup.stderr);
  const host = new core.NodeProcessHost(spawn);
  const probeOutput: string[] = [];
  // Real provisioner searches only the test vendor PATH; all network is refused.
  const vendorHost: core.ProcessHost = {
    platform: host.platform,
    env: {
      ...Object.fromEntries(Object.entries(host.env).filter(([key]) => key.toUpperCase() !== "PATH")),
      PATH: `${bin}${windows ? ";" : ":"}${host.env.PATH ?? host.env.Path ?? ""}`,
    },
    spawn: (executable, args, options) =>
      host.spawn(executable, args, {
        ...options,
        output: (stream, bytes) => {
          probeOutput.push(Buffer.from(bytes).toString());
          options.output(stream, bytes);
        },
      }),
    signal: host.signal.bind(host),
  };
  const store = new core.PluginStore({ root: join(dir, "plugins") });
  await store.install(source);
  await store.install(join(software, "plugins/serial-monitor"));
  const uv = join(dir, "fake_uv.py");
  await writeFile(
    uv,
    [
      "import os, runpy, sys",
      "sys.dont_write_bytecode = True",
      "args = sys.argv[1:]",
      'if args[:2] == ["sync", "--script"]: sys.exit(0)',
      'assert args[:4] == ["run", "--quiet", "--offline", "--script"], args',
      `os.environ.update(${JSON.stringify({ FAKE_SERIAL_SCENARIO: join(dir, "scenario.json"), FAKE_SERIAL_RECORD: join(dir, "serial.jsonl"), PYTHONDONTWRITEBYTECODE: "1" })})`,
      `sys.path.insert(0, ${JSON.stringify(join(software, "tests/fixtures/serial-monitor/fake-pyserial"))})`,
      "sys.argv = args[4:]",
      'runpy.run_path(args[4], run_name="__main__")',
    ].join("\n"),
  );
  await writeFile(
    join(dir, "scenario.json"),
    JSON.stringify({
      ports: [{ device: "COM7", vid: 0x303a, pid: 0x1001, description: "Fixture ESP32-S3" }],
      chunks: [
        "Guru Meditation Error: Core 0 panic'ed (LoadProhibited).\r\n",
        "Backtrace: 0x400d1234:0x3ffb0000\r\n",
        "PANIC END\r\n",
      ],
    }),
  );
  const provisioner = new core.Provisioner({
    store,
    root: join(dir, "runtime"),
    uv: { executable: python, prefix: [uv] },
    host: vendorHost,
    clock: { sleep },
    platform: core.pluginPlatform(process.platform, process.arch),
    fetch: async () => {
      throw Error("offline");
    },
    settings: () => undefined,
  });
  const statuses = await provisioner.statuses("esp32-idf");
  expect(
    statuses.map((s) => [s.name, s.state]),
    JSON.stringify({ statuses, probeOutput }),
  ).toEqual([
    ["idf.py", "ready"],
    ["riscv-addr2line", "ready"],
    ["xtensa-addr2line", "ready"],
  ]);
  await provisioner.install("serial-monitor");
  const root = join(dir, "bench");
  await mkdir(join(root, ".vera"), { recursive: true });
  await mkdir(join(root, "main"));
  await writeFile(join(root, "main/main.c"), "void app_main(void) { seeded_compile_error; }\n");
  const runner = new core.ProgramRunner({ host: vendorHost, clock: { sleep } });
  const plugins = async () => Promise.all(["esp32-idf", "serial-monitor"].map((id) => store.load(id)));
  const programs: core.ProgramHost = { runner, clock: { sleep }, plugins, resolver: provisioner };
  const skills = new core.SkillCatalog({
    root,
    disabled: () => [],
    plugins: async () => (await plugins()).map((p) => ({ id: p.manifest.id, folder: p.folder })),
  });
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const scripts = join(dir, "replay");
  await mkdir(scripts);
  await writeFile(join(scripts, "idf.jsonl"), steps.map((s) => JSON.stringify(s)).join("\n"));
  const gateway = new ReplayGateway({ dir: scripts, now: Date.now });
  await gateway.models("replay", new AbortController().signal);
  const service = new core.SessionService({
    root,
    db: handle.db,
    gateway,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/idf",
    prompt: () => "Test",
    skills,
    programs,
  });
  await service.waitReady();
  const created = service.create(null, mode);
  const events: SessionEvent[] = [];
  service.subscribe(created.id, 0, (_seq, event) => events.push(event));
  return {
    dir,
    root,
    bin,
    service,
    created,
    events,
    programs,
    close: async () => {
      await service.close();
      await runner.stopAll();
      handle.close();
      await provisioner.close();
    },
  };
}
const run = (program: string, args: string[]) => ({
  toolCalls: [{ name: "run_program", args: { program, args } }],
});

it.each(["read-only", "ask", "auto-edit", "bypass"] as const)(
  "refuses idf.py monitor with its rule note in %s (REQ-FUNC-10e10009)",
  async (mode) => {
    const r = await rig(mode, [run("idf.py", ["monitor"]), { text: "Blocked" }]);
    try {
      r.service.send(r.created.id, "Run the monitor");
      await r.service.waitIdle(r.created.id);
      const done = r.events.find((e) => e.type === "tool.done");
      expect(done).toMatchObject({
        ok: false,
        summary: expect.stringMatching(/blocked.*Interactive.*serial-monitor/),
      });
      expect(await readFile(join(r.bin, "commands.jsonl"), "utf8")).not.toContain('"monitor"');
    } finally {
      await r.close();
    }
  },
  60_000,
);

it("replays compile repair, rebuild and source-line decoding without hardware (REQ-UX-10e1000a, REQ-UX-10e1000b)", async () => {
  const r = await rig("bypass", [
    { toolCalls: [{ name: "load_skill", args: { name: "esp32-build-fix" } }] },
    run("idf.py", ["build"]),
    { toolCalls: [{ name: "read", args: { path: "main/main.c" } }] },
    {
      toolCalls: [
        {
          name: "edit",
          args: { path: "main/main.c", oldString: "seeded_compile_error;", newString: "return;" },
        },
      ],
    },
    run("idf.py", ["build"]),
    run("idf.py", ["-p", "COM7", "flash"]),
    { toolCalls: [{ name: "load_skill", args: { name: "esp32-panic" } }] },
    run("serial", ["list"]),
    run("serial", ["capture", "--port", "COM7", "--duration", "2", "--until", "PANIC END"]),
    run("xtensa-addr2line", ["-pfiaC", "-e", "build/app.elf", "0x400d1234"]),
    run("riscv-addr2line", ["-pfiaC", "-e", "build/app.elf", "0x42001234"]),
    run("idf.py", ["-p", "COM7", "coredump-info"]),
    { text: "Fixture analysis complete" },
  ]);
  try {
    expect((await core.programPromptEntries(r.programs, [])).map((p) => p.name)).toContain("idf.py");
    r.service.send(r.created.id, "Repair the seeded source, rebuild and decode fixture addresses");
    expect(await r.service.waitIdle(r.created.id)).toEqual({ stopReason: "end" });
    const done = r.events.filter((e) => e.type === "tool.done");
    for (const d of done) expect(d.ok, d.summary).toBe(true);
    const outputs = done.map((d) => d.summary).join("\n");
    expect(outputs).toContain("seeded_compile_error");
    expect(outputs).toContain("Project build complete");
    expect(outputs).toContain("main/main.c:1");
    expect(outputs).toContain("Guru Meditation");
    expect(outputs).toContain("0x400d1234:0x3ffb0000");
    expect(outputs).toContain("Core dump fixture");
    expect(await readFile(join(r.root, "main/main.c"), "utf8")).toContain("return;");
    expect(await readFile(join(r.root, "build/app.elf"), "utf8")).toBe("fixture-elf");
    const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
    if (evidence) {
      const target = join(evidence, `${process.platform}-idf-replay`);
      await mkdir(target, { recursive: true });
      await cp(join(r.root, ".vera/runs"), join(target, "runs"), { recursive: true });
      await cp(join(r.bin, "commands.jsonl"), join(target, "commands.jsonl"));
      await writeFile(join(target, "tool-results.json"), JSON.stringify(done, null, 2));
    }
  } finally {
    await r.close();
  }
}, 90_000);
