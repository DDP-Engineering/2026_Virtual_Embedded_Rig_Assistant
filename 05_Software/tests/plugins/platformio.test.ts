// The platformio plugin (LAB-08). Default tests check the package and its rules, and run the real helpers (pio_tool.py,
// pio_upload.py) with the pinned Python environment: platformio.ini is always read by the real PlatformIO Core 6.2.0
// parser, while PlatformIO's build/test/package commands are a stand-in (tests/fixtures/platformio/stand-ins/
// fake_pio.py, a fake core folder). That is offline evidence of the helper's checks, command lines, environment, results
// and lifecycle, never of PlatformIO's builds themselves.
// VERA_PIO_PYTHON names a Python with the helper's pinned dependencies (a uv venv); without it the helper tests are
// skipped. VERA_PIO_REAL names a scratch folder with a core prepared by `platformio prepare-packages` (core/) and the
// libraries it installed (libdeps/<env>/): the opt-in tests build and test the fixture with the real PlatformIO;
// VERA_PIO_REAL_GCC (a folder with a host gcc) adds the native host tests, VERA_RENODE_REAL (renode.exe) runs the
// built firmware on the real Renode profile.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import {
  classifyCommand,
  hilPlanProblems,
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
const pluginFolder = join(plugins, "platformio");
const toolScript = join(pluginFolder, "scripts", "pio_tool.py");
const uploadScript = join(pluginFolder, "scripts", "pio_upload.py");
const fixtures = fileURLToPath(new URL("../fixtures/platformio/", import.meta.url));
const standIns = join(fixtures, "stand-ins");
const fakePio = join(standIns, "fake_pio.py");
const renodeFirmware = fileURLToPath(new URL("../fixtures/renode/firmware/", import.meta.url));
const windows = process.platform === "win32";
const helperPython = process.env.VERA_PIO_PYTHON;
const NO_HELPER = "no Python with the helper's pinned dependencies (set VERA_PIO_PYTHON to such a venv)";
const realRoot = process.env.VERA_PIO_REAL;
const realGcc = process.env.VERA_PIO_REAL_GCC;
const realRenode = process.env.VERA_RENODE_REAL;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const OUTPUT_LIMIT = 11_000;
const PROBE = "0483:374B:066DFF495754888367143220";
// A project folder name with a space and non-ASCII letters (L08 paths with spaces/Unicode).
const PROJECT = "proiect demo ș";

// biome-ignore lint/suspicious/noExplicitAny: the helper's JSON documents, checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
}

let root = "";
let wb = "";
let coreDir = "";
let project = "";

async function bench(fill = true) {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-pio-")));
  wb = join(root, "wb");
  coreDir = join(root, "core");
  project = join(wb, PROJECT);
  await cp(join(fixtures, "board-demo"), project, { recursive: true });
  await mkdir(join(wb, "platformio"), { recursive: true });
  await mkdir(join(wb, ".vera"));
  if (fill) await cp(join(standIns, "core"), coreDir, { recursive: true });
  else await mkdir(coreDir);
  fake({});
}
const fake = (fields: Json) =>
  writeFileSync(
    join(coreDir, "fake.json"),
    JSON.stringify({
      elf: {
        disco: join(renodeFirmware, "demo.elf"),
        disco_hooked: join(renodeFirmware, "demo.elf"),
        disco_fast: join(renodeFirmware, "demo-wrong-version.elf"),
      },
      testElf: { test_lines: join(renodeFirmware, "demo-silent.elf") },
      template: join(standIns, "core"),
      libraries: join(standIns, "libdeps"),
      ...fields,
    }),
  );
