// The stm32-cubeprog plugin without a board. Default tests check the package, the rules over the parsed command
// line (and that every command of the recorded 2.23.0 help is classified), find/hint with a fake host and the typed
// word for an option-byte write through a stub resolver. Where STM32_Programmer_CLI is installed, a replay session
// runs it for real: commands that need no board without approval and a connection, which fails, after approval.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = new URL("stm32-cubeprog/", plugins);
const fixtures = fileURLToPath(new URL("../fixtures/stm32/", import.meta.url));
const program = "stm32_programmer_cli";
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));
const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const hint =
  "Install STM32CubeProgrammer from https://www.st.com/en/development-tools/stm32cubeprog.html (an ST account is required) or STM32CubeIDE, which bundles it.";

it("publishes the official find-only package, its pack and two installed skills", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "stm32-cubeprog",
    ecosystem: "stm32",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(m.programs[program]).toMatchObject({
    install: { hint },
    version: { args: ["--version"], match: "STM32CubeProgrammer version: (\\d+\\.\\d+\\.\\d+)" },
    optionSyntax: "stm32cubeprog",
  });
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("stm32-cubeprog");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs).toContainEqual({
    id: "stm32",
    name: "STM32 (ST)",
    groups: [{ name: "Programming (STM32CubeProgrammer)", plugins: ["stm32-cubeprog"], default: true }],
  });
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-stm32-skills-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("stm32-cubeprog");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: plugin.manifest.id, folder: plugin.folder }],
    });
    const listed = (await skills.list()).filter((skill) => skill.plugin === "stm32-cubeprog");
    expect(listed.map((skill) => skill.name)).toEqual(["stm32-flash", "stm32-option-bytes"]);
    const flash = (await skills.read("plugin", "stm32-flash")).content;
    for (const text of ["-l st-link-only", "-c port=SWD", "-w ", " -v", "-rst", "-e all"])
      expect(flash).toContain(text);
    const bytes = (await skills.read("plugin", "stm32-option-bytes")).content;
    for (const text of ["-ob displ", "RDP=0xCC", "RDP=0xBB", "one option byte", "typed"])
      expect(bytes).toContain(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("classifies every command of a line at the highest risk", async () => {
  const m = await manifest();
  const classify = (args: string[]) =>
    classifyCommand(m.rules, program, args, m.programs[program]?.optionSyntax);
  const swd = ["-c", "port=SWD"];
  const cases = [
    // No target involved.
    ["safe", ["--version"]],
    ["safe", ["-version"]],
    ["safe", ["-VERSION"]],
    ["safe", ["-h"]],
    ["safe", ["-?"]],
    ["safe", ["--help"]],
    ["safe", ["-fchecksum", "app.hex"]],
    ["safe", ["--file-checksum", "app.hex"]],
    ["safe", ["-sl", "app.elf", "0x08000000", "0x08010000", "0x400"]],
    ["safe", ["-ms", "app.elf", "header.bin", "sbsfu.bin"]],
    ["safe", ["-l", "st-link-only"]],
    ["safe", ["-l", "stlink-only"]],
    ["safe", ["--list", "uart"]],
    ["safe", ["-l", "usb"]],
    ["safe", ["-q", "-log", "trace.log", "-vb", "3", "-version"]],
    // Probes and reads.
    ["device-read", ["-l"]],
    ["device-read", ["-l", "st-link"]],
    ["device-read", ["-getTargetSelList"]],
    ["device-read", swd],
    ["device-read", ["--connect", "port=SWD", "mode=UR", "reset=HWrst"]],
    ["device-read", ["-C", "port=SWD", "freq=4000"]],
    ["device-read", [...swd, "-ob", "displ"]],
    ["device-read", [...swd, "-OB", "DISPL"]],
    ["device-read", [...swd, "--optionbytes", "displ"]],
    ["device-read", [...swd, "-r32", "0x08000000", "0x100"]],
    ["device-read", [...swd, "-r8", "0x1FFF7590", "12"]],
    ["device-read", [...swd, "-u", "0x08000000", "0x1000", "dump.bin"]],
    ["device-read", [...swd, "--upload", "0x08000000", "0x1000", "dump.hex"]],
    ["device-read", [...swd, "-checksum"]],
    ["device-read", [...swd, "-blankcheck"]],
    ["device-read", [...swd, "-rst"]],
    ["device-read", [...swd, "-hardRst"]],
    ["device-read", [...swd, "-halt", "-coreReg", "PC", "LR"]],
    ["device-read", [...swd, "-score"]],
    ["device-read", [...swd, "-regdump", "regs.log"]],
    ["device-read", [...swd, "-hf"]],
    ["device-read", [...swd, "-swv", "freq=80", "portnumber=0", "swv.log"]],
    ["device-read", [...swd, "-getuid64"]],
    ["device-read", [...swd, "-otp", "displ"]],
    ["device-read", [...swd, "-psrss", "displ"]],
    ["device-read", ["-c", "port=SWD", "debugauth=2"]],
    ["device-read", [...swd, "-otp", "displ", "word=8"]],
    ["device-read", ["-l", "st-link-only", "shared"]],
    // Ordinary writes and erases.
    ["device-write", [...swd, "-w", "app.elf", "-v", "-rst"]],
    ["device-write", [...swd, "-d", "app.bin", "0x08000000", "-v"]],
    ["device-write", [...swd, "--download", "app.hex"]],
    ["device-write", [...swd, "--write", "app.hex", "--skipErase"]],
    ["device-write", [...swd, "-w32", "0x20000000", "-1"]],
    ["device-write", [...swd, "-w8", "0x20000000", "0x01"]],
    ["device-write", [...swd, "-e", "all"]],
    ["device-write", [...swd, "--erase", "[5", "10]"]],
    ["device-write", [...swd, "-fillmemory", "0x08000000", "size=0x100", "pattern=0xFF"]],
    ["device-write", [...swd, "-coreReg", "R0=0x1"]],
    ["device-write", [...swd, "-g", "0x08000000"]],
    ["device-write", [...swd, "-fwdelete"]],
    ["device-write", [...swd, "-foo"]],
    ["device-write", [...swd, "-obdispl"]],
    ["device-write", ["--vers"]],
    ["device-write", ["port=SWD"]],
    ["device-write", []],
    // Spellings the help does not list: the CLI accepts extra leading dashes and trims spaces, so they count as
    // unknown plus every command they could mean.
    ["device-write", [...swd, "--ob", "displ"]],
    ["device-write", ["--c", "port=SWD"]],
    ["device-write", ["-file-checksum", "app.hex"]],
    ["device-write", ["-x-rst"]],
    ["device-write", [...swd, "-w32", "0x20000000", "-0x10", "-0.5"]],
    // Option bytes, protection, security and power.
    ["irreversible", [...swd, "-ob", "RDP=0xBB"]],
    ["irreversible", [...swd, "-ob", "RDP=0xCC"]],
    ["irreversible", [...swd, "-ob", "rdp=0xcc"]],
    ["irreversible", [...swd, "--optionbytes", "nBOOT0=0", "WRP1A_STRT=0x7F"]],
    ["irreversible", [...swd, "-ob", "unlockchip"]],
    ["irreversible", [...swd, "-ob", "displ", "RDP=0xBB"]],
    ["irreversible", [...swd, "-ob"]],
    ["irreversible", [...swd, "-ob", "displ", "-ob", "RDP=0xBB"]],
    ["irreversible", [...swd, "-w", "app.elf", "-OB", "RDP=0xBB"]],
    ["irreversible", [...swd, "-rdu"]],
    ["irreversible", [...swd, "--readunprotect"]],
    ["irreversible", [...swd, "-tzenreg"]],
    ["irreversible", [...swd, "-lockRDP1", "0x1", "0x2"]],
    ["irreversible", [...swd, "-setOEM2KEY", "0x1", "0x2"]],
    ["irreversible", [...swd, "-unlockRDP2", "0x1", "0x2"]],
    ["irreversible", [...swd, "-otp", "write", "word=8", "value=0x1"]],
    ["irreversible", [...swd, "-otp", "lock", "word=8"]],
    ["irreversible", [...swd, "-storekeyotp", "keys", "0x08000000"]],
    ["irreversible", [...swd, "-sfi", "app.sfi", "license.bin"]],
    ["irreversible", [...swd, "-ssp", "out.ssp", "fw.stm32", "license.bin"]],
    ["irreversible", [...swd, "-dsecurity"]],
    ["irreversible", [...swd, "-setdefaultob"]],
    ["irreversible", [...swd, "-antirollback"]],
    ["irreversible", [...swd, "-fwupgrade", "fus.bin", "0x080EC000", "-v"]],
    ["irreversible", [...swd, "-authkeylock"]],
    ["irreversible", [...swd, "-wusrkey", "key.bin", "keytype=1"]],
    ["irreversible", [...swd, "-psrss", "0x17"]],
    ["irreversible", [...swd, "-obrss", "0x1", "0x2", "0x3", "0x4"]],
    ["irreversible", ["-c", "port=SWD", "debugauth=1", "key=k.pem", "cert=c.der", "per=a"]],
    ["irreversible", ["-hsmgetlicense", "license.bin", "slot=1"]],
    ["irreversible", ["-pwr", "on"]],
    ["irreversible", ["--power", "off", "index=0"]],
    ["irreversible", [...swd, "--rdu"]],
    ["irreversible", [...swd, "---ob", "RDP=0xCC"]],
    ["irreversible", [...swd, "-ob RDP=0xCC"]],
    ["irreversible", [...swd, " -ob ", "RDP=0xBB"]],
    ["irreversible", [...swd, "-x-rdu"]],
    ["irreversible", [...swd, "--tzenreg"]],
    ["irreversible", [...swd, "-ob", "displ", "word=1"]],
    ["irreversible", [...swd, "-otp", "displ", "word=8", "value=0x1"]],
    ["irreversible", [...swd, "-psrss", "displ", "word=1"]],
    ["irreversible", ["-c", "port=SWD", "DEBUGAUTH=1"]],
    ["irreversible", ["-c", "port=SWD", "debugauth=01"]],
    ["irreversible", ["-c", "port=SWD", "debugauth=0x1"]],
    ["irreversible", ["-c", "port=SWD", "debugauth", "=1"]],
    ["irreversible", ["-c", "port=SWD", "debugauth =1"]],
    ["irreversible", ["-c", "port=SWD", "-rst", "debugauth=1"]],
    ["irreversible", ["debugauth=1", "-c", "port=SWD"]],
    ["irreversible", [...swd, "-1-rdu"]],
    ["irreversible", [...swd, "-ob=displ"]],
    ["irreversible", [...swd, "-x:rdu"]],
    ["irreversible", ["-c", "port=SWD", "--debugauth=1"]],
    ["irreversible", [...swd, "-r32", "0x08000000", "4", "-0x1-ob", "RDP=0xCC"]],
    // Script files can hold any command.
    ["blocked", ["-script", "flash.prg"]],
    ["blocked", [...swd, "-SCRIPT", "flash.prg"]],
    ["blocked", ["--script", "flash.prg"]],
    ["blocked", ["-x-script", "flash.prg"]],
    ["blocked", ["-.5-script", "flash.prg"]],
  ] as const;
  for (const [risk, args] of cases) expect(classify([...args]).risk, args.join(" ")).toBe(risk);
  expect(classify([...swd, "-ob", "RDP=0xCC"])).toMatchObject({ confirm: "-ob" });
  expect(classify([...swd, "-ob", "RDP=0xCC"]).notes.join(" ")).toContain("RDP=0xCC");
  expect(classify([...swd, "--readunprotect"]).confirm).toBe("-rdu");
  expect(classify([...swd, "-setOEM1KEY", "1", "2"]).confirm).toBe("-lockrdp1");
  expect(classify(["--power", "on"]).confirm).toBe("-pwr");
  expect(classify(["-c", "port=SWD", "debugauth=1"]).confirm).toBe("debugauth");

  // Every irreversible command in each spelling, alone and after a read.
  const irreversible = [
    ["-rdu"],
    ["--readunprotect"],
    ["-tzenreg"],
    ["--tzenregression"],
    ["-lockRDP1", "1", "2"],
    ["-setOEM1KEY", "1", "2"],
    ["-unlockRDP1", "1", "2"],
    ["-lockRDP2", "1", "2"],
    ["-setOEM2KEY", "1", "2"],
    ["-unlockRDP2", "1", "2"],
    ["-otp", "write", "word=1", "value=1"],
    ["-otp", "lock", "word=1"],
    ["-otp", "fwrite", "otp.bin", "word=1"],
    ["-storekeyotp", "keys", "0x0"],
    ["--storekeyotp", "keys", "0x0"],
    ["-sfi", "a.sfi", "l.bin"],
    ["--sfi", "a.sfi", "l.bin"],
    ["-ssfi", "a.ssfi", "r.bin"],
    ["--ssfi", "a.ssfi", "r.bin"],
    ["-ssp", "a.ssp", "fw.bin", "l.bin"],
    ["--ssp", "a.ssp", "fw.bin", "l.bin"],
    ["-installipmodule", "m.smu"],
    ["--installipmodule", "m.smu"],
    ["-updateipmodule", "m.smu"],
    ["--updateipmodule", "m.smu"],
    ["-dsecurity"],
    ["-setdefaultob"],
    ["-antirollback"],
    ["-fwupgrade", "fw.bin", "0x0"],
    ["-authkeyupdate", "k.bin"],
    ["-authkeylock"],
    ["-wusrkey", "k.bin", "keytype=1"],
    ["-sdp", "ob.key"],
    ["-pwd", "value=1", "path=p.bin"],
    ["-psrss", "0x17"],
    ["-obrss", "1", "2", "3", "4"],
    ["-pmic", "nvm.bin"],
    ["-hsmgetlicense", "l.bin"],
    ["-hsmglfcb", "c.bin", "l.bin"],
    ["-hsmgetlicensefromcertifbin", "c.bin", "l.bin"],
    ["-pwr", "on"],
    ["--power", "off"],
    ["-ob", "RDP=0xBB"],
    ["--optionbytes", "unlockchip"],
  ];
  for (const command of irreversible)
    for (const args of [command, [...swd, "-r32", "0x08000000", "4", ...command]])
      expect(classify(args).risk, args.join(" ")).toBe("irreversible");

  // Every command the recorded help lists is matched by an explicit rule, never by the unknown fallback.
  const unknownNote = m.rules.find((rule) => rule.match.includes("<unknown>"))?.note;
  expect(unknownNote).toBeDefined();
  const help = await readFile(join(fixtures, "STM32_Programmer_CLI-2.23.0-help.txt"), "utf8");
  const commands = new Set<string>();
  for (const line of help.split("\n")) {
    const head = /^ {1,6}(-[^\s:]+(?:,\s*-[^\s:]+)*)/.exec(line)?.[1];
    for (const name of head?.split(/,\s*/) ?? []) if (/^-{1,2}[A-Za-z?]/.test(name)) commands.add(name);
  }
  expect(commands.size).toBeGreaterThan(90);
  for (const name of commands) {
    const notes = classify([name]).notes;
    expect(notes.length, name).toBeGreaterThan(0);
    expect(notes, name).not.toContain(unknownNote);
  }
});

it("finds STM32_Programmer_CLI in PATH or the install folder and shows the hint when it is missing", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-stm32-find-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("stm32-cubeprog");
    const spawned: string[] = [];
    const provisioner = (env: Record<string, string>) =>
      new core.Provisioner({
        store,
        root: join(root, "runtime"),
        platform: "windows-x64",
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("STM32CubeProgrammer must never download");
        },
        host: {
          platform: "win32",
          env,
          spawn(executable, _args, options) {
            spawned.push(executable);
            options.output(
              "stdout",
              Buffer.from("      STM32CubeProgrammer v2.23.0\n\nSTM32CubeProgrammer version: 2.23.0 \n"),
            );
            return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
          },
          signal: () => true,
        },
      });
    const empty = join(root, "empty");
    const missing = provisioner({ PATH: empty, ProgramFiles: empty, SystemDrive: "Q:" });
    expect(await missing.statuses("stm32-cubeprog")).toEqual([
      {
        name: program,
        kind: "find",
        state: "missing",
        problem: "notFound",
        hint,
        link: "https://www.st.com/en/development-tools/stm32cubeprog.html",
      },
    ]);
    expect(spawned).toEqual([]);
    missing.close();
    const folder = join(
      root,
      "Program Files",
      "STMicroelectronics",
      "STM32Cube",
      "STM32CubeProgrammer",
      "bin",
    );
    await mkdir(folder, { recursive: true });
    const installed = join(folder, "STM32_Programmer_CLI.exe");
    await writeFile(installed, "fixture");
    const fromFolder = provisioner({ PATH: empty, ProgramFiles: join(root, "Program Files") });
    expect(await fromFolder.resolve(plugin, program)).toMatchObject({
      executable: installed,
      version: "2.23.0",
    });
    fromFolder.close();
    const ide = join(
      root,
      "ST",
      "STM32CubeIDE_1.19.0",
      "STM32CubeIDE",
      "plugins",
      "com.st.stm32cube.ide.mcu.externaltools.cubeprogrammer.win32_2.2.300",
      "tools",
      "bin",
    );
    await mkdir(ide, { recursive: true });
    await writeFile(join(ide, "STM32_Programmer_CLI.exe"), "fixture");
    const fromIde = provisioner({ PATH: empty, ProgramFiles: empty, SystemDrive: root });
    expect(await fromIde.resolve(plugin, program)).toMatchObject({
      executable: join(ide, "STM32_Programmer_CLI.exe"),
    });
    fromIde.close();
    const clt = join(root, "ST", "STM32CubeCLT_1.18.0", "STM32CubeProgrammer", "bin");
    await mkdir(clt, { recursive: true });
    await writeFile(join(clt, "STM32_Programmer_CLI.exe"), "fixture");
    const fromClt = provisioner({ PATH: empty, ProgramFiles: empty, SystemDrive: root });
    expect(await fromClt.resolve(plugin, program)).toMatchObject({
      executable: join(clt, "STM32_Programmer_CLI.exe"),
    });
    fromClt.close();
    const onPath = join(root, "bin");
    await mkdir(onPath);
    const first = join(onPath, `${program}.exe`);
    await writeFile(first, "fixture");
    const fromPath = provisioner({ PATH: onPath, ProgramFiles: join(root, "Program Files") });
    expect(await fromPath.resolve(plugin, program)).toMatchObject({ executable: first, version: "2.23.0" });
    fromPath.close();
    // Linux lists the install folders first; PATH finds only a lower-case link (tested on Linux hosts, where
    // a ':'-separated PATH holds no drive letter).
    const home = join(root, "home");
    const linuxBin = join(home, "STMicroelectronics", "STM32Cube", "STM32CubeProgrammer", "bin");
    await mkdir(linuxBin, { recursive: true });
    await writeFile(join(linuxBin, "STM32_Programmer_CLI"), "fixture", { mode: 0o755 });
    const onLinux = new core.Provisioner({
      store,
      root: join(root, "runtime"),
      platform: "linux-x64",
      clock: { sleep },
      settings: () => undefined,
      fetch: async () => {
        throw Error("STM32CubeProgrammer must never download");
      },
      host: {
        platform: "linux",
        env: { HOME: home, PATH: onPath },
        spawn(_executable, _args, options) {
          options.output("stdout", Buffer.from("STM32CubeProgrammer version: 2.23.0 \n"));
          return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
        },
        signal: () => true,
      },
    });
    expect(await onLinux.resolve(plugin, program)).toMatchObject({
      executable: join(linuxBin, "STM32_Programmer_CLI"),
      version: "2.23.0",
    });
    onLinux.close();
    // An installed ST tool outside HOME would win over the link; this case needs a Linux host without one.
    const installs = ["/usr/local/STMicroelectronics", "/opt/st"].some((folder) => existsSync(folder));
    if (!windows && !installs) {
      const links = join(root, "links");
      await mkdir(links);
      await writeFile(join(links, program), "fixture", { mode: 0o755 });
      const fromLink = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        platform: "linux-x64",
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("STM32CubeProgrammer must never download");
        },
        host: {
          platform: "linux",
          env: { HOME: join(root, "nobody"), PATH: links },
          spawn(_executable, _args, options) {
            options.output("stdout", Buffer.from("STM32CubeProgrammer version: 2.23.0 \n"));
            return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
          },
          signal: () => true,
        },
      });
      expect(await fromLink.resolve(plugin, program)).toMatchObject({ executable: join(links, program) });
      fromLink.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** The toolchain's Python, which runs a fake STM32_Programmer_CLI that only records its arguments. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
