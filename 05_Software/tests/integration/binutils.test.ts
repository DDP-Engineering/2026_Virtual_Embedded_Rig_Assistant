import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
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
  programArgumentRefusal,
  type SessionEvent,
  validatePluginManifest,
} from "@vera/shared";
import { afterAll, expect, it } from "vitest";
import { parse } from "yaml";

const software = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(software, "plugins/binutils");
const fixture = join(software, "tests/fixtures/elf");
const tools = ["size", "nm", "readelf", "objdump", "addr2line"];
const prefixes = ["arm-none-eabi", "riscv-none-elf"];
const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function manifest(): Promise<PluginManifest> {
  return parse(await readFile(join(source, "plugin.yaml"), "utf8"));
}

it("keeps real debug ELF32 fixtures for ARM and RISC-V with their complete source inputs", async () => {
  for (const prefix of prefixes)
    for (const build of ["before", "after"]) {
      const bytes = await readFile(join(fixture, `${prefix}-${build}.elf`));
      expect(bytes.subarray(0, 4).toString()).toBe("\x7fELF");
      expect(bytes[4]).toBe(1); // ELF32
      expect(bytes[5]).toBe(1); // little endian
      expect(bytes.readUInt16LE(18)).toBe(prefix === "arm-none-eabi" ? 40 : 243);
      for (const name of [".debug_info", ".debug_line", "firmware.c", "crash_site", "grow"])
        expect(bytes.includes(Buffer.from(name))).toBe(true);
    }
  for (const file of ["firmware.c", "firmware.ld", "build.py", "README.md"])
    expect((await readFile(join(fixture, file))).length).toBeGreaterThan(0);
});

it("ships ten safe tools, ordered find roots, pinned shared archives and the three skills", async () => {
  expect(existsSync(join(source, "plugin.yaml"))).toBe(true);
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m.platforms).toEqual(["windows-x64", "linux-x64", "linux-arm64"]);
  expect(Object.keys(m.programs).sort()).toEqual(
    prefixes.flatMap((p) => tools.map((t) => `${p}-${t}`)).sort(),
  );
  for (const [name, p] of Object.entries(m.programs)) {
    expect(p.version.args).toEqual(["--version"]);
    expect(p.install).toHaveProperty("find");
    expect(p.install).toHaveProperty("download");
    if (!("find" in p.install) || !p.install.download) throw Error("combined install");
    expect(p.install.find.windows?.[0]).toBe("%PATH%");
    expect(p.install.find.linux?.[0]).toBe("$PATH");
    const all = [...(p.install.find.windows ?? []), ...(p.install.find.linux ?? [])].join("\n");
    for (const root of ["platformio", "arduino", "zephyr-sdk", "xPacks"]) expect(all).toContain(root);
    if (name.startsWith("arm-"))
      for (const root of ["STM32CubeCLT", "stm32cubeide"]) expect(all).toContain(root);
    for (const platform of m.platforms) {
      const entry = p.install.download[platform];
      expect(entry?.url).toMatch(/^https:\/\/github.com\/xpack-dev-tools\//);
      expect(entry?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry?.path).toContain(`/bin/${name}`);
    }
    for (const args of [["--version"], ["-A", "before.elf"], ["--disassemble=grow", "after.elf"]])
      expect(classifyCommand(m.rules, name, args).risk).toBe("safe");
    expect(programArgumentRefusal(["@args"])).toMatchObject({ reason: "argument-file" });
  }
  for (const prefix of prefixes)
    for (const platform of m.platforms)
      expect(
        new Set(
          tools.map((t) => {
            const install = m.programs[`${prefix}-${t}`]?.install;
            return install && "download" in install ? install.download?.[platform]?.sha256 : undefined;
          }),
        ).size,
      ).toBe(1);
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-binutils-skills-")));
  roots.push(root);
  const store = new core.PluginStore({ root });
  await store.install(source);
  const plugin = await store.load("binutils");
  const catalog = new core.SkillCatalog({
    root,
    disabled: () => [],
    plugins: async () => [{ id: "binutils", folder: plugin.folder }],
  });
  expect((await catalog.list()).filter((s) => s.plugin === "binutils").map((s) => s.name)).toEqual([
    "crash-decode",
    "elf-inspect",
    "firmware-size",
  ]);
  const size = (await catalog.read("plugin", "firmware-size")).content;
  for (const text of ["-A", "--size-sort", "delta", "firmware-comparator"]) expect(size).toContain(text);
  const crash = (await catalog.read("plugin", "crash-decode")).content;
  for (const text of ["PC", "LR", "-f", "-C", "-i", "exact", "??"]) expect(crash).toContain(text);
  const inspect = (await catalog.read("plugin", "elf-inspect")).content;
  for (const text of ["-h -S -l", "linker", "offset", "--disassemble=", "--start-address", "--stop-address"])
    expect(inspect).toContain(text);
  expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
});