const calls = (): Json[] =>
  existsSync(join(coreDir, "calls.jsonl"))
    ? readFileSync(join(coreDir, "calls.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
function request(name: string, fields: Json = {}) {
  const document = {
    format: 1,
    kind: "platformio-request",
    project: PROJECT,
    environment: "disco",
    core: coreDir.replaceAll("\\", "/"),
    buildDir: `build/${name}`,
    ...fields,
  };
  for (const key of Object.keys(document))
    if ((document as Json)[key] === undefined) delete (document as Json)[key];
  writeFileSync(join(wb, "platformio", `${name}.json`), JSON.stringify(document));
  return `platformio/${name}.json`;
}
/** A request whose buildDir went through prepare-packages first (the stand-in installs Unity), as a user does. */
function ready(name: string, fields: Json = {}) {
  const path = request(name, fields);
  const prepared = pio(["prepare-packages", "--request", path]);
  expect(prepared.json.status, JSON.stringify(prepared.json)).toBe("pass");
  return path;
}
/** Installs the stand-in Unity into a request's libdeps (what prepare-packages leaves). */
function libdeps(name: string, environment = "disco") {
  const target = join(wb, "build", name, "libdeps", environment);
  mkdirSync(target, { recursive: true });
  return cp(join(standIns, "libdeps"), target, { recursive: true });
}
function helper(script: string, args: string[], extra: Record<string, string> = {}, real = false): Run {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1", ...extra };
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
    env.VERA_PIO_TEST = "1";
    env.VERA_PIO_TEST_PIO = fakePio;
  }
  // Variables a user may have set: PlatformIO would append or obey them, the helper must not let them through.
  env.PLATFORMIO_EXTRA_SCRIPTS = "pre:evil.py";
  env.PLATFORMIO_BUILD_FLAGS = "!echo injected";
  env.PLATFORMIO_CORE_DIR = join(root, "user-core");
  // prepare-packages keeps the caller's proxy on purpose, so a real run with an empty core needs the real one.
  if (!real) env.HTTPS_PROXY = "http://proxy.invalid:8080";
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
const pio = (args: string[], extra: Record<string, string> = {}) => helper(toolScript, args, extra);
const resultOf = (run: Run): Json => JSON.parse(readFileSync(join(wb, run.json.result), "utf8"));
const folderOf = (run: Run) => dirname(join(wb, run.json.result));
const runs = () =>
  existsSync(join(wb, "embedded-lab-results")) ? readdirSync(join(wb, "embedded-lab-results")) : [];
const ini = (extra: string) =>
  writeFileSync(
    join(project, "platformio.ini"),
    readFileSync(join(fixtures, "board-demo", "platformio.ini"), "utf8") + extra,
  );
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("package", { timeout: 60_000 }, () => {
  it("publishes the official platformio package with its programs, pins, pack group, metadata and skill", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({
      id: "platformio",
      version: "0.2.1",
      ecosystem: "lab",
      platforms: ["windows-x64", "linux-x64"],
    });
    expect(m.programs.platformio).toMatchObject({ install: { script: "scripts/pio_tool.py" } });
    expect(m.programs.platformio?.uses).toBeUndefined();
    expect(m.programs["platformio-upload"]).toMatchObject({
      install: { script: "scripts/pio_upload.py" },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's literal workbench placeholder.
      env: { PLATFORMIO_UPLOAD_REGISTRY: "${workbench}/lab/resources.json" },
      resources: { option: "--probe", kinds: ["probe"], grace: 30, cleanup: ["release"], cleanupTimeout: 30 },
    });
    for (const script of [toolScript, uploadScript]) {
      const text = readFileSync(script, "utf8");
      for (const pin of ["platformio==6.2.0", "click==8.5.1", "requests==2.34.2", "pip==26.3"])
        expect(text).toContain(`"${pin}"`);
      expect(text).not.toMatch(/"[A-Za-z0-9_.-]+(>=|~=|<)/);
    }
    const catalog = parse(readFileSync(join(plugins, "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("platformio");
    expect(catalog.metadata.platformio.activities).toEqual(["build", "testing", "flash"]);
    const packs = parse(readFileSync(join(plugins, "packs.yaml"), "utf8"));
    const lab = packs.find((pack: { id: string }) => pack.id === "lab");
    expect(lab.groups).toContainEqual({
      name: "PlatformIO projects",
      plugins: ["platformio"],
      default: true,
    });
    expect(await core.checkCatalogSource(plugins)).toEqual([]);
    const temp = await realpath(await mkdtemp(join(tmpdir(), "vera-pio-pkg-")));
    try {
      const store = new core.PluginStore({ root: join(temp, "plugins") });
      await store.install(pluginFolder);
      const installed = await store.load("platformio");
      const skills = new core.SkillCatalog({
        root: temp,
        disabled: () => [],
        plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
      });
      const names = (await skills.list())
        .filter((skill) => skill.plugin === "platformio")
        .map((skill) => skill.name);
      expect(names).toEqual(["platformio-projects"]);
      const usage = (await skills.read("plugin", "platformio-projects")).content;
      for (const text of [
        "inspect-project",
        "hooks",
        "prepare-packages",
        "build-only",
        "test-run",
        "platformio-upload upload",
        "never",
      ])
        expect(usage).toContain(text);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("keeps workspace.py and elf.py byte-identical with the other lab plugins", async () => {
    const own = (name: string) => readFile(join(pluginFolder, "scripts", "pio_support", name));
    const gdb = (name: string) => readFile(join(plugins, "gdb-debug", "scripts", "gdb_support", name));
    expect(sha256(await own("workspace.py"))).toBe(sha256(await gdb("workspace.py")));
    expect(sha256(await own("elf.py"))).toBe(sha256(await gdb("elf.py")));
  });
});

describe("supervised steps", { timeout: 60_000 }, () => {
  it("ends the step's process tree as soon as VERA requests a stop", async () => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), "vera-pio-stop-")));
    // The step starts a child that starts its own child, the way an upload starts the programmer.
    const child = [
      "import json, os, subprocess, sys, time",
      "inner = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])",
      "open(sys.argv[1], 'w').write(json.dumps([os.getpid(), inner.pid]))",
      "open(sys.argv[1] + '.ready', 'w').close()",
      "time.sleep(120)",
    ].join("\n");
    const script = [
      "import json, os, sys",
      "from pathlib import Path",
      "from pio_support.result import Run",
      // VERA starts a helper as the leader of its own process group on Linux.
      "os.name == 'nt' or os.setsid()",
      "folder = Path(sys.argv[1])",
      "run = Run('upload', 'hardware')",
      "run.folder = folder",
      "pids = folder / 'pids.json'",
      "ready = folder / 'pids.json.ready'",
      "code, _ = run.step('upload', [sys.executable, '-c', sys.argv[2], str(pids)], folder, dict(os.environ), ready.exists)",
      "print(json.dumps({'pids': json.loads(pids.read_text()), 'step': run['steps'][0]}))",
    ].join("\n");
    try {
      const done = spawnSync(
        process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3"),
        ["-c", script, temp, child],
        {
          env: { ...process.env, PYTHONPATH: join(pluginFolder, "scripts"), PYTHONDONTWRITEBYTECODE: "1" },
          encoding: "utf8",
          timeout: 50_000,
        },
      );
      expect(done.status, done.stderr).toBe(0);
      const { pids, step } = JSON.parse(done.stdout.trim().split("\n").at(-1) ?? "{}");
      expect(step.exit).not.toBe(0);
      expect(step.seconds).toBeLessThan(30);
      for (let i = 0; i < 50 && pids.some(alive); i++) await sleep(100);
      expect(pids.map(alive)).toEqual([false, false]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

describe("risk of each operation (REQ-SEC-6ec31a0f)", () => {
  it("rates reads safe, host execution, deletion and the network step device-write, upload by its effect", () => {
    const rules = manifest().rules;
    const cases: [string, string, string[]][] = [
      ["safe", "platformio", ["--version"]],
      ["safe", "platformio", ["tools"]],
      ["safe", "platformio", ["tools", "--request", "r.json"]],
      ["safe", "platformio", ["inspect-project", "--request", "r.json"]],
      ["safe", "platformio", ["inspect-environments", "--request", "r.json"]],
      ["safe", "platformio", ["artifacts", "--request", "r.json"]],
      ["safe", "platformio", ["test-run", "--test-device", "a", "--suite", "s", "--evidence", "b"]],
      ["device-write", "platformio", ["build", "--request", "r.json"]],
      ["device-write", "platformio", ["build", "--request", "r.json", "--pristine"]],
      ["device-write", "platformio", ["test-host", "--request", "r.json"]],
      ["device-write", "platformio", ["test-device", "--request", "r.json"]],
      ["device-write", "platformio", ["clean", "--request", "r.json"]],
      ["device-write", "platformio", ["prepare-packages", "--request", "r.json"]],
      ["device-write", "platformio", ["run", "-t", "upload"]],
      ["safe", "platformio-upload", ["tools"]],
      ["safe", "platformio-upload", ["release", "--probe", "stlink-a"]],
      [
        "device-write",
        "platformio-upload",
        ["upload", "--request", "r", "--build", "b", "--probe", "p", "--firmware-effect", "none"],
      ],
      [
        "irreversible",
        "platformio-upload",
        ["upload", "--request", "r", "--build", "b", "--probe", "p", "--firmware-effect", "actuates"],
      ],
    ];
    for (const [expected, program, args] of cases)
      expect(classifyCommand(rules, program, args).risk, `${program} ${args.join(" ")}`).toBe(expected);
    const build = classifyCommand(rules, "platformio", ["build", "--request", "r.json"]);
    expect(build.timeout).toBe(3600);
    expect(build.notes.join(" ")).toMatch(
      /Host execution.*approval is not a sandbox.*Never contacts the network/,
    );
    expect(
      classifyCommand(rules, "platformio", ["prepare-packages", "--request", "r"]).notes.join(" "),
    ).toMatch(/Contacts the network/);
  });
});

describe.skipIf(!helperPython)("platformio helper against stand-ins (offline)", { timeout: 180_000 }, () => {
  beforeEach(async () => {
    await bench();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  it("reports the helper, PlatformIO Core and the core folder's packages without starting PlatformIO (REQ-FUNC-684b0afc)", () => {
    const bare = pio(["tools"]);
    expect(bare.json).toMatchObject({
      kind: "platformio-tools",
      status: "pass",
      helper: "0.2.1",
      platformio: "6.2.0",
    });
    const full = pio(["tools", "--request", request("tools")]);
    expect(full.code).toBe(0);
    expect(full.json.core.platforms.map((p: Json) => [p.name, p.version, p.owner])).toEqual([
      ["native", "1.2.1", "platformio"],
      ["ststm32", "20.0.0", "platformio"],
    ]);
    expect(full.json.core.packages.map((p: Json) => p.name)).toContain("tool-scons");
    expect(full.json.core.packages[0].manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(calls()).toEqual([]);
    rmSyncCore();
    const empty = pio(["tools", "--request", request("tools")]);
    expect([empty.code, empty.json.code]).toEqual([3, "core-empty"]);
  });

  it("inspects the project with PlatformIO's parser: files, environments, sections and findings, offline (REQ-FUNC-fa8f52db, REQ-FUNC-90fd8436)", () => {
    const projectRun = pio(["inspect-project", "--request", request("insp", { environment: undefined })]);
    expect(projectRun.code).toBe(0);
    expect(projectRun.json.environments).toEqual(["disco", "disco_fast", "native"]);
    expect(projectRun.json.defaultEnvs).toEqual(["disco"]);
    expect(projectRun.json.files.map((f: Json) => [f.path.split(/[\\/]/).at(-1), f.inside])).toEqual([
      ["platformio.ini", true],
      ["common.ini", true],
    ]);
    expect(projectRun.json.files[0].sha256).toBe(sha256(readFileSync(join(project, "platformio.ini"))));
    expect(projectRun.json.findings.map((f: Json) => [f.code, f.refusing])).toEqual([
      ["default-envs", false],
    ]);
    const envs = pio(["inspect-environments", "--request", request("insp2", { environment: undefined })]);
    const fast = envs.json.environments.find((e: Json) => e.name === "disco_fast");
    expect(fast).toMatchObject({
      platform: "platformio/ststm32@20.0.0",
      board: "disco_f407vg",
      framework: ["cmsis"],
      uploadProtocol: "stlink",
      verified: true,
    });
    expect(fast.options.platform.section).toBe("env:disco");
    expect(fast.options.test_framework.section).toBe("env");
    expect(fast.options.build_flags).toMatchObject({
      section: "env:disco_fast",
      value: ['-Wall -Os -DFW_VERSION=\\"1.2.4\\" -DFAST_TICKS'],
    });
    expect(envs.json.environments.find((e: Json) => e.name === "native")).toMatchObject({
      native: true,
      verified: true,
    });
    expect(envs.json.environments.find((e: Json) => e.name === "disco").missing).toEqual([
      "library throwtheswitch/Unity",
    ]);
    expect(calls()).toEqual([]);
    writeFileSync(join(project, "platformio.ini"), "[env:disco\nplatform = x\n");
    const broken = pio(["inspect-project", "--request", request("insp3")]);
    expect([broken.code, broken.json.code]).toEqual([2, "input"]);
  });

  it("refuses requests without an explicit environment or with invalid paths, writing nothing (REQ-REL-6548e65a)", async () => {
    const cases: [Json, string][] = [
      [{ environment: undefined }, "environment"],
      [{ environment: "nope" }, "environment"],
      [{ environment: "disco env" }, "request"],
      [{ buildDir: `${PROJECT}/build` }, "build-dir"],
      [{ buildDir: "embedded-lab-results/x" }, "build-dir"],
      [{ buildDir: "../outside" }, "build-dir"],
      [{ buildDir: join(wb, "abs").replaceAll("\\", "/") }, "build-dir"],
      [{ core: join(root, "missing-core") }, "input"],
      [{ extra: 1 }, "request"],
      [{ hooks: [{ file: "x", sha256: "ABC" }] }, "request"],
      [{ tests: ["../up"] }, "request"],
    ];
    for (const [fields, code] of cases) {
      const run = pio(["build", "--request", request("bad", fields)]);
      expect([run.code, run.json.code], JSON.stringify(fields)).toEqual([2, code]);
    }
    await mkdir(join(wb, "empty-project"));
    const noIni = pio(["build", "--request", request("bad", { project: "empty-project" })]);
    expect([noIni.code, noIni.json.code]).toEqual([2, "input"]);
    expect(runs()).toEqual([]);
    expect(existsSync(join(wb, "build"))).toBe(false);
    expect(calls()).toEqual([]);
  });

  it("refuses code hooks unless approved by hash, and never approves the others (L08-B, REQ-SEC-17266b8a, REQ-SEC-82cb079b)", async () => {
    const approvable: [string, () => Promise<void> | void, string, string][] = [
      [
        "extra-script",
        // Reached only through extends: [env:disco_hooked] extends env:disco and the plain section [hooks].
        () => {
          ini("[hooks]\nextra_scripts = pre:gen.py\n\n[env:disco_hooked]\nextends = env:disco, hooks\n");
          writeFileSync(join(project, "gen.py"), "Import('env')\n");
        },
        "gen.py",
        "disco_hooked",
      ],
      [
        "library-script",
        async () => {
          await mkdir(join(project, "lib", "hooked"), { recursive: true });
          writeFileSync(
            join(project, "lib", "hooked", "library.json"),
            JSON.stringify({ name: "hooked", build: { extraScript: "x.py" } }),
          );
          writeFileSync(join(project, "lib", "hooked", "x.py"), "Import('env')\n");
        },
        "lib/hooked/x.py",
        "disco",
      ],
      [
        "custom-test-runner",
        () => writeFileSync(join(project, "test", "test_custom_runner.py"), "class CustomTestRunner: pass\n"),
        "test/test_custom_runner.py",
        "disco",
      ],
      [
        "local-board",
        async () => {
          await mkdir(join(project, "boards"));
          writeFileSync(join(project, "boards", "disco_f407vg.json"), "{}\n");
        },
        "boards/disco_f407vg.json",
        "disco",
      ],
    ];
    for (const [code, setup, file, environment] of approvable) {
      await rm(project, { recursive: true, force: true });
      await cp(join(fixtures, "board-demo"), project, { recursive: true });
      await setup();
      const refused = pio([
        "build",
        "--request",
        request("hook", { environment, buildDir: `build/hook-${code}` }),
      ]);
      expect([refused.code, refused.json.code], code).toEqual([2, "preflight"]);
      const finding = refused.json.detail.findings.find((f: Json) => f.code === code);
      expect(finding, code).toMatchObject({ approvable: true, approved: false });
      if (code === "extra-script")
        expect(finding).toMatchObject({ section: "hooks", option: "extra_scripts", environment });
      const digest = sha256(readFileSync(join(project, file)));
      expect(finding.sha256).toBe(digest);
      const hooks = [{ file: `${PROJECT}/${file}`, sha256: digest, reason: "reviewed" }];
      ready("hook", { environment, buildDir: `build/hook-${code}`, hooks });
      const approved = pio([
        "build",
        "--request",
        request("hook", { environment, buildDir: `build/hook-${code}`, hooks }),
      ]);
      expect([approved.code, approved.json.status], code).toEqual([0, "pass"]);
      writeFileSync(join(project, file), `${readFileSync(join(project, file), "utf8")}\n# changed\n`);
      const changedRun = pio([
        "build",
        "--request",
        request("hook", { environment, buildDir: `build/hook-${code}`, hooks }),
      ]);
      expect([changedRun.code, changedRun.json.code], `${code} changed`).toEqual([2, "preflight"]);
    }
    await rm(project, { recursive: true, force: true });
    await cp(join(fixtures, "board-demo"), project, { recursive: true });
    const never: [string, string][] = [
      ["shell-flag", "[env:disco_extra]\nextends = env:disco\nbuild_src_flags = !python make_flags.py\n"],
      // PlatformIO splits a one-line value on ", ": the second item still reaches SCons as a shell command.
      ["shell-flag", "[env:disco_extra]\nextends = env:disco\nbuild_flags = -Wall, !echo hi\n"],
      // An interpolation that produces a leading '!' (the raw line does not start with it).
      [
        "shell-flag",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: PlatformIO's own ${...} interpolation syntax.
        "[x]\nempty =\n\n[env:disco_extra]\nextends = env:disco\nbuild_src_flags = ${x.empty}!marker\n",
      ],
      // SCons expands $ names after the preflight: the file judged could differ from the file run.
      ["scons-variable", "[env:disco_extra]\nextends = env:disco\nextra_scripts = pre:ok.py$NOPE\n"],
      [
        "scons-variable",
        "[env:disco_extra]\nextends = env:disco\nlib_extra_dirs = $PROJECT_DIR/x/../../elsewhere\n",
      ],
      // PlatformIO leaves a ${expression} it cannot resolve to SCons, which evaluates it as Python.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: PlatformIO's own ${...} interpolation syntax.
      ["scons-expression", "[env:disco_extra]\nextends = env:disco\nbuild_flags = -DSTAMP=${len('abc')}\n"],
      [
        "scons-expression",
        "[env:disco_extra]\nextends = env:disco\nbuild_src_flags = -DX=$PROJECT_DIR.upper\n",
      ],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: PlatformIO's own ${...} interpolation syntax.
      ["sysenv", "[env:disco_extra]\nextends = env:disco\nbuild_flags = -DUSER=${sysenv.USERNAME}\n"],
      [
        "platform-packages",
        "[env:disco_extra]\nextends = env:disco\nplatform_packages = toolchain-gccarmnoneeabi@https://example.invalid/t.zip\n",
      ],
      [
        "platform-spec",
        "[env:disco_extra]\nextends = env:disco\nplatform = https://github.com/platformio/platform-ststm32.git\n",
      ],
      [
        "library-spec",
        "[env:disco_extra]\nextends = env:disco\nlib_deps = https://example.invalid/lib.zip\n",
      ],
      [
        "upload-command",
        "[env:disco_extra]\nextends = env:disco\nupload_protocol = custom\nupload_command = flash.exe $SOURCE\n",
      ],
      ["targets", "[env:disco_extra]\nextends = env:disco\ntargets = upload\n"],
      [
        "testing-command",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: PlatformIO's own ${...} interpolation syntax.
        "[env:disco_extra]\nextends = env:disco\ntest_testing_command = renode ${platformio.build_dir}\n",
      ],
    ];
    for (const [code, extra] of never) {
      ini(extra);
      const refused = pio(["build", "--request", request("never", { environment: "disco_extra" })]);
      expect([refused.code, refused.json.code], code).toEqual([2, "preflight"]);
      expect(
        refused.json.detail.findings.find((f: Json) => f.code === code),
        code,
      ).toMatchObject({ approvable: false });
    }
    // PlatformIO still reads renamed options under their old spelling: they are judged under the current name.
    ini(
      "[env:disco_old]\nextends = env:disco\nextra_script = old.py\nlib_install = https://example.invalid/l.zip\n",
    );
    writeFileSync(join(project, "old.py"), "Import('env')\n");
    const old = pio(["build", "--request", request("never", { environment: "disco_old" })]);
    expect(old.json.detail.findings.map((f: Json) => f.code).sort()).toEqual([
      "extra-script",
      "library-spec",
    ]);
    const folder = readFileSync(join(fixtures, "board-demo", "platformio.ini"), "utf8").replace(
      "[platformio]\n",
      "[platformio]\nbuild_dir = elsewhere\n",
    );
    writeFileSync(join(project, "platformio.ini"), folder);
    expect(
      pio(["build", "--request", request("never")]).json.detail.findings.map((f: Json) => f.code),
    ).toContain("folder-option");
    writeFileSync(join(root, "outside.ini"), "[common_mcu]\nbuild_flags = -O0\n");
    writeFileSync(
      join(project, "platformio.ini"),
      readFileSync(join(fixtures, "board-demo", "platformio.ini"), "utf8").replace(
        "extra_configs = common.ini",
        "extra_configs = common.ini\n  ../../outside.ini",
      ),
    );
    // An extra_configs pattern outside the project is refused before PlatformIO reads it (also a UNC share).
    const outside = pio(["inspect-project", "--request", request("never")]);
    expect([outside.code, outside.json.code]).toEqual([2, "config-outside"]);
    writeFileSync(
      join(project, "platformio.ini"),
      readFileSync(join(fixtures, "board-demo", "platformio.ini"), "utf8").replace(
        "extra_configs = common.ini",
        "extra_configs = common.ini\n  //vera-test.invalid/share/*.ini",
      ),
    );
    expect(pio(["inspect-project", "--request", request("never")]).json.code).toBe("config-outside");
    // A .pio-link library and more library folders than VERA judges are refused, never approvable.
    await rm(project, { recursive: true, force: true });
    await cp(join(fixtures, "board-demo"), project, { recursive: true });
    writeFileSync(
      join(project, "lib", "x.pio-link"),
      JSON.stringify({ spec: { uri: "symlink://../../outside" } }),
    );
    const link = pio(["build", "--request", request("never")]);
    expect(link.json.detail.findings.map((f: Json) => f.code)).toEqual(["library-link"]);
    rmSync(join(project, "lib", "x.pio-link"));
    for (let i = 0; i < 257; i++) mkdirSync(join(project, "lib", `a${String(i).padStart(3, "0")}`));
    const many = pio(["build", "--request", request("never")]);
    expect(many.json.detail.findings.map((f: Json) => f.code)).toEqual(["library-limit"]);
    // A library manifest's build fields go through SCons too.
    await rm(project, { recursive: true, force: true });
    await cp(join(fixtures, "board-demo"), project, { recursive: true });
    writeFileSync(
      join(project, "lib", "lines", "library.json"),
      JSON.stringify({
        name: "lines",
        version: "1.0.0",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SCons' own ${...} substitution syntax.
        build: { flags: "-DX=${__import__('os').getpid()}" },
      }),
    );
    const manifestRun = pio(["build", "--request", request("never")]);
    expect(manifestRun.json.detail.findings.map((f: Json) => f.code)).toEqual(["scons-expression"]);
    // An Arduino library.properties (no library.json) hands its ldflags to SCons as well.
    await rm(project, { recursive: true, force: true });
    await cp(join(fixtures, "board-demo"), project, { recursive: true });
    await mkdir(join(project, "lib", "arduino-style"));
    writeFileSync(
      join(project, "lib", "arduino-style", "library.properties"),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SCons' own ${...} substitution syntax.
      "name=x\nldflags=${len('x')}\n",
    );
    const properties = pio(["build", "--request", request("never")]);
    expect(properties.json.detail.findings.map((f: Json) => f.code)).toEqual(["scons-expression"]);
    // A relative extra_configs pattern that reaches outside through a link is refused before the file is read.
    await cp(join(fixtures, "board-demo"), project, { recursive: true, force: true });
    await mkdir(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "x.ini"), "[common_mcu]\nbuild_flags = -O0\n");
    symlinkSync(join(root, "elsewhere"), join(project, "cfg"), windows ? "junction" : "dir");
    writeFileSync(
      join(project, "platformio.ini"),
      readFileSync(join(fixtures, "board-demo", "platformio.ini"), "utf8").replace(
        "extra_configs = common.ini",
        "extra_configs = common.ini\n  cfg/*.ini",
      ),
    );
    expect(pio(["inspect-project", "--request", request("never")]).json.code).toBe("config-outside");
    expect(calls().filter((c) => c.tool === "build").length).toBe(4);
  });

  it("builds each environment offline into its own folder with hashed artifacts, versions and a scrubbed environment (L08-A/E, REQ-FUNC-f4583edd, REQ-SEC-bb7ede2f, REQ-SEC-82cb079b)", async () => {
    await mkdir(join(project, ".pio"));
    writeFileSync(join(project, ".pio", "user.txt"), "the user's own build folder");
    const disco = pio(["build", "--request", ready("disco")]);
    const fast = pio(["build", "--request", ready("fast", { environment: "disco_fast" })]);
    expect([disco.code, disco.json.status, fast.code, fast.json.status]).toEqual([0, "pass", 0, "pass"]);
    const a = resultOf(disco);
    const b = resultOf(fast);
    const elfA = a.artifacts.find((x: Json) => x.role === "elf");
    const elfB = b.artifacts.find((x: Json) => x.role === "elf");
    expect(elfA.sha256).toBe(sha256(readFileSync(join(renodeFirmware, "demo.elf"))));
    expect(elfB.sha256).not.toBe(elfA.sha256);
    expect(sha256(readFileSync(join(folderOf(disco), elfA.path)))).toBe(elfA.sha256);
    expect(a.environment).toMatchObject({
      name: "disco",
      platform: "platformio/ststm32@20.0.0",
      verified: true,
    });
    expect(a.environment.options.build_flags.section).toBe("env:disco");
    expect(a.packages.map((p: Json) => [p.kind, p.name, p.version])).toEqual([
      ["platform", "ststm32", "20.0.0"],
      ["package", "framework-cmsis", "2.50501.200527"],
      ["package", "toolchain-gccarmnoneeabi", "1.70201.0"],
      ["package", "tool-scons", "4.41101.0"],
      ["library", "Unity", "2.6.1"],
    ]);
    expect(a.tools).toMatchObject({ helper: "0.2.1", platformio: "6.2.0" });
    expect(a.inputs.before).toEqual(a.inputs.after);
    expect(Object.keys(a.inputs.before)).toContain("src/main.c");
    expect(a.size.usage.flash).toMatchObject({ used: 1144, limit: 1048576 });
    expect(a.size.limits).toEqual({ flash: 1048576, ram: 131072 });
    expect(a.size.elf.machine).toBe("arm");
    expect(readFileSync(join(folderOf(disco), "build.log"), "utf8")).toContain("[SUCCESS]");
    const build = calls().find((c) => c.tool === "build") as Json;
    expect(build.argv).toEqual(["run", "-d", project, "-e", "disco", "-t", "buildprog"]);
    expect(build.env).toMatchObject({
      PLATFORMIO_CORE_DIR: coreDir,
      PLATFORMIO_WORKSPACE_DIR: join(wb, "build", "disco", "build"),
      PLATFORMIO_LIBDEPS_DIR: join(wb, "build", "disco", "libdeps"),
      PLATFORMIO_SETTING_ENABLE_TELEMETRY: "No",
      PLATFORMIO_DISABLE_UPGRADE_CHECK: "true",
      PLATFORMIO_SETTING_ENABLE_CACHE: "No",
      // A fresh, empty cache of this run: PlatformIO still reads and reuses a cache with the setting off.
      PLATFORMIO_CACHE_DIR: join(folderOf(disco), "pio-cache"),
      HTTPS_PROXY: "http://127.0.0.1:9",
      HTTP_PROXY: "http://127.0.0.1:9",
    });
    expect(build.env.PLATFORMIO_EXTRA_SCRIPTS).toBeUndefined();
    expect(build.env.PLATFORMIO_BUILD_FLAGS).toBeUndefined();
    expect(readdirSync(join(project, ".pio"))).toEqual(["user.txt"]);
    // L08-G: a HIL plan (LAB-03) takes the build's copied ELF and SHA-256 as its firmware, no second programming path.
    const plan = {
      format: 1,
      id: "pio-board-basics",
      title: "PlatformIO build on the bench",
      setup: {
        board: "STM32F4DISCOVERY",
        revision: "MB997D",
        description: "fixture",
        wiring: [],
        firmwareEffect: "device-write",
        effectNote: "LED only",
      },
      firmware: {
        path: `embedded-lab-results/${disco.json.runId}/${elfA.path}`,
        sha256: elfA.sha256,
        format: "elf",
      },
      budget: { seconds: 60 },
      steps: [
        {
          id: "flash",
          phase: "setup",
          use: "probe-rs.flash",
          with: { probe: "stlink-a", chip: "STM32F407VGTx" },
        },
        {
          id: "banner",
          use: "serial.capture",
          with: { port: "COM5", baud: 115200, duration: 5, until: "^version 1.2.3" },
        },
      ],
    };
    expect(hilPlanProblems(plan)).toEqual([]);
    rmSyncCore("packages/tool-scons");
    const missing = pio(["build", "--request", request("disco")]);
    expect([missing.code, missing.json.code, missing.json.detail.missing]).toEqual([
      2,
      "packages-missing",
      ["package tool-scons"],
    ]);
    expect(calls().filter((c) => c.tool === "build").length).toBe(2);
  });

  it("reports failed builds with log-cited diagnostics and changed inputs, never editing the project (L08-F, REQ-REL-78cf222a)", () => {
    fake({ fail: true });
    const failed = pio(["build", "--request", ready("fail")]);
    expect([failed.code, failed.json.status, failed.json.code]).toEqual([1, "fail", "build-failed"]);
    expect(resultOf(failed).diagnostics[0]).toMatchObject({
      code: "compiler",
      file: "src/main.c",
      line: 42,
      log: "build.log",
    });
    fake({ touch: "src/main.c" });
    const touched = pio(["build", "--request", ready("touch")]);
    expect([touched.code, touched.json.code]).toEqual([3, "input-changed"]);
    expect(touched.json.reason).toContain("src/main.c");
  });

  it("binds each build folder to one project, environment and core; pristine rebuilds, foreign folders stay (REQ-REL-7dde63c1)", async () => {
    expect(pio(["build", "--request", ready("a")]).code).toBe(0);
    // The same folder for another environment: refused before any package check.
    const other = pio([
      "build",
      "--request",
      request("a2", { environment: "disco_fast", buildDir: "build/a" }),
    ]);
    expect([other.code, other.json.code]).toEqual([2, "build-dir-mismatch"]);
    // Re-pointed at another core folder: --pristine rebuilds, deleting only the operation folders (libdeps stay).
    const core2 = join(root, "core2");
    await cp(coreDir, core2, { recursive: true });
    const moved = { core: core2.replaceAll("\\", "/"), buildDir: "build/a" };
    expect(pio(["build", "--request", request("a3", moved)]).json.code).toBe("build-dir-mismatch");
    const pristine = pio(["build", "--request", request("a3", moved), "--pristine"]);
    expect([pristine.code, pristine.json.status, pristine.json.code]).toEqual([0, "pass", null]);
    expect(resultOf(pristine).buildFolder).toBe("pristine");
    expect(existsSync(join(wb, "build", "a", "libdeps", "disco", "Unity", "library.json"))).toBe(true);
    await mkdir(join(wb, "build", "x"), { recursive: true });
    writeFileSync(join(wb, "build", "x", "keep.txt"), "mine");
    const foreign = pio(["build", "--request", request("x"), "--pristine"]);
    expect([foreign.code, foreign.json.code]).toEqual([2, "build-dir-foreign"]);
    expect(readFileSync(join(wb, "build", "x", "keep.txt"), "utf8")).toBe("mine");
  });

  it("cleans only VERA's operation folders, never libdeps, the project's .pio or a link's target (L08-F, REQ-SEC-4a902240)", async () => {
    await mkdir(join(project, ".pio"));
    writeFileSync(join(project, ".pio", "user.txt"), "keep");
    expect(pio(["build", "--request", ready("c")]).code).toBe(0);
    await libdeps("c");
    const outside = join(wb, "precious");
    await mkdir(outside);
    writeFileSync(join(outside, "data.txt"), "keep");
    symlinkSync(outside, join(wb, "build", "c", "build", "link"), windows ? "junction" : "dir");
    const cleaned = pio(["clean", "--request", request("c")]);
    expect([cleaned.code, cleaned.json.removed]).toEqual([0, ["build"]]);
    expect(readdirSync(join(wb, "build", "c")).sort()).toEqual([".vera-platformio-build.json", "libdeps"]);
    expect(readFileSync(join(outside, "data.txt"), "utf8")).toBe("keep");
    expect(readFileSync(join(project, ".pio", "user.txt"), "utf8")).toBe("keep");
    await mkdir(join(wb, "build", "u"), { recursive: true });
    const foreign = pio(["clean", "--request", request("u")]);
    expect([foreign.code, foreign.json.code]).toEqual([2, "build-dir-foreign"]);
  });

  it("reports the owned build's artifacts and memory use without building (REQ-FUNC-c54befe2)", () => {
    const build = pio(["build", "--request", ready("art")]);
    const report = pio(["artifacts", "--request", request("art")]);
    expect([report.code, report.json.status]).toEqual([0, "pass"]);
    expect(report.json.artifacts.map((a: Json) => a.sha256)).toEqual(
      build.json.artifacts.map((a: Json) => a.sha256),
    );
    expect(resultOf(report).size.elf.machine).toBe("arm");
    expect(calls().filter((c) => c.tool === "build").length).toBe(1);
  });

  it("prepares packages as the one network step without touching platformio.ini (L08-E, REQ-FUNC-335f12b1)", async () => {
    await rm(coreDir, { recursive: true });
    await mkdir(coreDir);
    fake({});
    const iniHash = sha256(readFileSync(join(project, "platformio.ini")));
    const prepared = pio(["prepare-packages", "--request", request("prep", { upload: true })]);
    expect([prepared.code, prepared.json.status], JSON.stringify(prepared.json)).toEqual([0, "pass"]);
    const installs = calls().filter((c) => c.tool === "pkg");
    expect(installs.map((c) => c.argv)).toEqual([
      ["pkg", "install", "-d", project, "-e", "disco", "--no-save"],
      ["pkg", "install", "-g", "-t", "platformio/tool-scons@4.41101.0"],
      ["pkg", "install", "-g", "-t", "platformio/tool-openocd@~3.1200.7"],
    ]);
    for (const call of installs) {
      // The network step keeps the user's own proxy (the helper is given one); the others get the closed one.
      expect(call.env.HTTPS_PROXY).toBe("http://proxy.invalid:8080");
      expect(call.env.PLATFORMIO_LIBDEPS_DIR).toBe(join(wb, "build", "prep", "libdeps"));
    }
    expect(sha256(readFileSync(join(project, "platformio.ini")))).toBe(iniHash);
    expect(resultOf(prepared).packages.map((p: Json) => p.name)).toContain("Unity");
    expect(pio(["build", "--request", request("prep", { upload: true })]).json.status).toBe("pass");
    // Without `upload: true` no uploader is installed (uploading is chosen at provisioning).
    const plain = pio(["prepare-packages", "--request", request("prep2")]);
    expect(plain.json.status).toBe("pass");
    expect(calls().filter((c) => c.tool === "pkg").length).toBe(5);
  });

  it("runs native host tests per case: fail, skip and error are never a pass (L08-C, REQ-FUNC-427ebd28)", async () => {
    const gcc = join(root, "gcc");
    await mkdir(gcc);
    fake({
      tests: {
        test_lines: [
          ["test_assembles_a_line", "PASSED", null],
          ["test_formats_numbers", "PASSED", null],
        ],
        test_skip: [
          ["test_formats_zero", "PASSED", null],
          ["test_needs_a_board", "SKIPPED", "needs the real board"],
        ],
        test_fail: [
          ["test_formats_seven", "PASSED", null],
          ["test_expects_the_wrong_text", "FAILED", "Expected '21' Was '12'"],
        ],
        test_crash: [
          ["test_formats_seven", "PASSED", null],
          ["test_crashes", "ERRORED", "Program received signal SIGSEGV"],
        ],
      },
    });
    const host = (tests: string[]) =>
      pio([
        "test-host",
        "--request",
        request("host", { environment: "native", tests, hostToolchain: gcc.replaceAll("\\", "/") }),
      ]);
    expect(
      pio(["prepare-packages", "--request", request("host", { environment: "native" })]).json.status,
    ).toBe("pass");
    const pass = host(["test_lines"]);
    expect([pass.code, pass.json.status], JSON.stringify(pass.json)).toEqual([0, "pass"]);
    const call = calls().find((c) => c.tool === "test") as Json;
    expect(call.argv.slice(0, 6)).toEqual(["test", "-d", project, "-e", "native", "-v"]);
    expect(call.argv.slice(-2)).toEqual(["--filter", "test_lines"]);
    expect(call.env.PATH.split(windows ? ";" : ":")[0]).toBe(gcc);
    expect(resultOf(pass).tests[0].cases.map((c: Json) => c.status)).toEqual(["pass", "pass"]);
    expect(readFileSync(join(folderOf(pass), "junit.xml"), "utf8")).toContain('tests="2" failures="0"');
    expect([host(["test_skip"]).json.status, host(["test_fail"]).json.status]).toEqual([
      "incomplete",
      "fail",
    ]);
    await mkdir(join(project, "test", "test_crash"));
    expect(host(["test_crash"]).json.status).toBe("error");
    await mkdir(join(project, "test", "test_missing_from_report"));
    const both = host(["test_lines", "test_missing_from_report"]);
    expect(both.json.status).toBe("error");
    const device = pio(["test-host", "--request", request("host2", { tests: ["test_lines"] })]);
    expect([device.code, device.json.code]).toEqual([2, "environment"]);
    const none = pio(["test-host", "--request", request("host3", { environment: "native" })]);
    expect([none.code, none.json.code]).toEqual([2, "request"]);
  });

  it("builds device tests only and takes the verdict from a run of the same ELF (L08-C/G, REQ-FUNC-a98ab34c)", async () => {
    expect(pio(["prepare-packages", "--request", request("dev")]).json.status).toBe("pass");
    const built = pio(["test-device", "--request", request("dev", { tests: ["test_lines"] })]);
    expect([built.code, built.json.status, built.json.code]).toEqual([0, "incomplete", "build-only"]);
    const call = calls().find((c) => c.tool === "test") as Json;
    expect(call.argv).toEqual([
      "test",
      "-d",
      project,
      "-e",
      "disco",
      "-v",
      "--filter",
      "test_lines",
      "--without-uploading",
      "--without-testing",
    ]);
    const suite = resultOf(built).tests[0];
    expect(suite).toMatchObject({ suite: "test_lines", status: "built", cases: [] });
    expect(suite.elf.sha256).toBe(sha256(readFileSync(join(renodeFirmware, "demo-silent.elf"))));
    const evidence = (name: string, firmware: string, text: string, status = "pass") => {
      const folder = join(wb, "embedded-lab-results", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "uart.log"), text);
      writeFileSync(
        join(folder, "result.json"),
        JSON.stringify({
          format: 1,
          kind: "renode-result",
          runId: name,
          state: "done",
          status,
          firmware: { sha256: firmware },
          uart: { file: "uart.log" },
          profile: { id: "stm32f4-discovery" },
        }),
      );
      return `embedded-lab-results/${name}`;
    };
    const elf = suite.elf.sha256;
    const passText =
      "test/test_lines/test_main.c:44:test_assembles_a_line:PASS\r\ntest/test_lines/test_main.c:45:test_ignores_empty_lines:PASS\r\n\r\n-----------------------\r\n2 Tests 0 Failures 0 Ignored \r\nOK\r\n";
    const testRun = (ev: string) =>
      pio([
        "test-run",
        "--test-device",
        `embedded-lab-results/${built.json.runId}`,
        "--suite",
        "test_lines",
        "--evidence",
        ev,
      ]);
    const mismatch = testRun(evidence("OTHER", "0".repeat(64), passText));
    expect([mismatch.code, mismatch.json.code]).toEqual([2, "evidence-mismatch"]);
    const pass = testRun(evidence("PASS", elf, passText));
    expect([pass.code, pass.json.status, pass.json.coverage]).toEqual([
      0,
      "pass",
      { evidence: "virtual", board: "disco_f407vg" },
    ]);
    expect(resultOf(pass).coverage.statement).toMatch(/not on the board/);
    const ignored = testRun(
      evidence(
        "IGN",
        elf,
        "a.c:1:test_x:PASS\na.c:2:test_y:IGNORE: needs the board\n2 Tests 0 Failures 1 Ignored\nOK\n",
      ),
    );
    expect([ignored.json.status, ignored.json.tests[0].code]).toEqual(["incomplete", "not-all-passed"]);
    const failed = testRun(
      evidence(
        "FAIL",
        elf,
        "a.c:1:test_x:FAIL: Expected 1 Was 2\na.c:1:test_x:PASS\n1 Tests 1 Failures 0 Ignored\nFAIL\n",
      ),
    );
    expect([failed.code, failed.json.status]).toEqual([1, "fail"]);
    const truncated = testRun(evidence("CUT", elf, "a.c:1:test_x:PASS\n"));
    expect([truncated.json.status, truncated.json.tests[0].code]).toEqual(["incomplete", "output-ended"]);
    const stopped = testRun(evidence("STOP", elf, passText, "stopped"));
    expect(stopped.json.status).toBe("incomplete");
    // An execution that did not pass (here an unmodeled access) never yields a pass, whatever its console says.
    const unmodeled = testRun(evidence("UNMOD", elf, passText, "incomplete"));
    expect([unmodeled.json.status, unmodeled.json.tests[0].code]).toEqual([
      "incomplete",
      "execution-incomplete",
    ]);
    // A LAB-03 HIL run of the same ELF is hardware evidence (a hand-written record here: no board is attached).
    const hil = join(wb, "embedded-lab-results", "HIL");
    mkdirSync(join(hil, "steps"), { recursive: true });
    writeFileSync(join(hil, "steps", "uart-1-1.log"), passText);
    writeFileSync(
      join(hil, "result.json"),
      JSON.stringify({
        format: 1,
        kind: "hil-test-result",
        runId: "HIL",
        state: "done",
        status: "pass",
        firmware: { sha256: elf },
        setup: { board: "STM32F4DISCOVERY", revision: "MB997D" },
      }),
    );
    const hardware = testRun("embedded-lab-results/HIL");
    expect([hardware.json.status, hardware.json.coverage.evidence]).toEqual(["pass", "hardware"]);
    const nativeRun = pio([
      "test-device",
      "--request",
      request("dev2", { environment: "native", tests: ["test_lines"] }),
    ]);
    expect([nativeRun.code, nativeRun.json.code]).toEqual([2, "environment"]);
  });

  it("uploads the owned firmware through the verified protocol with the probe serial, refusing everything else (L08-D, REQ-FUNC-26fb0ed6)", async () => {
    await mkdir(join(wb, "lab"));
    const registry = {
      format: 1,
      resources: [
        { alias: "stlink-a", kind: "probe", resource: PROBE, profile: "stm32f4-stlink" },
        {
          alias: "dmm",
          kind: "visa",
          resource: "TCPIP0::192.0.2.5::5025::SOCKET",
          profile: "keysight-34461a",
        },
      ],
    };
    writeFileSync(join(wb, "lab", "resources.json"), JSON.stringify(registry));
    const reg = { PLATFORMIO_UPLOAD_REGISTRY: join(wb, "lab", "resources.json") };
    const build = pio(["build", "--request", ready("up")]);
    const buildRun = `embedded-lab-results/${build.json.runId}`;
    const upload = (alias: string, req = "platformio/up.json") =>
      helper(
        uploadScript,
        ["upload", "--request", req, "--build", buildRun, "--probe", alias, "--firmware-effect", "none"],
        reg,
      );
    const done = upload("stlink-a");
    expect([done.code, done.json.status], JSON.stringify(done.json)).toEqual([0, "pass"]);
    expect(done.json.upload).toMatchObject({
      protocol: "stlink",
      physical: "unknown",
      probe: { alias: "stlink-a" },
      // This run carries no VERA_REGISTRY_SHA256, so the registry was read unchecked.
      registryVerified: false,
    });
    const call = calls().find((c) => c.tool === "upload") as Json;
    expect(call.argv).toEqual(["run", "-d", project, "-e", "disco", "-t", "nobuild", "-t", "upload"]);
    expect(call.env.PLATFORMIO_UPLOAD_FLAGS).toBe('-c "adapter serial 066DFF495754888367143220"');
    expect(call.env.HTTPS_PROXY).toBe("http://127.0.0.1:9");
    expect([upload("dmm").json.code, upload("ghost").json.code]).toEqual(["request", "request"]);
    ini("[env:disco_jlink]\nextends = env:disco\nupload_protocol = jlink\n");
    expect(upload("stlink-a", request("upj2", { environment: "disco_jlink" })).json.code).toBe("protocol");
    ini("[env:disco_flags]\nextends = env:disco\nupload_flags = -c init\n");
    expect(upload("stlink-a", request("upf", { environment: "disco_flags" })).json.code).toBe("upload-flags");
    ini("");
    writeFileSync(join(wb, "build", "up", "build", "build", "disco", "firmware.elf"), "changed");
    expect(upload("stlink-a").json.code).toBe("image-changed");
    expect(calls().filter((c) => c.tool === "upload").length).toBe(1);
    const release = helper(uploadScript, ["release", "--probe", "stlink-a"], reg);
    expect(release.json).toMatchObject({ kind: "platformio-upload-release", physical: "unknown" });
  });

  it("reserves the probe for the upload so another session is BUSY (L08-D)", async () => {
    await mkdir(join(wb, "lab"));
    const registry = {
      format: 1,
      resources: [{ alias: "stlink-a", kind: "probe", resource: PROBE, profile: "stm32f4-stlink" }],
    };
    await writeFile(join(wb, "lab", "resources.json"), JSON.stringify(registry));
    const build = pio(["build", "--request", ready("bz")]);
    const leases = new core.ResourceLeases({ root: join(root, "leases"), app: "test" });
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases,
    });
    const keys = labResourceKeys(labRegistrySchema.parse(registry).resources[0] as LabResource);
    fake({ sleep: 3 });
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: wb,
        executable: helperPython as string,
        args: [
          uploadScript,
          "upload",
          "--request",
          "platformio/bz.json",
          "--build",
          `embedded-lab-results/${build.json.runId}`,
          "--probe",
          "stlink-a",
          "--firmware-effect",
          "none",
        ],
        env: {
          PYTHONDONTWRITEBYTECODE: "1",
          PLATFORMIO_UPLOAD_REGISTRY: join(wb, "lab", "resources.json"),
          VERA_PIO_TEST: "1",
          VERA_PIO_TEST_PIO: fakePio,
        },
        background: true,
        lease: {
          claims: [{ kind: "probe", alias: "stlink-a", resource: PROBE, keys, actuates: true }],
          graceMs: 30_000,
          cleanup: {
            args: [uploadScript, "release", "--probe", "stlink-a"],
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
      expect(await run.done).toMatchObject({ exitCode: 0 });
    } finally {
      await runner.stopAll();
    }
  });

  it("stops a build through VERA's runner with no process left and folders intact (L08-F, REQ-REL-5800dc9e)", async () => {
    expect(pio(["build", "--request", ready("other")]).code).toBe(0);
    const otherElf = sha256(
      readFileSync(join(wb, "build", "other", "build", "build", "disco", "firmware.elf")),
    );
    const sources = sha256(readFileSync(join(project, "src", "main.c")));
    fake({ sleep: 60 });
    ready("slow");
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: wb,
        executable: helperPython as string,
        args: [toolScript, "build", "--request", "platformio/slow.json"],
        env: { PYTHONDONTWRITEBYTECODE: "1", VERA_PIO_TEST: "1", VERA_PIO_TEST_PIO: fakePio },
        background: true,
      });
      for (let i = 0; i < 400 && !calls().some((c) => c.tool === "build" && c.child); i++) await sleep(50);
      const started = calls().find((c) => c.tool === "build" && c.child) as Json;
      expect(started).toBeDefined();
      expect(await run.stop()).toMatchObject({ stopped: true });
      for (let i = 0; i < 100 && (alive(started.pid) || alive(started.child)); i++) await sleep(100);
      expect([alive(started.pid), alive(started.child)]).toEqual([false, false]);
    } finally {
      await runner.stopAll();
    }
    const partial = runs()
      .map((id) => JSON.parse(readFileSync(join(wb, "embedded-lab-results", id, "result.json"), "utf8")))
      .find((doc) => doc.operation === "build" && doc.buildDir?.endsWith("slow"));
    expect(partial).toMatchObject({ state: "running", operation: "build" });
    fake({});
    const report = pio(["artifacts", "--request", "platformio/slow.json"]);
    expect([report.code, report.json.code]).toEqual([3, "build-unfinished"]);
    expect(sha256(readFileSync(join(wb, "build", "other", "build", "build", "disco", "firmware.elf")))).toBe(
      otherElf,
    );
    expect(sha256(readFileSync(join(project, "src", "main.c")))).toBe(sources);
  });
});

it.skipIf(helperPython)(`skips the helper tests: ${NO_HELPER}`, () => {
  expect(helperPython).toBeUndefined();
});

function rmSyncCore(part?: string) {
  rmSync(part ? join(coreDir, part) : join(coreDir, "platforms"), { recursive: true, force: true });
}

describe.skipIf(!helperPython || !realRoot)(
  "real PlatformIO Core 6.2.0 (opt-in VERA_PIO_REAL)",
  { timeout: 1_800_000 },
  () => {
    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), "vera-pio-real-")));
      wb = join(root, "wb");
      coreDir = join(realRoot as string, "core");
      project = join(wb, PROJECT);
      await cp(join(fixtures, "board-demo"), project, { recursive: true });
      await mkdir(join(wb, "platformio"), { recursive: true });
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    });
    const real = (args: string[]) => helper(toolScript, args, {}, true);
    /** The real prepare-packages (the network step; served from PlatformIO's caches once the core is filled), then
     * the request with Unity's build script approved by hash, as the user would after reading it. */
    const readyReal = (name: string, fields: Json = {}) => {
      const environment = (fields.environment as string | undefined) ?? "disco";
      const prepared = real(["prepare-packages", "--request", request(name, fields)]);
      expect(prepared.json.status, JSON.stringify(prepared.json)).toBe("pass");
      return request(name, { ...fields, hooks: unityHooks(name, environment) });
    };

    it("builds both STM32F4 environments offline into separate folders with distinct ELFs and versions (L08-A/E)", () => {
      const discoRequest = readyReal("disco");
      const disco = real(["build", "--request", discoRequest]);
      const fast = real(["build", "--request", readyReal("fast", { environment: "disco_fast" })]);
      expect(
        [disco.json.status, fast.json.status],
        `${JSON.stringify(disco.json)}\n${JSON.stringify(fast.json)}`,
      ).toEqual(["pass", "pass"]);
      const a = resultOf(disco);
      const b = resultOf(fast);
      const elf = (doc: Json) => doc.artifacts.find((x: Json) => x.role === "elf").sha256;
      expect(elf(a)).not.toBe(elf(b));
      expect(a.packages.find((p: Json) => p.kind === "platform")).toMatchObject({
        name: "ststm32",
        version: "20.0.0",
      });
      expect(a.packages.find((p: Json) => p.name === "toolchain-gccarmnoneeabi")?.version).toMatch(
        /^1\.\d+\.\d+$/,
      );
      expect(a.size.elf.machine).toBe("arm");
      expect(a.size.usage.flash.used).toBeGreaterThan(0);
      expect(a.inputs.before).toEqual(a.inputs.after);
      expect(existsSync(join(project, ".pio"))).toBe(false);
      if (realRenode) {
        // The PlatformIO ELF on the LAB-06 profile: the board-basics protocol (integrated acceptance step 6/7).
        const elfFile = relativeToBench(
          join(folderOf(disco), a.artifacts.find((x: Json) => x.role === "elf").path),
        );
        const basics = renodeSim([
          "test",
          "--firmware",
          elfFile,
          "--test-set",
          "board-basics",
          "--param",
          "version=1.2.3",
          "--param",
          "banner=VERA-FW platformio-demo",
        ]);
        const verdict = JSON.parse(basics.stdout.trim().split("\n").at(-1) ?? "{}");
        expect(verdict.status, basics.stdout.slice(-1500)).toBe("pass");
      }
      writeFileSync(
        join(project, "src", "main.c"),
        `${readFileSync(join(project, "src", "main.c"), "utf8")}\nint broken(void) { return undeclared; }\n`,
      );
      const failed = real(["build", "--request", discoRequest]);
      expect([failed.json.status, failed.json.code]).toEqual(["fail", "build-failed"]);
      expect(resultOf(failed).diagnostics.find((d: Json) => d.code === "compiler")).toMatchObject({
        line: expect.any(Number),
      });
    });

    it.skipIf(!realGcc)(
      "runs the native Unity suites on the host: pass, fail and skip stay distinct (L08-C)",
      async () => {
        const native = { environment: "native", hostToolchain: (realGcc as string).replaceAll("\\", "/") };
        readyReal("host", native);
        const host = (tests: string[]) =>
          real([
            "test-host",
            "--request",
            request("host", { ...native, tests, hooks: unityHooks("host", "native") }),
          ]);
        const pass = host(["test_lines"]);
        expect(pass.json.status, JSON.stringify(pass.json)).toBe("pass");
        expect(resultOf(pass).tests[0].cases.length).toBe(4);
        expect(host(["test_fail"]).json.status).toBe("fail");
        expect(host(["test_skip"]).json.status).toBe("incomplete");
      },
    );

    it.skipIf(!existsSync(join(realRoot ?? "", "core", "packages", "tool-openocd")))(
      "uploads through PlatformIO's real OpenOCD to a probe serial no probe has: fail, physical unknown (L08-D)",
      async () => {
        const build = real(["build", "--request", readyReal("up")]);
        expect(build.json.status).toBe("pass");
        await mkdir(join(wb, "lab"));
        const resources = [
          {
            alias: "stlink-x",
            kind: "probe",
            resource: "0483:374B:VERA-NO-SUCH-PROBE",
            profile: "stm32f4-stlink",
          },
        ];
        writeFileSync(join(wb, "lab", "resources.json"), JSON.stringify({ format: 1, resources }));
        const upload = helper(
          uploadScript,
          [
            "upload",
            "--request",
            "platformio/up.json",
            "--build",
            `embedded-lab-results/${build.json.runId}`,
            "--probe",
            "stlink-x",
            "--firmware-effect",
            "none",
          ],
          { PLATFORMIO_UPLOAD_REGISTRY: join(wb, "lab", "resources.json") },
          true,
        );
        const packagesDir = join(realRoot as string, "core", "packages");
        if (!existsSync(join(packagesDir, "tool-stm32flash"))) {
          // PlatformIO requires every ststm32 uploader for an upload target; only tool-openocd was provisioned here,
          // so the helper refuses before the probe is touched and names what is missing.
          expect([upload.code, upload.json.code], JSON.stringify(upload.json)).toEqual([
            2,
            "packages-missing",
          ]);
          expect(upload.json.detail.missing.join(" ")).toContain("tool-stm32flash");
          return;
        }
        expect(
          [upload.code, upload.json.status, upload.json.upload?.physical],
          JSON.stringify(upload.json),
        ).toEqual([1, "fail", "unknown"]);
        expect(readFileSync(join(folderOf(upload), "upload.log"), "utf8")).toMatch(
          /adapter serial VERA-NO-SUCH-PROBE|open failed|No ST-?Link/i,
        );
      },
    );

    it("builds the device test firmware only, and with the real Renode takes the verdict from its UART (L08-C/G)", async (ctx) => {
      const built = real([
        "test-device",
        "--request",
        readyReal("dev", { tests: ["test_lines", "test_fail"] }),
      ]);
      expect([built.json.status, built.json.code], JSON.stringify(built.json)).toEqual([
        "incomplete",
        "build-only",
      ]);
      if (!realRenode) ctx.skip("built only: the Renode run needs VERA_RENODE_REAL");
      for (const [suite, expected] of [
        ["test_lines", "pass"],
        ["test_fail", "fail"],
      ] as const) {
        const entry = resultOf(built).tests.find((t: Json) => t.suite === suite);
        const elfPath = relativeToBench(join(folderOf(built), entry.elf.path));
        const capture = renodeSim(["capture-uart", "--firmware", elfPath, "--until", "^(OK|FAIL)\\s*$"]);
        const runId = JSON.parse(capture.stdout.trim().split("\n").at(-1) ?? "{}").runId;
        const verdict = real([
          "test-run",
          "--test-device",
          `embedded-lab-results/${built.json.runId}`,
          "--suite",
          suite,
          "--evidence",
          `embedded-lab-results/${runId}`,
        ]);
        expect(verdict.json.status, `${capture.stdout.slice(-800)}\n${JSON.stringify(verdict.json)}`).toBe(
          expected,
        );
      }
    });
  },
);