const step = (args: readonly string[]) => ({ toolCalls: [{ name: "run_program", args: { program, args } }] });
const script = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n");

/** A workbench whose sessions run the plugin through the given resolver. */
async function workbench(resolver: core.ProgramResolver, scripts: Record<string, unknown[]>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-stm32-session-")));
  const bench = join(root, "bench");
  const starts: (readonly string[])[] = [];
  const native = new core.NodeProcessHost(spawn);
  const host: core.ProcessHost = {
    platform: native.platform,
    env: native.env,
    spawn(executable, args, options) {
      starts.push([...args]);
      return native.spawn(executable, args, options);
    },
    signal: native.signal.bind(native),
  };
  const runner = new core.ProgramRunner({ host, clock: { sleep } });
  await mkdir(join(bench, ".vera"), { recursive: true });
  await mkdir(join(bench, "fixtures"));
  await copyFile(join(fixtures, "blink.hex"), join(bench, "fixtures/blink.hex"));
  await mkdir(join(root, "scripts"));
  for (const [name, items] of Object.entries(scripts))
    await writeFile(join(root, `scripts/${name}.jsonl`), script(items));
  const store = new core.PluginStore({ root: join(root, "plugins") });
  await store.install(fileURLToPath(source));
  const plugin = await store.load("stm32-cubeprog");
  const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
  await gateway.models("replay", new AbortController().signal);
  const database = await core.openDb(join(bench, ".vera/vera.db"), {
    workbenchId: "wb_test",
    appVersion: "0",
  });
  let model = "";
  const service = new core.SessionService({
    root: bench,
    db: database.db,
    gateway,
    clock: { now: () => new Date(), sleep },
    model: () => model,
    prompt: () => "Use the STM32 plugin",
    programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver },
  });
  await service.waitReady();
  const session = (name: string, mode: "ask" | "auto-edit" | "bypass") => {
    model = `replay/${name}`;
    const created = service.create(null, mode);
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(created.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    const pending = () => service.get(created.id).snapshot.approvals.find((item) => !item.decision);
    return { id: created.id, outputs, pending };
  };
  const close = async () => {
    await service.close();
    await runner.stopAll();
    database.close();
    await rm(root, { recursive: true, force: true });
  };
  return { root, plugin, service, session, starts, close };
}