it("discovers only present programs and probes PATH, vendor, PlatformIO, Arduino, Zephyr then xPack", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-binutils-find-")));
  roots.push(root);
  const windows = process.platform === "win32";
  const m = await manifest();
  const p = m.programs["arm-none-eabi-size"];
  if (!p || !("find" in p.install)) throw Error("find declaration");
  // Relocate fixed system vendor roots into this test's own fake filesystem.
  p.install.find = {
    [windows ? "windows" : "linux"]: [
      windows ? "%PATH%" : "$PATH",
      join(root, "ST", "clt-*", "bin"),
      ...(windows ? (p.install.find.windows ?? []) : (p.install.find.linux ?? [])).filter(
        (s) => s.startsWith("~") || s.startsWith("%LOCALAPPDATA%"),
      ),
    ],
  };
  m.programs = {
    "arm-none-eabi-size": p,
    "riscv-none-elf-size": m.programs["riscv-none-elf-size"] as NonNullable<typeof p>,
  };
  const exe = `arm-none-eabi-size${windows ? ".exe" : ""}`;
  const paths = [
    join(root, "path", exe),
    join(root, "ST/clt-1/bin", exe),
    join(root, ".platformio/packages/toolchain-gccarmnoneeabi/bin", exe),
    join(
      root,
      windows
        ? "local/Arduino15/packages/arduino/tools/arm-none-eabi-gcc/1/bin"
        : ".arduino15/packages/arduino/tools/arm-none-eabi-gcc/1/bin",
      exe,
    ),
    join(root, "zephyr-sdk-1/arm-zephyr-eabi/bin", `arm-zephyr-eabi-size${windows ? ".exe" : ""}`),
    join(root, ".local/xPacks/@xpack-dev-tools/arm-none-eabi-gcc/1/.content/bin", exe),
  ];
  for (const path of paths) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "fake", { mode: 0o755 });
  }
  const probes: { executable: string; args: readonly string[] }[] = [];
  const host: core.ProcessHost = {
    platform: windows ? "win32" : "linux",
    env: { PATH: join(root, "path"), HOME: root, USERPROFILE: root, LOCALAPPDATA: join(root, "local") },
    spawn(executable, args, options) {
      probes.push({ executable, args });
      options.output("stdout", Buffer.from("GNU size (GNU Binutils) 2.46\n"));
      return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
    },
    signal: () => true,
  };
  const plugin = {
    manifest: m,
    folder: source,
    record: {
      format: 1 as const,
      id: "binutils",
      version: "1.0.0",
      tier: "official" as const,
      source: { kind: "folder" as const, path: source },
      sha256: "a".repeat(64),
      installedAt: new Date().toISOString(),
      programs: {},
    },
  };
  const provisioner = new core.Provisioner({
    store: {
      load: async () => plugin,
      recordPrograms: async () => {
        throw Error("discovery wrote");
      },
    },
    root: join(root, "runtime"),
    host,
    clock: { sleep: async () => {} },
    platform: windows ? "windows-x64" : "linux-x64",
    fetch: async () => {
      throw Error("discovery fetched");
    },
    settings: () => undefined,
  });
  const runner = new core.ProgramRunner({ host, clock: { sleep: async () => {} } });
  const programs: core.ProgramHost = {
    runner,
    clock: { sleep: async () => {} },
    plugins: async () => [plugin],
    resolver: provisioner,
  };
  try {
    for (const path of paths) {
      const entries = await core.programPromptEntries(programs, []);
      expect(entries.map((e) => e.name)).toEqual(["arm-none-eabi-size"]);
      expect(entries[0]?.version).toBe("2.46");
      expect((await provisioner.resolve(plugin, "arm-none-eabi-size"))?.executable).toBe(path);
      await rm(path);
      provisioner.invalidate();
    }
    expect(await core.programPromptEntries(programs, [])).toEqual([]);
    expect(probes.map((p) => p.executable)).toEqual(paths);
    expect(probes.every((p) => p.args.join(" ") === "--version")).toBe(true);
  } finally {
    provisioner.close();
    await runner.stopAll();
  }
});