const relativeToBench = (path: string) => path.slice(wb.length + 1).replaceAll("\\", "/");

/** The renode plugin's helper against the real engine (LAB-06), on the stm32f4-discovery profile. */
function renodeSim(args: string[]) {
  const [operation, ...rest] = args;
  return spawnSync(
    helperPython as string,
    [
      join(plugins, "renode", "scripts", "renode_sim.py"),
      operation as string,
      "--profile",
      "stm32f4-discovery",
      "--arch",
      "cortex-m4",
      "--boot-address",
      "0x08000000",
      "--virtual-budget",
      "30",
      "--real-timeout",
      "240",
      ...rest,
    ],
    {
      cwd: wb,
      env: { ...process.env, VERA_PROGRAM_RENODE: realRenode as string },
      encoding: "utf8",
      timeout: 300_000,
    },
  );
}

/** The hook approvals of the installed Unity library's build script (the real Unity declares an extraScript). */
function unityHooks(name: string, environment: string): Json[] {
  const folder = join(wb, "build", name, "libdeps", environment, "Unity");
  if (!existsSync(join(folder, "library.json"))) return [];
  const script = JSON.parse(readFileSync(join(folder, "library.json"), "utf8")).build?.extraScript;
  if (!script) return [];
  const path = join(folder, script);
  return [
    {
      file: path.replaceAll("\\", "/"),
      sha256: sha256(readFileSync(path)),
      reason: "Unity's own build script",
    },
  ];
}
