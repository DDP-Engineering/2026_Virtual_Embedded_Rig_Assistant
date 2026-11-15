// The zephyr plugin (LAB-07). Default tests check the package and its rules, and run the real helpers (zephyr_tool.py,
// zephyr_flash.py) with the pinned Python environment against stand-ins: a fake Zephyr tree (version files, boards,
// zephyr's west-commands with a `flash` extension the real west loads, a Twister stand-in), a fake SDK layout and a
// CMake/Ninja stand-in (tests/fixtures/zephyr/stand-ins/). That is offline evidence of the helper's checks, command
// lines, environment, results and lifecycle, never of Zephyr, CMake or Twister themselves.
// VERA_ZEPHYR_PYTHON names a Python with the helper's pinned dependencies (a uv venv); without it the helper tests are
// skipped. VERA_ZEPHYR_REAL names a scratch folder with the real workspace (ws/, Zephyr v4.4.2 + cmsis_6 + hal_stm32)
// and SDK (sdk/zephyr-sdk-1.0.1): the opt-in tests build the fixtures with the real tools; with VERA_RENODE_REAL also
// run them on the real Renode, with VERA_ZEPHYR_REAL_CLI also drive the real STM32_Programmer_CLI (no board attached).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import {
  classifyCommand,
  type LabResource,
  labRegistrySchema,
  labResourceKeys,
  type PluginManifest,
  validatePluginManifest,
} from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const plugins = join(software, "plugins");
const pluginFolder = join(plugins, "zephyr");
const toolScript = join(pluginFolder, "scripts", "zephyr_tool.py");
const flashScript = join(pluginFolder, "scripts", "zephyr_flash.py");
const fixtures = fileURLToPath(new URL("../fixtures/zephyr/", import.meta.url));
const standIns = join(fixtures, "stand-ins");
const demoElf = fileURLToPath(new URL("../fixtures/renode/firmware/demo.elf", import.meta.url));
const windows = process.platform === "win32";
const helperPython = process.env.VERA_ZEPHYR_PYTHON;
const realRoot = process.env.VERA_ZEPHYR_REAL;
const realRenode = process.env.VERA_RENODE_REAL;
const realCli = process.env.VERA_ZEPHYR_REAL_CLI;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const OUTPUT_LIMIT = 11_000;
const SHA = { zephyr: "1".repeat(40), hal_fake: "2".repeat(40), other: "3".repeat(40) };
const PROBE = "0483:374B:066DFF495754888367143220";

// biome-ignore lint/suspicious/noExplicitAny: the helper's JSON documents, checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
}

let root = "";
let ws = "";
let wb = "";
let sdk = "";
const posix = (path: string) => path.replaceAll("\\", "/");

function gitHead(folder: string, sha: string) {
  return mkdir(join(folder, ".git"), { recursive: true }).then(() =>
    writeFile(join(folder, ".git", "HEAD"), `${sha}\n`),
  );
}
function westYml(extra = "") {
  return `manifest:
  projects:
    - name: zephyr
      url: https://example.invalid/zephyr
      revision: ${SHA.zephyr}
      west-commands: scripts/west-commands.yml
    - name: hal_fake
      url: https://example.invalid/hal_fake
      revision: ${SHA.hal_fake}
      path: modules/hal/fake
${extra}  self:
    path: manifest
`;
}
async function bench() {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-zephyr-")));
  ws = join(root, "ws");
  wb = join(root, "wb");
  sdk = join(root, "sdk");
  await cp(join(standIns, "zephyr"), join(ws, "zephyr"), { recursive: true });
  await cp(join(standIns, "hal_fake"), join(ws, "modules", "hal", "fake"), { recursive: true });
  await gitHead(join(ws, "zephyr"), SHA.zephyr);
  await gitHead(join(ws, "modules", "hal", "fake"), SHA.hal_fake);
  await mkdir(join(ws, "manifest"), { recursive: true });
  await writeFile(join(ws, "manifest", "west.yml"), westYml());
  await mkdir(join(ws, ".west"));
  await writeFile(join(ws, ".west", "config"), "[manifest]\npath = manifest\nfile = west.yml\n");
  await mkdir(join(sdk, "cmake"), { recursive: true });
  await writeFile(join(sdk, "sdk_version"), "1.0.1\n");
  await writeFile(join(sdk, "cmake", "Zephyr-sdkConfig.cmake"), "# stand-in\n");
  const gcc = join(sdk, "gnu", "arm-zephyr-eabi", "bin");
  await mkdir(gcc, { recursive: true });
  await writeFile(join(gcc, windows ? "arm-zephyr-eabi-gcc.exe" : "arm-zephyr-eabi-gcc"), "");
  await cp(join(fixtures, "apps", "board-demo"), join(wb, "apps", "board-demo"), { recursive: true });
  await cp(join(fixtures, "tests", "ztest-basic"), join(wb, "tests", "ztest-basic"), { recursive: true });
  await mkdir(join(wb, "zephyr"));
  await mkdir(join(wb, ".vera"));
  fake({});
}
const fake = (fields: Json) =>
  writeFileSync(join(ws, "fake.json"), JSON.stringify({ elf: demoElf, ...fields }));