it("waits for the typed word before an option-byte write and refuses script files", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "vera-stm32-fake-")));
  const record = join(dir, "runs.jsonl");
  const fake = join(dir, "fake_cli.py");
  await writeFile(
    fake,
    [
      "import json, sys",
      `with open(${JSON.stringify(record)}, "a") as log: log.write(json.dumps(sys.argv[1:]) + "\\n")`,
      'print("ST-LINK SN : 0670FF000000000000000000")',
    ].join("\n"),
  );
  const runs = async () =>
    (await readFile(record, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  const display = ["-c", "port=SWD", "-ob", "displ"];
  const level1 = ["-c", "port=SWD", "-ob", "RDP=0xBB"];
  const bench = await workbench(
    { resolve: async () => ({ executable: python, prefix: [fake] }) },
    {
      ob: [step(display), step(level1), { text: "Read protection set." }],
      script: [step(["-script", "flash.prg"]), { text: "Refused." }],
    },
  );
  try {
    const { service } = bench;
    const session = bench.session("ob", "auto-edit");
    service.send(session.id, "Show the option bytes and set read protection level 1.");
    await expect.poll(session.pending, { timeout: 60_000 }).toBeDefined();
    const approval = session.pending();
    if (!approval) throw Error("Expected the option-byte approval");
    // auto-edit runs the device-read display by mode; the option-byte write waits for the typed word.
    expect(await runs()).toEqual([display]);
    expect(approval.program).toMatchObject({ risk: "irreversible", confirm: "-ob", args: level1 });
    const decide = (confirmation?: string) =>
      service.decideApproval({
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
        ...(confirmation === undefined ? {} : { confirmation }),
      });
    expect(() => decide()).toThrow();
    expect(() => decide("RDP")).toThrow();
    expect(await runs()).toEqual([display]);
    decide("-ob");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(await runs()).toEqual([display, level1]);

    const refused = bench.session("script", "bypass");
    service.send(refused.id, "Run the flashing script.");
    expect(await service.waitIdle(refused.id)).toEqual({ stopReason: "end" });
    expect(refused.outputs.map((output) => output.ok)).toEqual([false]);
    expect(service.get(refused.id).snapshot.approvals).toEqual([]);
    expect(await runs()).toEqual([display, level1]);
  } finally {
    await bench.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

it("runs the installed CLI for board-free commands and fails a connection without a probe", async (ctx) => {
  const storeRoot = await realpath(await mkdtemp(join(tmpdir(), "vera-stm32-real-")));
  const store = new core.PluginStore({ root: join(storeRoot, "plugins") });
  await store.install(fileURLToPath(source));
  const provisioner = new core.Provisioner({
    store,
    host: new core.NodeProcessHost(spawn),
    root: join(storeRoot, "runtime"),
    platform: windows ? "windows-x64" : "linux-x64",
    clock: { sleep },
    settings: () => undefined,
    fetch: async () => {
      throw Error("STM32CubeProgrammer must never download");
    },
  });
  const resolved = await provisioner.resolve(await store.load("stm32-cubeprog"), program);
  if (!resolved) {
    provisioner.close();
    await rm(storeRoot, { recursive: true, force: true });
    ctx.skip("STM32_Programmer_CLI is not installed on this host");
    return;
  }
  expect(resolved.executable).toMatch(/STM32_Programmer_CLI(\.exe)?$|stm32_programmer_cli$/i);
  const quiet = [["--version"], ["-l", "st-link-only"], ["-fchecksum", "fixtures/blink.hex"]];
  // A serial number no probe has: an attached ST-LINK and board are never touched.
  const connect = ["-c", "port=SWD", "sn=VERA0000000000000000000"];
  const bench = await workbench(provisioner, {
    real: [...quiet.map(step), step(connect), { text: "Done." }],
  });
  try {
    const { service } = bench;
    const session = bench.session("real", "ask");
    const before = bench.starts.length;
    service.send(session.id, "Identify the STM32 tools and the board.");
    await expect.poll(session.pending, { timeout: 120_000 }).toBeDefined();
    const approval = session.pending();
    if (!approval) throw Error("Expected the connection approval");
    expect(approval.program).toMatchObject({ risk: "device-read", args: connect });
    expect(session.outputs).toHaveLength(quiet.length);
    service.decideApproval({
      sessionId: session.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision: "approved",
    });
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(bench.starts.length - before).toBe(quiet.length + 1);
    const results = session.outputs.map(
      (output) => JSON.parse(output.summary) as { exitCode: number; output: string },
    );
    expect(results[0]?.output).toMatch(/STM32CubeProgrammer version: \d+\.\d+\.\d+/);
    expect(results[1]?.exitCode, results[1]?.output).toBe(0);
    expect(results[2]?.exitCode, results[2]?.output).toBe(0);
    expect(results[3]?.exitCode).not.toBe(0);
    expect(results[3]?.output).toMatch(/Error/);
    // Output texts measured on 2.23.0 only.
    if (resolved.version === "2.23.0") {
      expect(results[1]?.output).toContain("STLink Interface");
      expect(results[2]?.output).toContain("Checksum = 0x000001F0");
    }
  } finally {
    await bench.close();
    provisioner.close();
    await rm(storeRoot, { recursive: true, force: true });
  }
}, 240_000);