// Explicit local archives opt in to genuine, large toolchain acceptance; no test has network access.
const archives = process.env.VERA_BINUTILS_ARCHIVES;
it.skipIf(!archives)(
  "analyzes real ARM/RISC-V ELFs through replay with downloaded and found toolchains",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-binutils-real-")));
    roots.push(root);
    const windows = process.platform === "win32";
    const platform = windows ? "windows-x64" : "linux-x64";
    const host = new core.NodeProcessHost(spawn);
    const downloads: string[] = [];
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const plugin = await store.load("binutils");
    const bins: string[] = [];
    const probeHost = (path: string): core.ProcessHost => ({
      platform: host.platform,
      // Empty home and vendor roots ensure the downloaded path cannot accidentally use user tools.
      env: {
        ...Object.fromEntries(
          Object.entries(host.env).filter(
            ([k]) => !["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"].includes(k.toUpperCase()),
          ),
        ),
        PATH: path,
        HOME: join(root, "empty-home"),
        USERPROFILE: join(root, "empty-home"),
      },
      spawn: host.spawn.bind(host),
      signal: host.signal.bind(host),
    });
    const offlineFetch = async (url: string) => {
      downloads.push(url);
      const file = join(archives as string, basename(new URL(url).pathname));
      if (!existsSync(file)) throw Error(`Missing official archive: ${file}`);
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>);
    };
    // Restrict find to the controlled PATH in a loaded descriptor; the installed manifest stays intact.
    const isolated = { ...plugin, manifest: structuredClone(plugin.manifest) };
    for (const p of Object.values(isolated.manifest.programs))
      if ("find" in p.install) p.install.find = { windows: ["%PATH%"], linux: ["$PATH"] };
    const storePort: core.ProvisionerStore = {
      load: async () => ({ ...isolated, record: (await store.load("binutils")).record }),
      recordPrograms: store.recordPrograms.bind(store),
    };
    const makeProvisioner = (path: string) =>
      new core.Provisioner({
        store: storePort,
        root: join(root, "runtime"),
        host: probeHost(path),
        clock: {
          sleep: async (ms) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
          },
        },
        platform,
        fetch: offlineFetch,
        settings: () => undefined,
      });
    let provisioner = makeProvisioner("");
    const runner = new core.ProgramRunner({
      host,
      clock: {
        sleep: async (ms) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
        },
      },
    });
    try {
      expect((await provisioner.statuses("binutils")).every((p) => p.state === "missing")).toBe(true);
      expect(downloads).toEqual([]);
      const installed = await provisioner.install("binutils");
      expect(
        installed.every((p) => p.state === "ready"),
        JSON.stringify(installed),
      ).toBe(true);
      expect(downloads).toHaveLength(2);
      for (const prefix of prefixes) {
        const p = isolated.manifest.programs[`${prefix}-size`];
        if (!p || !("download" in p.install) || !p.install.download?.[platform]) throw Error("pin missing");
        const entry = p.install.download[platform];
        bins.push(dirname(join(root, "runtime/downloads", entry.sha256, entry.path as string)));
      }
      for (const mode of ["downloaded", "found"] as const) {
        if (mode === "found") {
          provisioner.close();
          provisioner = makeProvisioner(bins.join(windows ? ";" : ":"));
        }
        const programs: core.ProgramHost = {
          runner,
          clock: { sleep: async () => {} },
          plugins: async () => [await storePort.load("binutils")],
          resolver: provisioner,
        };
        const entries = await core.programPromptEntries(programs, []);
        expect(entries).toHaveLength(10);
        expect(entries.every((p) => /^2\.\d+/.test(p.version ?? ""))).toBe(true);
        const bench = join(root, mode);
        await mkdir(join(bench, ".vera"), { recursive: true });
        await cp(fixture, join(bench, "elf"), { recursive: true });
        const steps: object[] = [];
        const run = (program: string, args: string[]) => ({
          toolCalls: [{ name: "run_program", args: { program, args } }],
        });
        steps.push({ toolCalls: [{ name: "load_skill", args: { name: "firmware-size" } }] });
        for (const prefix of prefixes) {
          for (const build of ["before", "after"]) {
            steps.push(run(`${prefix}-size`, ["-A", `elf/${prefix}-${build}.elf`]));
            steps.push(
              run(`${prefix}-nm`, [
                "-S",
                "--size-sort",
                "-C",
                "--defined-only",
                `elf/${prefix}-${build}.elf`,
              ]),
            );
          }
        }
        steps.push({ toolCalls: [{ name: "load_skill", args: { name: "crash-decode" } }] });
        for (const prefix of prefixes)
          steps.push(
            run(`${prefix}-addr2line`, [
              "-e",
              `elf/${prefix}-after.elf`,
              "-a",
              "-f",
              "-C",
              "-i",
              prefix === "arm-none-eabi" ? "0x08000044" : "0x0800005c",
              "0x08000000",
            ]),
          );
        steps.push({ toolCalls: [{ name: "load_skill", args: { name: "elf-inspect" } }] });
        for (const prefix of prefixes) {
          steps.push(run(`${prefix}-readelf`, ["-h", "-S", "-l", `elf/${prefix}-after.elf`]));
          steps.push(run(`${prefix}-objdump`, ["--disassemble=crash_site", `elf/${prefix}-after.elf`]));
        }
        const report =
          "ARM .text 72 -> 104 (+32), .data 4 -> 4, .bss 16 -> 64 (+48). Largest symbols: workspace 16 -> 64 (+48), grow 36 -> 68 (+32). RISC-V .text 94 -> 142 (+48), .data 4 -> 4, .bss 16 -> 64 (+48). Largest symbols: grow 44 -> 92 (+48), workspace 16 -> 64 (+48). ARM PC 0x08000044 and RISC-V PC 0x0800005c: crash_site firmware.c:18; code address 0x08000000: grow firmware.c:8 in each exact after ELF. Targeted crash_site disassembly retained in run logs.";
        steps.push({ text: report });
        const scripts = join(bench, "replay");
        await mkdir(scripts);
        await writeFile(join(scripts, "elf.jsonl"), steps.map((s) => JSON.stringify(s)).join("\n"));
        const gateway = new ReplayGateway({ dir: scripts, now: Date.now });
        await gateway.models("replay", new AbortController().signal);
        const db = await core.openDb(join(bench, ".vera/vera.db"), {
          workbenchId: "wb_test",
          appVersion: "0",
        });
        const skills = new core.SkillCatalog({
          root: bench,
          disabled: () => [],
          plugins: async () => [{ id: "binutils", folder: plugin.folder }],
        });
        const service = new core.SessionService({
          root: bench,
          db: db.db,
          gateway,
          clock: { now: () => new Date(), sleep: async () => {} },
          model: () => "replay/elf",
          prompt: () => "Analyze local ELF files",
          skills,
          programs,
        });
        const events: SessionEvent[] = [];
        try {
          await service.waitReady();
          const session = service.create(null, "read-only");
          service.subscribe(session.id, 0, (_seq, event) => events.push(event));
          service.send(session.id, "Compare the two real builds, decode PC/LR and disassemble crash_site.");
          expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
          const done = events.filter((e) => e.type === "tool.done");
          expect(done).toHaveLength(17);
          for (const d of done) expect(d.ok, d.summary).toBe(true);
          const output = done.map((d) => d.summary).join("\n");
          for (const text of ["firmware.c:18", "firmware.c:8", "crash_site", "grow", "LOAD", "NOBITS"])
            expect(output).toContain(text);
          // Check numeric observations independently of the scripted report.
          expect(output).toMatch(/\.text\s+72\s/);
          expect(output).toMatch(/\.text\s+104\s/);
          expect(output).toMatch(/\.text\s+94\s/);
          expect(output).toMatch(/\.text\s+142\s/);
          for (const hex of [
            "00000010 B workspace",
            "00000040 B workspace",
            "00000024 T grow",
            "00000044 T grow",
            "0000002c T grow",
            "0000005c T grow",
          ])
            expect(output).toContain(hex);
          const logs = await runner.list(bench);
          expect(logs).toHaveLength(14);
          for (const log of logs) {
            const text = await readFile(join(bench, log.log), "utf8");
            expect(log).toMatchObject({ exitCode: 0 });
            if (log.program?.endsWith("objdump")) {
              expect(text.length).toBeLessThan(12_000);
              expect(text).toContain("<crash_site>:");
              expect(log.args).toContain("--disassemble=crash_site");
            }
          }
          const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
          if (evidence) {
            const target = join(evidence, `${process.platform}-binutils-${mode}`);
            await mkdir(target, { recursive: true });
            await cp(join(bench, ".vera/runs"), join(target, "runs"), { recursive: true });
            await writeFile(join(target, "events.json"), JSON.stringify(events, null, 2));
            await writeFile(join(target, "report.txt"), report);
            await writeFile(join(target, "programs.json"), JSON.stringify(entries, null, 2));
          }
        } finally {
          await service.close();
          db.close();
        }
        expect(downloads).toHaveLength(2);
      }
    } finally {
      provisioner.close();
      await runner.stopAll();
    }
  },
  15 * 60_000,
);