const calls = (): Json[] =>
  existsSync(join(ws, "calls.jsonl"))
    ? readFileSync(join(ws, "calls.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
function baseRequest(fields: Json = {}): Json {
  return {
    format: 1,
    kind: "zephyr-request",
    workspace: posix(ws),
    manifest: "manifest",
    projects: [
      { name: "zephyr", revision: SHA.zephyr },
      { name: "hal_fake", revision: SHA.hal_fake },
    ],
    sdk: posix(sdk),
    app: "apps/board-demo",
    board: "stm32f4_disco",
    configs: ["prj.conf"],
    overlays: ["console.overlay"],
    buildDir: "build/board-demo",
    ...fields,
  };
}
function request(name: string, fields: Json = {}) {
  writeFileSync(join(wb, "zephyr", `${name}.json`), JSON.stringify(baseRequest(fields)));
  return `zephyr/${name}.json`;
}
function hostPath(): string {
  // git (Zephyr's module script reads the manifest through it) and the system folders, as VERA's runner passes PATH.
  return (process.env.PATH ?? "").split(delimiter).filter(Boolean).join(delimiter);
}
function helper(script: string, args: string[], extra: Record<string, string> = {}, real = false): Run {
  const env: NodeJS.ProcessEnv = { PATH: hostPath(), PYTHONDONTWRITEBYTECODE: "1", ...extra };
  for (const name of [
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
    "LOCALAPPDATA",
    "APPDATA",
  ])
    if (process.env[name]) env[name] = process.env[name];
  if (!real) {
    env.VERA_ZEPHYR_TEST = "1";
    env.VERA_ZEPHYR_TEST_CMAKE = join(standIns, "fake_cmake.py");
  }
  // Variables a user may have set: the helper must not let them through.
  env.ZEPHYR_BASE = "C:/elsewhere/zephyr";
  env.ZEPHYR_TOOLCHAIN_VARIANT = "gnuarmemb";
  env.WEST_CONFIG_GLOBAL = join(root, "user-westconfig");
  const result = spawnSync(helperPython ?? "python", [script, ...args], {
    cwd: wb,
    env,
    encoding: "utf8",
    timeout: real ? 1_800_000 : 120_000,
  });
  const stdout = result.stdout ?? "";
  expect(
    [0, 1, 2, 3],
    `exit ${result.status}: ${(result.stderr ?? "").slice(-2000)}${stdout.slice(-1500)}`,
  ).toContain(result.status);
  expect(stdout.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
  let json: Json = {};
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
  } catch {
    json = { unparsed: stdout };
  }
  expect(json.code, JSON.stringify(json).slice(0, 1500)).not.toBe("internal");
  return { code: result.status, json, stdout };
}
const zephyr = (args: string[], extra: Record<string, string> = {}) => helper(toolScript, args, extra);
const resultOf = (run: Run): Json => JSON.parse(readFileSync(join(wb, run.json.result), "utf8"));
const folderOf = (run: Run) => dirname(join(wb, run.json.result));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("package", { timeout: 60_000 }, () => {
  it("publishes the official zephyr package with its programs, pins, pack group, metadata and skill", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({
      id: "zephyr",
      version: "0.2.0",
      ecosystem: "lab",
      platforms: ["windows-x64", "linux-x64"],
    });
    expect(m.programs.zephyr).toMatchObject({ install: { script: "scripts/zephyr_tool.py" } });
    expect(m.programs.zephyr?.uses).toBeUndefined();
    expect(m.programs["zephyr-flash"]).toMatchObject({
      install: { script: "scripts/zephyr_flash.py" },
      uses: ["stm32_programmer_cli"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's literal workbench placeholder.
      env: { ZEPHYR_FLASH_REGISTRY: "${workbench}/lab/resources.json" },
      resources: { option: "--probe", kinds: ["probe"], grace: 30, cleanup: ["release"], cleanupTimeout: 30 },
    });
    const tool = readFileSync(toolScript, "utf8");
    for (const pin of ["west==1.5.0", "cmake==4.4.4", "ninja==1.13.2", "PyYAML==6.0.3", "pytest==9.2.0"])
      expect(tool).toContain(`"${pin}"`);
    expect(tool).not.toMatch(/"[A-Za-z0-9_.-]+(>=|~=|<)/);
    expect(readFileSync(flashScript, "utf8")).toContain('"west==1.5.0"');
    const catalog = parse(readFileSync(join(plugins, "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("zephyr");
    expect(catalog.metadata.zephyr.activities).toEqual(["build", "testing", "flash"]);
    const packs = parse(readFileSync(join(plugins, "packs.yaml"), "utf8"));
    const lab = packs.find((pack: { id: string }) => pack.id === "lab");
    expect(lab.groups).toContainEqual({
      name: "Zephyr builds and tests",
      plugins: ["zephyr"],
      default: true,
    });
    expect(await core.checkCatalogSource(plugins)).toEqual([]);
    const temp = await realpath(await mkdtemp(join(tmpdir(), "vera-zephyr-pkg-")));
    try {
      const store = new core.PluginStore({ root: join(temp, "plugins") });
      await store.install(pluginFolder);
      const installed = await store.load("zephyr");
      const skills = new core.SkillCatalog({
        root: temp,
        disabled: () => [],
        plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
      });
      const names = (await skills.list())
        .filter((skill) => skill.plugin === "zephyr")
        .map((skill) => skill.name);
      expect(names).toEqual(["zephyr-builds"]);
      const usage = (await skills.read("plugin", "zephyr-builds")).content;
      for (const text of ["zephyr inspect", "hooks", "build-only", "test-run", "zephyr-flash flash", "never"])
        expect(usage).toContain(text);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("keeps workspace.py and elf.py byte-identical with the other lab plugins", async () => {
    const own = (name: string) => readFile(join(pluginFolder, "scripts", "zephyr_support", name));
    const gdb = (name: string) => readFile(join(plugins, "gdb-debug", "scripts", "gdb_support", name));
    expect(sha256(await own("workspace.py"))).toBe(sha256(await gdb("workspace.py")));
    expect(sha256(await own("elf.py"))).toBe(sha256(await gdb("elf.py")));
  });
});

describe("risk of each operation (REQ-SEC-50f66b49)", () => {
  it("rates reads safe, host execution and deletion device-write, flash by its effect and blocks the CLI", () => {
    const rules = manifest().rules;
    const cases: [string, string, string[]][] = [
      ["blocked", "stm32_programmer_cli", ["--version"]],
      ["blocked", "stm32_programmer_cli", ["-c", "port=swd", "-w", "x.hex"]],
      ["safe", "zephyr", ["--version"]],
      ["safe", "zephyr", ["tools"]],
      ["safe", "zephyr", ["tools", "--request", "r.json"]],
      ["safe", "zephyr", ["inspect", "--request", "r.json"]],
      ["safe", "zephyr", ["artifacts", "--request", "r.json"]],
      ["safe", "zephyr", ["test-run", "--test-build", "a", "--scenario", "s", "--evidence", "b"]],
      ["safe", "zephyr", ["differences", "--build", "a", "--evidence", "b"]],
      ["device-write", "zephyr", ["build", "--request", "r.json"]],
      ["device-write", "zephyr", ["build", "--request", "r.json", "--pristine"]],
      ["device-write", "zephyr", ["test-build", "--request", "r.json"]],
      ["device-write", "zephyr", ["clean", "--request", "r.json"]],
      ["device-write", "zephyr", ["prepare-workspace", "--request", "r.json"]],
      ["safe", "zephyr-flash", ["tools"]],
      ["safe", "zephyr-flash", ["release", "--probe", "stlink-a"]],
      [
        "device-write",
        "zephyr-flash",
        ["flash", "--request", "r", "--build", "b", "--probe", "p", "--firmware-effect", "none"],
      ],
      [
        "irreversible",
        "zephyr-flash",
        ["flash", "--request", "r", "--build", "b", "--probe", "p", "--firmware-effect", "actuates"],
      ],
    ];
    for (const [expected, program, args] of cases)
      expect(classifyCommand(rules, program, args).risk, `${program} ${args.join(" ")}`).toBe(expected);
    const build = classifyCommand(rules, "zephyr", ["build", "--request", "r.json"]);
    expect(build.timeout).toBe(3600);
    expect(build.notes.join(" ")).toMatch(
      /Host execution.*approval is not a sandbox.*Never contacts the network/,
    );
    expect(classifyCommand(rules, "zephyr", ["prepare-workspace", "--request", "r"]).notes.join(" ")).toMatch(
      /Contacts the network/,
    );
  });
});

describe.skipIf(!helperPython)("zephyr helper against stand-ins (offline)", { timeout: 180_000 }, () => {
  beforeEach(async () => {
    await bench();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  it("reports tools, SDK candidates and the workspace's versions without building (REQ-FUNC-b9bd62a7)", () => {
    const bare = zephyr(["tools"]);
    expect(bare.code).toBe(0);
    expect(bare.json).toMatchObject({
      kind: "zephyr-tools",
      west: { version: "1.5.0" },
      supported: { zephyr: ">=4.4,<4.6" },
    });
    expect(bare.json.cmake.version).toBe("4.4.4");
    expect(bare.json.zephyr).toBeUndefined();
    const full = zephyr(["tools", "--request", request("tools")]);
    expect(full.json).toMatchObject({
      status: "pass",
      zephyr: { version: "4.4.2", sdkMinimum: "1.0.1" },
      board: { target: "stm32f4_disco/stm32f407xx", arch: "arm" },
      sdk: { version: "1.0.1" },
      projects: [
        { name: "zephyr", head: SHA.zephyr, requested: SHA.zephyr },
        { name: "hal_fake", head: SHA.hal_fake, requested: SHA.hal_fake },
      ],
    });
    expect(calls().filter((c) => c.tool === "cmake")).toEqual([]);
    expect(existsSync(join(wb, "embedded-lab-results"))).toBe(false);
  });

  it("inspects the workspace offline with board, inputs, projects, commands and modules (REQ-FUNC-fcf6c054)", () => {
    const run = zephyr(["inspect", "--request", request("inspect")]);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({
      kind: "zephyr-inspect",
      status: "pass",
      board: {
        name: "stm32f4_disco",
        qualifiers: "stm32f407xx",
        target: "stm32f4_disco/stm32f407xx",
        verified: true,
      },
      modules: [{ project: "hal_fake", cmake: ".", settings: ["dts_root"] }],
    });
    expect(run.json.commands).toEqual([
      expect.objectContaining({ project: "zephyr", commands: ["flash", "build"] }),
    ]);
    expect(run.json.inputs.map((i: Json) => [i.role, i.sha256])).toEqual([
      ["config", sha256(readFileSync(join(wb, "apps", "board-demo", "prj.conf")))],
      ["overlay", sha256(readFileSync(join(wb, "apps", "board-demo", "console.overlay")))],
    ]);
    expect(calls()).toEqual([]);
  });

  it("refuses wrong boards, inputs, SDKs and Zephyr versions before any process, writing nothing (L07-B, REQ-REL-cb83210f)", async () => {
    const cases: [Json, string][] = [
      [{ board: "stm32f4_disco@B" }, "board-revision"],
      [{ board: "stm32f4_disco/nosuchsoc" }, "board-qualifier"],
      [{ board: "nosuch_board" }, "board"],
      [{ board: "acme_revboard@C/socone/cpuapp" }, "board-revision"],
      [{ board: "acme_revboard@B" }, "board-qualifier"],
      [{ configs: ["missing.conf"] }, "input"],
      [{ overlays: ["missing.overlay"] }, "input"],
      [{ configs: ["../../outside.conf"] }, "request"],
      [{ sdk: posix(join(root, "nosdk")) }, "input"],
      [{ buildDir: "apps/board-demo/build" }, "build-dir"],
      [{ buildDir: ".vera/build" }, "build-dir"],
    ];
    for (const [fields, code] of cases) {
      const run = zephyr(["build", "--request", request("bad", fields)]);
      expect([run.code, run.json.code], JSON.stringify(fields)).toEqual([2, code]);
    }
    // A board with revisions and qualifiers resolves; its riscv architecture needs a toolchain this SDK lacks.
    const riscv = zephyr([
      "build",
      "--request",
      request("riscv", { board: "acme_revboard@A/socone/cpuapp" }),
    ]);
    expect([riscv.code, riscv.json.code]).toEqual([2, "sdk-toolchain"]);
    await mkdir(join(root, "empty-sdk"));
    expect(
      zephyr(["build", "--request", request("nosdk", { sdk: posix(join(root, "empty-sdk")) })]).json.code,
    ).toBe("sdk-missing");
    await writeFile(join(sdk, "sdk_version"), "0.17.4\n");
    expect(zephyr(["build", "--request", request("oldsdk")]).json.code).toBe("sdk-version");
    await writeFile(join(sdk, "sdk_version"), "1.0.1\n");
    await rm(join(sdk, "gnu"), { recursive: true });
    expect(zephyr(["build", "--request", request("notool")]).json.code).toBe("sdk-toolchain");
    await writeFile(join(ws, "zephyr", "VERSION"), "VERSION_MAJOR = 3\nVERSION_MINOR = 7\nPATCHLEVEL = 0\n");
    expect(zephyr(["build", "--request", request("oldzephyr")]).json.code).toBe("zephyr-version");
    for (const document of [
      { ...baseRequest(), format: 2 },
      { ...baseRequest(), extra: 1 },
    ]) {
      writeFileSync(join(wb, "zephyr", "doc.json"), JSON.stringify(document));
      expect(zephyr(["build", "--request", "zephyr/doc.json"]).json).toMatchObject({
        status: "refused",
        code: "request",
      });
    }
    expect(calls()).toEqual([]);
    expect(existsSync(join(wb, "embedded-lab-results"))).toBe(false);
    expect(existsSync(join(wb, "build"))).toBe(false);
  });

  it("refuses unlisted projects, extensions and build hooks unless approved by hash (L07-F, REQ-SEC-8c4432cd)", async () => {
    const app = join(wb, "apps", "board-demo");
    const refusedWith = (name: string, fields: Json = {}) => {
      const run = zephyr(["build", "--request", request(name, fields)]);
      expect(run.code, name).toBe(2);
      expect(run.json.code).toBe("preflight");
      return run.json.detail.findings as Json[];
    };
    const original = readFileSync(join(app, "CMakeLists.txt"), "utf8");
    // A CMake command outside the allowlist, then approved by hash, then changed after the approval.
    await writeFile(join(app, "CMakeLists.txt"), `${original}execute_process(COMMAND calc.exe)\n`);
    const found = refusedWith("cmake");
    expect(found).toEqual([
      expect.objectContaining({ code: "app-cmake", file: expect.stringContaining("CMakeLists.txt") }),
    ]);
    const hooks = [{ file: found[0]?.file, sha256: found[0]?.sha256, reason: "user reviewed" }];
    expect(zephyr(["inspect", "--request", request("cmake-ok", { hooks })]).json.findings).toContainEqual(
      expect.objectContaining({ code: "app-cmake", approved: true, refuse: false }),
    );
    await writeFile(join(app, "CMakeLists.txt"), `${original}execute_process(COMMAND other.exe)\n`);
    expect(refusedWith("cmake-changed", { hooks })[0]?.code).toBe("app-cmake");
    // Commands hidden from a naive scan: a quoted "#[[", a byte-order mark, a find_package with a HINTS path.
    const hidden = [
      `${original}target_sources(app PRIVATE "#[[")\nexecute_process(COMMAND x)\ntarget_sources(app PRIVATE "]]")\n`,
      `\ufeffexecute_process(COMMAND x)\n${original}`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: CMake variable syntax, written literally.
      original.replace("HINTS $ENV{ZEPHYR_BASE}", "HINTS ${CMAKE_CURRENT_SOURCE_DIR}/evil"),
    ];
    for (const [index, text] of hidden.entries()) {
      await writeFile(join(app, "CMakeLists.txt"), text);
      expect(
        refusedWith(`hidden${index}`).map((f) => f.code),
        text.slice(0, 40),
      ).toEqual(["app-cmake"]);
    }
    await writeFile(join(app, "CMakeLists.txt"), original);
    // Kconfig macro, sysbuild, implicit board input: each refused, then approved by its hash.
    const approvable = async (name: string, code: string) => {
      const findings = refusedWith(name);
      expect(findings.map((f) => f.code)).toEqual([code]);
      const hook = { hooks: [{ file: findings[0]?.file, sha256: findings[0]?.sha256 }] };
      expect(zephyr(["inspect", "--request", request(`${name}-ok`, hook)]).code, name).toBe(0);
    };
    await writeFile(join(app, "Kconfig"), 'config X\n\tdefault "$(shell,whoami)"\nsource "Kconfig.zephyr"\n');
    await approvable("kconfig", "kconfig-macro");
    await rm(join(app, "Kconfig"));
    await writeFile(join(app, "sysbuild.conf"), "SB_CONFIG_BOOTLOADER_MCUBOOT=y\n");
    await approvable("sysbuild", "sysbuild");
    await rm(join(app, "sysbuild.conf"));
    await mkdir(join(app, "boards"));
    await writeFile(join(app, "boards", "stm32f4_disco.overlay"), "/ { };\n");
    await approvable("implicit", "implicit-input");
    expect(
      zephyr(["inspect", "--request", request("listed", { overlays: ["boards/stm32f4_disco.overlay"] })])
        .code,
    ).toBe(0);
    await rm(join(app, "boards"), { recursive: true });
    // Workspace: an unlisted project with extension commands, a shadowing one, a moved HEAD, a local config key.
    await cp(join(standIns, "other"), join(ws, "other"), { recursive: true });
    await gitHead(join(ws, "other"), SHA.other);
    const otherProject = `    - name: other
      url: https://example.invalid/other
      revision: ${SHA.other}
      west-commands: scripts/west-commands.yml
`;
    await writeFile(join(ws, "manifest", "west.yml"), westYml(otherProject));
    expect(refusedWith("unlisted").map((f) => f.code)).toEqual(["project-unlisted", "extension-command"]);
    const listed = { projects: [...baseRequest().projects, { name: "other", revision: SHA.other }] };
    const extension = refusedWith("listed-other", listed);
    expect(extension.map((f) => f.code)).toEqual(["extension-command"]);
    const approved = { ...listed, hooks: [{ file: extension[0]?.file, sha256: extension[0]?.sha256 }] };
    expect(zephyr(["inspect", "--request", request("approved-ext", approved)]).code).toBe(0);
    await writeFile(
      join(ws, "other", "scripts", "west-commands.yml"),
      "west-commands:\n  - file: x.py\n    commands:\n      - name: build\n        class: B\n",
    );
    const shadow = refusedWith("shadow", listed);
    expect(shadow.map((f) => f.code)).toEqual(["extension-shadow"]);
    const shadowHook = { ...listed, hooks: [{ file: shadow[0]?.file, sha256: shadow[0]?.sha256 }] };
    expect(refusedWith("shadow-hook", shadowHook).map((f) => f.code)).toEqual(["extension-shadow"]);
    await writeFile(join(ws, "manifest", "west.yml"), westYml());
    await gitHead(join(ws, "modules", "hal", "fake"), "4".repeat(40));
    expect(refusedWith("moved").map((f) => f.code)).toEqual(["project-checkout"]);
    await gitHead(join(ws, "modules", "hal", "fake"), SHA.hal_fake);
    await writeFile(
      join(ws, ".west", "config"),
      "[manifest]\npath = manifest\n[build]\ncmake-args = -DX=1\n",
    );
    expect(refusedWith("config").map((f) => f.code)).toEqual(["west-config"]);
    await writeFile(join(ws, ".west", "config"), "[manifest]\npath = manifest\nfile = west.yml\n");
    // A pytest harness in a test scenario.
    const tests = {
      app: "tests/ztest-basic",
      overlays: [],
      buildDir: "build/ztest",
      tests: { root: "tests/ztest-basic", scenarios: ["vera.ztest.pass"] },
    };
    await writeFile(
      join(wb, "tests", "ztest-basic", "testcase.yaml"),
      "tests:\n  vera.ztest.pass:\n    harness: pytest\n",
    );
    const harness = zephyr(["test-build", "--request", request("harness", tests)]);
    expect(harness.json.detail.findings.map((f: Json) => f.code)).toEqual(["testcase"]);
    const harnessFinding = harness.json.detail.findings[0] as Json;
    const harnessHook = { ...tests, hooks: [{ file: harnessFinding.file, sha256: harnessFinding.sha256 }] };
    const harnessOk = zephyr(["inspect", "--request", request("harness-ok", harnessHook)]);
    expect(harnessOk.json.tests.findings).toContainEqual(
      expect.objectContaining({ code: "testcase", approved: true }),
    );
    await writeFile(
      join(wb, "tests", "ztest-basic", "testcase.yaml"),
      "tests:\n  vera.ztest.pass:\n    extra_conf_files: [other.conf]\n",
    );
    expect(
      zephyr(["test-build", "--request", request("extra", tests)]).json.detail.findings.map(
        (f: Json) => f.code,
      ),
    ).toEqual(["testcase"]);
    // Twister builds every suite below -T with that scenario name, and sample.yaml wins over testcase.yaml.
    await writeFile(join(wb, "tests", "ztest-basic", "testcase.yaml"), "tests:\n  vera.ztest.pass: {}\n");
    await mkdir(join(wb, "tests", "ztest-basic", "sub"));
    await writeFile(
      join(wb, "tests", "ztest-basic", "sub", "testcase.yaml"),
      "tests:\n  vera.ztest.pass: {}\n",
    );
    await writeFile(join(wb, "tests", "ztest-basic", "sample.yaml"), "tests:\n  vera.ztest.pass: {}\n");
    const nested = zephyr(["test-build", "--request", request("nested", tests)]);
    const nestedFindings = nested.json.detail.findings as Json[];
    expect(nestedFindings.map((f) => f.code)).toEqual(["testcase-nested", "testcase-nested"]);
    const nestedHooks = { ...tests, hooks: nestedFindings.map((f) => ({ file: f.file, sha256: f.sha256 })) };
    expect(zephyr(["test-build", "--request", request("nested-hook", nestedHooks)]).json.code).toBe(
      "preflight",
    );
    expect(calls()).toEqual([]);
  });

  it("builds with the explicit modules, a scrubbed offline environment and hashed artifacts (L07-A/C, REQ-FUNC-d4eb8664, REQ-SEC-f67c1f73)", () => {
    const run = zephyr(["build", "--request", request("ok")]);
    expect(run.code, JSON.stringify(run.json)).toBe(0);
    const result = resultOf(run);
    expect(result).toMatchObject({
      kind: "zephyr-result",
      operation: "build",
      state: "done",
      status: "pass",
      evidence: "build",
      buildFolder: "created",
      board: { target: "stm32f4_disco/stm32f407xx" },
      tools: { west: "1.5.0", zephyr: { version: "4.4.2" }, sdk: { version: "1.0.1" } },
      workspace: {
        projects: [
          { name: "zephyr", head: SHA.zephyr },
          { name: "hal_fake", head: SHA.hal_fake },
        ],
      },
      size: {
        regions: [
          { name: "FLASH", used: 16756, size: 1048576 },
          { name: "RAM", used: 4480, size: 131072 },
        ],
      },
    });
    expect(result.request.sha256).toBe(sha256(readFileSync(join(wb, "zephyr", "ok.json"))));
    const marker = JSON.parse(
      readFileSync(join(wb, "build", "board-demo", ".vera-zephyr-build.json"), "utf8"),
    );
    expect(Object.keys(marker).sort()).toEqual(
      [
        "created",
        "family",
        "fingerprint",
        "format",
        "kind",
        "lastRun",
        "lastStatus",
        "regions",
        "request",
        "runId",
        "updated",
      ].sort(),
    );
    expect(marker).toMatchObject({
      format: 1,
      kind: "zephyr-build-dir",
      family: "build",
      runId: run.json.runId,
      lastStatus: "pass",
    });
    expect(result.artifacts.map((a: Json) => a.role)).toEqual([
      "elf",
      "hex",
      "bin",
      "config",
      "devicetree",
      "map",
      "build-info",
      "runners",
    ]);
    for (const artifact of result.artifacts)
      expect(sha256(readFileSync(join(folderOf(run), artifact.path)))).toBe(artifact.sha256);
    expect(result.artifacts[0].sha256).toBe(sha256(readFileSync(demoElf)));
    const cmake = calls().filter((c) => c.tool === "cmake");
    expect(cmake).toHaveLength(2);
    const configure = cmake[0] as Json;
    const define = (name: string) =>
      configure.args.find((a: string) => a.startsWith(`-D${name}=`))?.slice(name.length + 3);
    expect(define("BOARD")).toBe("stm32f4_disco");
    expect(define("ZEPHYR_MODULES")).toBe(posix(join(ws, "modules", "hal", "fake")));
    expect(define("ZEPHYR_TOOLCHAIN_VARIANT")).toBe("zephyr");
    expect(define("Zephyr_DIR")).toBe(posix(join(ws, "zephyr", "share", "zephyr-package", "cmake")));
    expect(define("CONF_FILE")?.endsWith("apps/board-demo/prj.conf")).toBe(true);
    expect(define("DTC_OVERLAY_FILE")?.endsWith("apps/board-demo/console.overlay")).toBe(true);
    expect(cmake[1]?.args.slice(0, 1)).toEqual(["--build"]);
    const env = configure.env as Json;
    expect(posix(env.ZEPHYR_BASE).toLowerCase()).toBe(posix(join(ws, "zephyr")).toLowerCase());
    expect(env.ZEPHYR_TOOLCHAIN_VARIANT).toBeUndefined();
    expect(env.VERA_ZEPHYR_TEST).toBeUndefined();
    expect(env.WEST_CONFIG_GLOBAL).toContain(run.json.runId);
    expect([env.HTTP_PROXY, env.HTTPS_PROXY, env.ALL_PROXY]).toEqual(Array(3).fill("http://127.0.0.1:9"));
    expect(env.GIT_ALLOW_PROTOCOL).toBe("file");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(calls().some((c) => c.tool !== "cmake")).toBe(false);
    // A file Zephyr took that the request does not list is an error, never a silent input.
    fake({ undeclared: [posix(join(wb, "apps", "board-demo", "fast.conf"))] });
    const sneaky = zephyr(["build", "--request", request("sneaky", { buildDir: "build/sneaky" })]);
    expect([sneaky.code, sneaky.json.code]).toEqual([3, "undeclared-input"]);
  });

  it("reports failed builds with log-cited diagnostics and unchanged inputs (L07-B, REQ-REL-4d0db53e)", () => {
    const app = join(wb, "apps", "board-demo");
    const before = ["bad.conf", "broken.overlay"].map((name) => sha256(readFileSync(join(app, name))));
    const kconfig = zephyr([
      "build",
      "--request",
      request("kconfig", { extraConfigs: ["bad.conf"], buildDir: "build/k" }),
    ]);
    expect([kconfig.code, kconfig.json.status, kconfig.json.code]).toEqual([1, "fail", "build-failed"]);
    const kresult = resultOf(kconfig);
    const kdiag = kresult.diagnostics.filter((d: Json) => d.code === "kconfig");
    expect(kdiag.length).toBeGreaterThan(0);
    const klog = readFileSync(join(folderOf(kconfig), kdiag[0].log), "utf8").split(/\r?\n/);
    expect(klog[kdiag[0].line - 1]).toContain("undefined symbol VERA_NO_SUCH_SYMBOL");
    expect(kresult.diagnostics.map((d: Json) => d.code)).toContain("cmake-error");
    const dts = zephyr([
      "build",
      "--request",
      request("dts", { overlays: ["broken.overlay"], buildDir: "build/d" }),
    ]);
    expect(dts.code).toBe(1);
    const ddiag = resultOf(dts).diagnostics.find((d: Json) => d.code === "devicetree");
    expect(ddiag).toMatchObject({ log: "configure.log", text: expect.stringContaining("broken.overlay") });
    expect(["bad.conf", "broken.overlay"].map((name) => sha256(readFileSync(join(app, name))))).toEqual(
      before,
    );
    expect(resultOf(dts).steps.map((s: Json) => s.name)).toEqual(["configure"]);
  });

  it("binds each build folder to one configuration; pristine rebuilds, foreign folders stay (L07-B/G, REQ-REL-2de3e20e)", async () => {
    const a = zephyr(["build", "--request", request("a", { buildDir: "build/x" })]);
    expect(a.code).toBe(0);
    const aHex = resultOf(a).artifacts.find((x: Json) => x.role === "hex").sha256;
    const mismatch = zephyr([
      "build",
      "--request",
      request("b", { buildDir: "build/x", extraConfigs: ["fast.conf"] }),
    ]);
    expect([mismatch.code, mismatch.json.code]).toEqual([2, "build-dir-mismatch"]);
    expect(sha256(readFileSync(join(wb, "build", "x", "zephyr", "zephyr.hex")))).toBe(aHex);
    const again = zephyr(["build", "--request", "zephyr/a.json"]);
    expect(resultOf(again).buildFolder).toBe("reused");
    const pristine = zephyr(["build", "--request", "zephyr/b.json", "--pristine"]);
    expect([pristine.code, resultOf(pristine).buildFolder]).toEqual([0, "pristine"]);
    const y = zephyr(["build", "--request", request("y", { buildDir: "build/y" })]);
    const yHex = resultOf(y).artifacts.find((x: Json) => x.role === "hex").sha256;
    const bHex = resultOf(pristine).artifacts.find((x: Json) => x.role === "hex").sha256;
    expect(yHex).toBe(aHex);
    expect(bHex).not.toBe(aHex);
    await mkdir(join(wb, "build", "mine"), { recursive: true });
    await writeFile(join(wb, "build", "mine", "keep.txt"), "mine");
    for (const extra of [[], ["--pristine"]]) {
      const foreign = zephyr([
        "build",
        "--request",
        request("foreign", { buildDir: "build/mine" }),
        ...extra,
      ]);
      expect([foreign.code, foreign.json.code]).toEqual([2, "build-dir-foreign"]);
    }
    expect(readFileSync(join(wb, "build", "mine", "keep.txt"), "utf8")).toBe("mine");
  });

  it("cleans only the owned folder, never through links (L07-G, REQ-SEC-01b0aa08)", async () => {
    expect(zephyr(["build", "--request", request("c", { buildDir: "build/c" })]).code).toBe(0);
    const sources = join(wb, "apps", "board-demo");
    const before = readdirSync(sources).map((name) => [name, existsSync(join(sources, name))]);
    symlinkSync(sources, join(wb, "build", "c", "link-to-sources"), windows ? "junction" : "dir");
    const clean = zephyr(["clean", "--request", "zephyr/c.json"]);
    expect(clean.code).toBe(0);
    expect(existsSync(join(wb, "build", "c"))).toBe(false);
    expect(readdirSync(sources).map((name) => [name, existsSync(join(sources, name))])).toEqual(before);
    expect(zephyr(["clean", "--request", "zephyr/c.json"]).json.code).toBe("build-dir-foreign");
    await mkdir(join(wb, "build", "plain"), { recursive: true });
    expect(zephyr(["clean", "--request", request("plain", { buildDir: "build/plain" })]).json.code).toBe(
      "build-dir-foreign",
    );
    expect(existsSync(join(wb, "build", "plain"))).toBe(true);
    expect(
      zephyr(["clean", "--request", request("out", { buildDir: posix(join(root, "elsewhere")) })]).json.code,
    ).toBe("build-dir");
  });

  it("reports artifacts and memory use of the owned folder without building (REQ-FUNC-d30944ca)", async () => {
    const build = zephyr(["build", "--request", request("art")]);
    const other = zephyr(["artifacts", "--request", request("art-other", { extraConfigs: ["fast.conf"] })]);
    expect([other.code, other.json.code]).toEqual([2, "build-dir-mismatch"]);
    const report = zephyr(["artifacts", "--request", "zephyr/art.json"]);
    expect(report.code).toBe(0);
    const result = resultOf(report);
    expect(result.artifacts.map((a: Json) => a.sha256)).toEqual(
      resultOf(build).artifacts.map((a: Json) => a.sha256),
    );
    expect(result.size.regions.map((r: Json) => r.name)).toEqual(["FLASH", "RAM"]);
    expect(calls().filter((c) => c.tool === "cmake")).toHaveLength(2);
    await rm(join(wb, "build", "board-demo", "zephyr", "zephyr.hex"));
    const missing = zephyr(["artifacts", "--request", "zephyr/art.json"]);
    expect([missing.code, missing.json.code, resultOf(missing).missing]).toEqual([
      3,
      "artifact-missing",
      ["hex"],
    ]);
    await mkdir(join(wb, "build", "plain"), { recursive: true });
    expect(zephyr(["artifacts", "--request", request("pl", { buildDir: "build/plain" })]).code).toBe(2);
  });

  it("builds Twister scenarios build-only: never a pass, even when Twister says passed (L07-D, REQ-FUNC-889949fc)", () => {
    fake({ status: { "vera.ztest.pass": "passed" } });
    const tests = {
      app: "tests/ztest-basic",
      configs: ["prj.conf"],
      overlays: [],
      buildDir: "build/ztest",
      tests: { root: "tests/ztest-basic", scenarios: ["vera.ztest.pass", "vera.ztest.skip"] },
    };
    const run = zephyr(["test-build", "--request", request("tb", tests)]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result).toMatchObject({ status: "incomplete", code: "build-only", evidence: "build-only" });
    expect(result.tests.map((s: Json) => [s.scenario, s.status, s.twister])).toEqual([
      ["vera.ztest.pass", "built", "passed"],
      ["vera.ztest.skip", "built", "not run"],
    ]);
    for (const suite of result.tests) for (const c of suite.cases) expect(c.status).toBe("not-run");
    const junit = readFileSync(join(folderOf(run), "junit.xml"), "utf8");
    expect(junit.match(/<skipped /g)).toHaveLength(6);
    expect(junit).not.toContain("<failure");
    const twister = calls().find((c) => c.tool === "twister") as Json;
    expect(twister.args).toEqual(
      expect.arrayContaining(["--build-only", "-p", "stm32f4_disco", "-s", "vera.ztest.pass"]),
    );
    expect(twister.env.ZEPHYR_TOOLCHAIN_VARIANT).toBe("zephyr");
    expect(twister.env.HTTPS_PROXY).toBe("http://127.0.0.1:9");
    fake({ twisterExit: 1 });
    const failed = zephyr([
      "test-build",
      "--request",
      request("tb2", { ...tests, buildDir: "build/ztest2" }),
    ]);
    expect([failed.code, failed.json.status]).toEqual([1, "fail"]);
  });

  async function evidenceFolder(
    id: string,
    elf: Buffer,
    lines: string[],
    extra: Json = {},
    kind = "renode-result",
  ) {
    const folder = join(wb, "embedded-lab-results", id);
    await mkdir(join(folder, "profile"), { recursive: true });
    await writeFile(
      join(folder, "profile", "stm32f4.repl"),
      "nvic: IRQControllers.NVIC @ sysbus 0xE000E000\n    systickFrequency: 72000000\n",
    );
    const document: Json = {
      format: 1,
      kind,
      runId: id,
      state: "done",
      status: "pass",
      firmware: { sha256: sha256(elf) },
      ...(kind === "renode-result"
        ? {
            profile: { id: "stm32f4-discovery" },
            uart: { name: "usart2", lines: lines.map((text) => ({ text })) },
          }
        : { setup: { board: "stm32f4-disco-1", revision: "MB997D" } }),
      ...extra,
    };
    if (kind === "hil-test-result") {
      await mkdir(join(folder, "steps"));
      await writeFile(join(folder, "steps", "console-1-1.log"), lines.join("\n"));
    }
    await writeFile(join(folder, "result.json"), JSON.stringify(document));
    return `embedded-lab-results/${id}`;
  }
  const ztestOutput = (optional: string, expected: string, end: string | null) => [
    "*** Booting Zephyr OS build dccb09599635 ***",
    "Running TESTSUITE vera_basic",
    "START - test_arithmetic",
    " PASS - test_arithmetic in 0.001 seconds",
    "START - test_expected",
    ` ${expected} - test_expected in 0.001 seconds`,
    "START - test_optional",
    ` ${optional} - test_optional in 0.001 seconds`,
    ...(end ? [`PROJECT EXECUTION ${end}`] : []),
  ];

  it("takes test verdicts only from a run of the same ELF; skip and truncation are not a pass (L07-D/H, REQ-FUNC-36e3ecdd, REQ-FUNC-ba432613)", async () => {
    const tests = {
      app: "tests/ztest-basic",
      overlays: [],
      buildDir: "build/ztest",
      tests: { root: "tests/ztest-basic", scenarios: ["vera.ztest.pass"] },
    };
    const build = zephyr(["test-build", "--request", request("tr", tests)]);
    const tb = `embedded-lab-results/${build.json.runId}`;
    const elf = readFileSync(resultOf(build).tests[0].elf.path);
    const verdict = async (id: string, lines: string[], extra: Json = {}, kind?: string) =>
      zephyr([
        "test-run",
        "--test-build",
        tb,
        "--scenario",
        "vera.ztest.pass",
        "--evidence",
        await evidenceFolder(id, elf, lines, extra, kind),
      ]);
    const pass = await verdict("r-pass", ztestOutput("PASS", "PASS", "SUCCESSFUL"), {
      status: "incomplete",
      unmodeled: [{ address: "0xe0042004", access: "write" }],
    });
    expect([pass.code, pass.json.status]).toEqual([0, "pass"]);
    const passResult = resultOf(pass);
    expect(passResult.tests[0].cases.map((c: Json) => c.status)).toEqual(["pass", "pass", "pass"]);
    expect(passResult).toMatchObject({
      evidence: "virtual",
      coverage: { evidence: "virtual", board: "stm32f4_disco/stm32f407xx", profile: "stm32f4-discovery" },
      execution: { kind: "renode-result", status: "incomplete" },
    });
    expect(passResult.differences.map((d: Json) => d.kind)).toEqual(["target", "clock", "unmodeled"]);
    expect(passResult.differences[1]).toMatchObject({ firmware: 168000000, model: 72000000 });
    expect(passResult.coverage.notCovered.length).toBeGreaterThan(0);
    const skip = await verdict("r-skip", ztestOutput("SKIP", "PASS", "SUCCESSFUL"));
    expect([skip.code, skip.json.status, skip.json.code]).toEqual([3, "incomplete", "not-all-passed"]);
    expect(resultOf(skip).tests[0].cases.map((c: Json) => c.status)).toEqual(["pass", "skipped", "pass"]);
    expect(readFileSync(join(folderOf(skip), "junit.xml"), "utf8")).toContain("<skipped message=");
    const fail = await verdict("r-fail", ztestOutput("PASS", "FAIL", "FAILED"));
    expect([fail.code, fail.json.status]).toEqual([1, "fail"]);
    const rerun = await verdict("r-rerun", [
      ...ztestOutput("PASS", "FAIL", "FAILED"),
      ...ztestOutput("PASS", "PASS", "SUCCESSFUL"),
    ]);
    expect([rerun.code, rerun.json.status]).toEqual([1, "fail"]);
    expect(resultOf(rerun).tests[0].cases.find((c: Json) => c.name.endsWith(".expected")).status).toBe(
      "fail",
    );
    const reboot = await verdict("r-reboot", [
      ...ztestOutput("PASS", "PASS", null).slice(0, 4),
      ...ztestOutput("PASS", "PASS", "SUCCESSFUL"),
    ]);
    expect([reboot.code, reboot.json.code]).toEqual([3, "rebooted"]);
    const sibling = zephyr([
      "test-run",
      "--test-build",
      tb,
      "--scenario",
      "vera.ztest.pass",
      "--evidence",
      `../${"wb2"}/x`,
    ]);
    expect([sibling.code, sibling.json.code]).toEqual([2, "evidence"]);
    const cut = await verdict("r-cut", ztestOutput("PASS", "PASS", null).slice(0, 5));
    expect([cut.code, cut.json.code]).toEqual([3, "output-ended"]);
    const killed = await verdict("r-killed", ztestOutput("PASS", "PASS", "SUCCESSFUL"), {
      status: "stopped",
    });
    expect(killed.json.status).toBe("incomplete");
    const hardware = await verdict("r-hil", ztestOutput("PASS", "PASS", "SUCCESSFUL"), {}, "hil-test-result");
    expect(resultOf(hardware)).toMatchObject({
      status: "pass",
      evidence: "hardware",
      coverage: { evidence: "hardware" },
    });
    const other = await evidenceFolder(
      "r-other",
      Buffer.from("another firmware"),
      ztestOutput("PASS", "PASS", "SUCCESSFUL"),
    );
    const mismatch = zephyr([
      "test-run",
      "--test-build",
      tb,
      "--scenario",
      "vera.ztest.pass",
      "--evidence",
      other,
    ]);
    expect([mismatch.code, mismatch.json.code]).toEqual([2, "evidence-mismatch"]);
  });

  it("declares the differences of an application ELF run on the virtual profile (L07-H, REQ-FUNC-ba432613)", async () => {
    const build = zephyr(["build", "--request", request("vd")]);
    const evidence = await evidenceFolder("v-app", readFileSync(demoElf), ["VERA-FW zephyr-demo"], {
      status: "timeout",
      cases: [{ id: "timer", status: "timeout", code: "virtual-timeout" }],
    });
    const run = zephyr([
      "differences",
      "--build",
      `embedded-lab-results/${build.json.runId}`,
      "--evidence",
      evidence,
    ]);
    expect([run.code, run.json.code]).toEqual([3, "execution-timeout"]);
    expect(resultOf(run).differences.map((d: Json) => d.kind)).toEqual(["target", "clock"]);
  });

  it("flashes the owned HEX through the runner with the probe serial and refuses unverified images and arguments (L07-E/F, REQ-FUNC-62b1d407, REQ-SEC-a4ed8466)", async () => {
    await mkdir(join(wb, "lab"));
    await writeFile(
      join(wb, "lab", "resources.json"),
      JSON.stringify({
        format: 1,
        resources: [
          { alias: "stlink-a", kind: "probe", resource: PROBE, profile: "stm32f4-stlink" },
          { alias: "dmm", kind: "visa", resource: "USB0::0x2A8D::0x1301::MY1::INSTR", profile: "x" },
        ],
      }),
    );
    const flashEnv = {
      ZEPHYR_FLASH_REGISTRY: join(wb, "lab", "resources.json"),
      VERA_PROGRAM_STM32_PROGRAMMER_CLI: join(standIns, "fake_cli.py"),
    };
    const flash = (req: string, build: string, alias = "stlink-a") =>
      helper(
        flashScript,
        ["flash", "--request", req, "--build", build, "--probe", alias, "--firmware-effect", "none"],
        flashEnv,
      );
    const build = zephyr(["build", "--request", request("fl")]);
    const buildRun = `embedded-lab-results/${build.json.runId}`;
    const done = flash("zephyr/fl.json", buildRun);
    expect([done.code, done.json.status], JSON.stringify(done.json)).toEqual([0, "pass"]);
    const cli = calls().find((c) => c.tool === "STM32_Programmer_CLI") as Json;
    expect(cli.args).toEqual([
      "--connect",
      "port=swd reset=HWrst sn=066DFF495754888367143220",
      "--download",
      expect.stringMatching(/build[\\/]board-demo[\\/]zephyr[\\/]zephyr\.hex$/),
      "--start",
    ]);
    const west = calls().find((c) => c.tool === "west-flash") as Json;
    expect(west.args).toMatchObject({
      runner: "stm32cubeprogrammer",
      no_rebuild: true,
      dev_id: "066DFF495754888367143220",
    });
    expect(resultOf(done).flash).toMatchObject({
      runner: "stm32cubeprogrammer",
      physical: "unknown",
      probe: { alias: "stlink-a" },
    });
    const before = calls().length;
    // A runner argument outside the allowlist, a HEX outside flash, a HEX changed after the build, a non-probe alias.
    fake({ runnerArgs: ["--port=swd", "--tool-opt=-script x"] });
    const extra = zephyr(["build", "--request", request("fl2", { buildDir: "build/fl2" })]);
    const refused = (run: Run) => [run.code, run.json.code];
    expect(refused(flash("zephyr/fl2.json", `embedded-lab-results/${extra.json.runId}`))).toEqual([
      2,
      "runner",
    ]);
    fake({ hexAddress: 0x1fffc000 });
    const ob = zephyr(["build", "--request", request("fl3", { buildDir: "build/fl3" })]);
    expect(refused(flash("zephyr/fl3.json", `embedded-lab-results/${ob.json.runId}`))).toEqual([2, "image"]);
    fake({});
    const good = zephyr(["build", "--request", request("fl4", { buildDir: "build/fl4" })]);
    const goodRun = `embedded-lab-results/${good.json.runId}`;
    expect(refused(flash("zephyr/fl4.json", goodRun, "dmm"))).toEqual([2, "request"]);
    expect(refused(flash("zephyr/fl4.json", goodRun, "nobody"))).toEqual([2, "request"]);
    // A module that adds west runners after the build: west flash would import them.
    const moduleYml = join(ws, "modules", "hal", "fake", "zephyr", "module.yml");
    const moduleText = readFileSync(moduleYml, "utf8");
    await writeFile(moduleYml, `${moduleText}runners:\n  - file: scripts/evil_runner.py\n`);
    const hooked = flash("zephyr/fl4.json", goodRun);
    expect(refused(hooked)).toEqual([2, "preflight"]);
    expect(hooked.json.detail.findings.map((f: Json) => f.code)).toEqual(["module-hook"]);
    await writeFile(moduleYml, moduleText);
    await writeFile(join(wb, "build", "board-demo", "zephyr", "zephyr.hex"), ":00000001FF\n");
    expect(refused(flash("zephyr/fl.json", buildRun))).toEqual([2, "image-changed"]);
    expect(
      calls()
        .slice(before)
        .filter((c) => c.tool !== "cmake"),
    ).toEqual([]);
    const release = helper(flashScript, ["release", "--probe", "stlink-a"], flashEnv);
    expect(release.json).toMatchObject({ kind: "zephyr-flash-release", physical: "unknown" });
  });

  it("reserves the probe for the flash run so another session is BUSY (L07-E)", async () => {
    await mkdir(join(wb, "lab"));
    const registry = {
      format: 1,
      resources: [{ alias: "stlink-a", kind: "probe", resource: PROBE, profile: "stm32f4-stlink" }],
    };
    await writeFile(join(wb, "lab", "resources.json"), JSON.stringify(registry));
    const build = zephyr(["build", "--request", request("bz")]);
    fake({ cliSleep: 3 });
    const leases = new core.ResourceLeases({ root: join(root, "leases"), app: "test" });
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases,
    });
    const keys = labResourceKeys(labRegistrySchema.parse(registry).resources[0] as LabResource);
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: wb,
        executable: helperPython as string,
        args: [
          flashScript,
          "flash",
          "--request",
          "zephyr/bz.json",
          "--build",
          `embedded-lab-results/${build.json.runId}`,
          "--probe",
          "stlink-a",
          "--firmware-effect",
          "none",
        ],
        env: {
          PYTHONDONTWRITEBYTECODE: "1",
          ZEPHYR_FLASH_REGISTRY: join(wb, "lab", "resources.json"),
          VERA_PROGRAM_STM32_PROGRAMMER_CLI: join(standIns, "fake_cli.py"),
        },
        background: true,
        lease: {
          claims: [{ kind: "probe", alias: "stlink-a", resource: PROBE, keys, actuates: true }],
          graceMs: 30_000,
          cleanup: {
            args: [flashScript, "release", "--probe", "stlink-a"],
            shown: ["release", "--probe", "stlink-a"],
            timeoutMs: 30_000,
          },
        },
      });
      await expect(
        runner.start({
          sessionId: "s2",
          workbench: wb,
          executable: helperPython as string,
          args: ["-c", "0", "--probe", "0483:374b"],
        }),
      ).rejects.toMatchObject({ code: "BUSY" });
      const ended = await run.done;
      expect(ended).toMatchObject({ exitCode: 0 });
    } finally {
      await runner.stopAll();
    }
  });

  it("stops a build through VERA's runner with no process left and folders intact (L07-G, REQ-REL-274a88e6)", async () => {
    expect(zephyr(["build", "--request", request("other", { buildDir: "build/other" })]).code).toBe(0);
    const otherHex = sha256(readFileSync(join(wb, "build", "other", "zephyr", "zephyr.hex")));
    const sources = sha256(readFileSync(join(wb, "apps", "board-demo", "src", "main.c")));
    fake({ sleep: 60 });
    request("slow", { buildDir: "build/slow" });
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: wb,
        executable: helperPython as string,
        args: [toolScript, "build", "--request", "zephyr/slow.json"],
        env: {
          PYTHONDONTWRITEBYTECODE: "1",
          VERA_ZEPHYR_TEST: "1",
          VERA_ZEPHYR_TEST_CMAKE: join(standIns, "fake_cmake.py"),
        },
        background: true,
      });
      for (let i = 0; i < 400 && !calls().some((c) => c.tool === "compiler"); i++) await sleep(50);
      const compiler = calls().find((c) => c.tool === "compiler") as Json;
      expect(compiler).toBeDefined();
      const stopped = await run.stop();
      expect(stopped).toMatchObject({ stopped: true });
      for (let i = 0; i < 100 && calls().some((c) => c.pid && alive(c.pid)); i++) await sleep(100);
      for (const entry of calls())
        if (entry.pid) expect(alive(entry.pid), `${entry.tool} ${entry.pid}`).toBe(false);
    } finally {
      await runner.stopAll();
    }
    const runs = readdirSync(join(wb, "embedded-lab-results"));
    const partial = runs
      .map((id) => JSON.parse(readFileSync(join(wb, "embedded-lab-results", id, "result.json"), "utf8")))
      .find((doc) => doc.buildDir?.endsWith("slow"));
    expect(partial).toMatchObject({ state: "running", operation: "build" });
    fake({});
    const report = zephyr(["artifacts", "--request", "zephyr/slow.json"]);
    expect([report.code, report.json.code]).toEqual([3, "build-unfinished"]);
    expect(sha256(readFileSync(join(wb, "build", "other", "zephyr", "zephyr.hex")))).toBe(otherHex);
    expect(sha256(readFileSync(join(wb, "apps", "board-demo", "src", "main.c")))).toBe(sources);
  });
});

describe.skipIf(!helperPython)(
  "prepare-workspace against local git repositories (real west and git)",
  { timeout: 180_000 },
  () => {
    let repos = "";
    beforeEach(async () => {
      await bench();
      repos = join(root, "repos");
      await rm(join(ws, ".west"), { recursive: true });
      await rm(join(ws, "zephyr"), { recursive: true });
      await rm(join(ws, "modules"), { recursive: true });
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    });
    const git = (cwd: string, ...args: string[]) => {
      const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd,
        encoding: "utf8",
      });
      expect(done.status, done.stderr).toBe(0);
      return done.stdout.trim();
    };
    async function repo(name: string, from: string) {
      const folder = join(repos, name);
      await cp(from, folder, { recursive: true });
      git(folder, "init", "-q", "-b", "main");
      git(folder, "config", "uploadpack.allowAnySHA1InWant", "true");
      git(folder, "add", "-A");
      git(folder, "commit", "-q", "-m", "one");
      return git(folder, "rev-parse", "HEAD");
    }

    it("initializes from the local manifest and updates only the listed projects at their revisions (L07-C, REQ-FUNC-cf1cadee)", async () => {
      const zephyrSha = await repo("zephyr", join(standIns, "zephyr"));
      const halSha = await repo("hal_fake", join(standIns, "hal_fake"));
      const url = (name: string) => `file:///${posix(join(repos, name)).replace(/^\//, "")}`;
      const yml = (zrev: string) => `manifest:
  projects:
    - name: zephyr
      url: ${url("zephyr")}
      revision: ${zrev}
      west-commands: scripts/west-commands.yml
    - name: hal_fake
      url: ${url("hal_fake")}
      revision: ${halSha}
      path: modules/hal/fake
  self:
    path: manifest
`;
      await writeFile(join(ws, "manifest", "west.yml"), yml(zephyrSha));
      const projects = [
        { name: "zephyr", revision: zephyrSha },
        { name: "hal_fake", revision: halSha },
      ];
      const run = zephyr(["prepare-workspace", "--request", request("prep", { projects })]);
      expect([run.code, run.json.status], JSON.stringify(run.json).slice(0, 2000)).toEqual([0, "pass"]);
      const result = resultOf(run);
      expect(result.steps.map((s: Json) => [s.name, s.command.slice(1, 5)])).toEqual([
        ["init", ["-m", "west", "init", "-l"]],
        ["update", ["-m", "west", "update", "--narrow"]],
      ]);
      expect(result.workspace.projects.map((p: Json) => [p.name, p.head])).toEqual([
        ["zephyr", zephyrSha],
        ["hal_fake", halSha],
      ]);
      expect(readFileSync(join(ws, ".west", "config"), "utf8")).toContain("path = manifest");
      // The offline build that follows needs no network: the workspace is complete.
      expect(zephyr(["inspect", "--request", "zephyr/prep.json"]).code).toBe(0);
      // A branch revision that moved on is reported, not accepted.
      git(join(repos, "zephyr"), "commit", "-q", "--allow-empty", "-m", "two");
      await writeFile(join(ws, "manifest", "west.yml"), yml("main"));
      const moved = zephyr(["prepare-workspace", "--request", "zephyr/prep.json"]);
      expect([moved.code, moved.json.code]).toEqual([3, "project-checkout"]);
      // A manifest that pins another SHA than the request is refused before any network access.
      await writeFile(join(ws, "manifest", "west.yml"), yml("9".repeat(40)));
      const pinned = zephyr(["prepare-workspace", "--request", "zephyr/prep.json"]);
      expect([pinned.code, pinned.json.code]).toEqual([2, "preflight"]);
    });
  },
);

describe.skipIf(!helperPython || !realRoot)(
  "real Zephyr 4.4.2, SDK 1.0.1 and Twister on this machine (opt-in)",
  {
    timeout: 1_800_000,
  },
  () => {
    const real = (args: string[]) => helper(toolScript, args, {}, true);
    let realRequest: Json = {};
    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), "vz-")));
      wb = join(root, "wb");
      await cp(join(fixtures, "apps", "board-demo"), join(wb, "apps", "board-demo"), { recursive: true });
      await cp(join(fixtures, "tests", "ztest-basic"), join(wb, "tests", "ztest-basic"), { recursive: true });
      await mkdir(join(wb, "zephyr"));
      const heads = (path: string) =>
        readFileSync(join(realRoot as string, "ws", path, ".git", "HEAD"), "utf8").trim();
      realRequest = {
        ...baseRequest(),
        workspace: posix(join(realRoot as string, "ws")),
        sdk: posix(join(realRoot as string, "sdk", "zephyr-sdk-1.0.1")),
        projects: [
          { name: "zephyr", revision: heads("zephyr") },
          { name: "cmsis_6", revision: heads("modules/hal/cmsis_6") },
          { name: "hal_stm32", revision: heads("modules/hal/stm32") },
        ],
      };
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    });
    const save = (name: string, fields: Json = {}) => {
      writeFileSync(join(wb, "zephyr", `${name}.json`), JSON.stringify({ ...realRequest, ...fields }));
      return `zephyr/${name}.json`;
    };

    it("builds the fixture twice into separate folders, diagnoses Kconfig and devicetree errors (L07-A/B/C)", () => {
      const a = real(["build", "--request", save("a", { buildDir: "build/a" })]);
      expect([a.code, a.json.status], JSON.stringify(a.json).slice(0, 3000)).toEqual([0, "pass"]);
      const ra = resultOf(a);
      expect(ra.board).toMatchObject({ target: "stm32f4_disco/stm32f407xx" });
      expect(ra.tools).toMatchObject({ zephyr: { version: "4.4.2" }, sdk: { version: "1.0.1" } });
      expect(ra.artifacts.map((x: Json) => x.role)).toEqual([
        "elf",
        "hex",
        "bin",
        "config",
        "devicetree",
        "map",
        "build-info",
        "runners",
      ]);
      expect(ra.size.regions.find((r: Json) => r.name === "FLASH").used).toBeGreaterThan(0);
      const b = real(["build", "--request", save("b", { buildDir: "build/b", extraConfigs: ["fast.conf"] })]);
      expect(b.code).toBe(0);
      const hex = (r: Run) => resultOf(r).artifacts.find((x: Json) => x.role === "hex").sha256;
      expect(hex(b)).not.toBe(hex(a));
      expect(readFileSync(join(folderOf(b), "artifacts", "config"), "utf8")).toContain(
        "CONFIG_SYS_CLOCK_TICKS_PER_SEC=1000",
      );
      const k = real(["build", "--request", save("k", { buildDir: "build/k", extraConfigs: ["bad.conf"] })]);
      expect([k.code, k.json.status]).toEqual([1, "fail"]);
      expect(resultOf(k).diagnostics.map((d: Json) => d.code)).toContain("kconfig");
      const d = real([
        "build",
        "--request",
        save("d", { buildDir: "build/d", overlays: ["broken.overlay"] }),
      ]);
      expect([d.code, d.json.status]).toEqual([1, "fail"]);
      expect(resultOf(d).diagnostics.map((x: Json) => x.code)).toContain("devicetree");
    });

    it("builds ztest scenarios build-only and, with the real Renode, takes pass/skip/fail from the UART (L07-D/H)", () => {
      const tests = {
        app: "tests/ztest-basic",
        overlays: [],
        buildDir: "build/ztest",
        tests: {
          root: "tests/ztest-basic",
          scenarios: ["vera.ztest.pass", "vera.ztest.skip", "vera.ztest.fail"],
        },
      };
      const tb = real(["test-build", "--request", save("tb", tests)]);
      expect([tb.code, tb.json.status, tb.json.code]).toEqual([0, "incomplete", "build-only"]);
      const suites = resultOf(tb).tests as Json[];
      expect(suites.map((s) => [s.status, s.twister])).toEqual(Array(3).fill(["built", "not run"]));
      if (!realRenode) return;
      const sim = join(plugins, "renode", "scripts", "renode_sim.py");
      const expected: Record<string, [string, number]> = {
        pass: ["pass", 0],
        skip: ["incomplete", 3],
        fail: ["fail", 1],
      };
      for (const suite of suites) {
        const elf = posix(suite.elf.path).replace(`${posix(wb)}/`, "");
        const capture = spawnSync(
          helperPython as string,
          [
            sim,
            "capture-uart",
            "--profile",
            "stm32f4-discovery",
            "--firmware",
            elf,
            "--arch",
            "cortex-m4",
            "--boot-address",
            "0x08000000",
            "--until",
            "PROJECT EXECUTION (SUCCESSFUL|FAILED)",
            "--virtual-budget",
            "30",
            "--real-timeout",
            "240",
          ],
          { cwd: wb, env: { ...process.env, VERA_PROGRAM_RENODE: realRenode }, encoding: "utf8" },
        );
        const runId = JSON.parse(capture.stdout.trim().split("\n").at(-1) ?? "{}").runId;
        const verdict = real([
          "test-run",
          "--test-build",
          `embedded-lab-results/${tb.json.runId}`,
          "--scenario",
          suite.scenario,
          "--evidence",
          `embedded-lab-results/${runId}`,
        ]);
        const [status, code] = expected[String(suite.scenario).split(".").at(-1) as string] as [
          string,
          number,
        ];
        expect([verdict.code, verdict.json.status], suite.scenario).toEqual([code, status]);
        expect(resultOf(verdict).differences.map((x: Json) => x.kind)).toContain("clock");
      }
    });

    it.skipIf(!realCli)(
      "drives the real STM32_Programmer_CLI through west flash with the probe serial, no board attached (L07-E part)",
      async () => {
        const build = real(["build", "--request", save("f", { buildDir: "build/f" })]);
        await mkdir(join(wb, "lab"));
        await writeFile(
          join(wb, "lab", "resources.json"),
          JSON.stringify({
            format: 1,
            resources: [{ alias: "stlink-a", kind: "probe", resource: PROBE, profile: "stm32f4-stlink" }],
          }),
        );
        const flash = helper(
          flashScript,
          [
            "flash",
            "--request",
            "zephyr/f.json",
            "--build",
            `embedded-lab-results/${build.json.runId}`,
            "--probe",
            "stlink-a",
            "--firmware-effect",
            "none",
          ],
          {
            ZEPHYR_FLASH_REGISTRY: join(wb, "lab", "resources.json"),
            VERA_PROGRAM_STM32_PROGRAMMER_CLI: realCli as string,
          },
          true,
        );
        expect([flash.code, flash.json.code]).toEqual([1, "flash-failed"]);
        const log = readFileSync(join(folderOf(flash), "flash.log"), "utf8");
        expect(log).toContain("sn=066DFF495754888367143220");
        expect(log).toMatch(/No debug probe detected|No ST-LINK detected/);
      },
    );
  },
);
