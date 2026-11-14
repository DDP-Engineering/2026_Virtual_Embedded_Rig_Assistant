// The micropython plugin without a board. Default tests check the package, the risk rules and micropython-tool against
// a simulated MicroPython board (tests/fixtures/micropython/fake-serial: raw REPL, file system, faults) reached through a
// minimal mpremote-compatible client (fake-mpremote) - offline evidence only, never proof of a real board. VERA's real
// runner and lease registry run the helper. VERA_MICROPYTHON_UV names a real uv: the opt-in test installs the pinned
// mpremote through VERA's provisioner and drives the same simulated board with it. VERA_TEST_MICROPYTHON_PORT and
// VERA_TEST_MICROPYTHON_IDENTITY name a real board for the hardware test.
// REQ-DATA-cb0ccbea REQ-SEC-bf7892ca REQ-FUNC-884fed95 REQ-SEC-dee0e930 REQ-REL-2eaebfec REQ-FUNC-b829232e
// REQ-FUNC-d8afbfa0 REQ-FUNC-9d90c56e REQ-SEC-d31255bc REQ-SEC-b493a006 REQ-FUNC-9dc200c3 REQ-REL-af9aefa3
// REQ-REL-1499a74b REQ-REL-8d35cfbd REQ-FUNC-ab3282a4 REQ-FUNC-eddae180 REQ-FUNC-2c9933c0 REQ-FUNC-44f315bd
// REQ-SEC-d8ec50bc REQ-FUNC-f030cffe REQ-FUNC-b9a25608 REQ-TEST-6073fccf
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const pluginFolder = join(software, "plugins", "micropython");
const scripts = join(pluginFolder, "scripts");
const script = join(scripts, "micropython_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/micropython/", import.meta.url));
const fakeSerial = join(fixtures, "fake-serial");
const fakeMpremote = join(fixtures, "fake-mpremote");
const windows = process.platform === "win32";
const python = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const PICO = "usb:2e8a:0005:E661";
const firmware = {
  name: "micropython",
  version: [1, 24, 1],
  machine: "Raspberry Pi Pico with RP2040",
  platform: "rp2",
  release: "1.24.1",
  mpy: 6,
  uniqueId: "e6614c311b7e1234",
};
interface BoardConfig {
  fs?: string;
  fsSize?: number;
  blockSize?: number;
  firmware?: Record<string, unknown>;
  hashlib?: boolean;
  renameOverExisting?: boolean;
  rawPaste?: boolean;
  app?: string;
  faults?: Record<string, unknown>;
}

let root = "";
const paths = () => ({
  bench: join(root, "bench.json"),
  state: join(root, "state.json"),
  log: join(root, "fake.log"),
  fs: join(root, "board-fs"),
});
async function setBench(board: BoardConfig = {}) {
  await writeFile(
    paths().bench,
    JSON.stringify({
      ports: [
        {
          device: "COM5",
          vid: 0x2e8a,
          pid: 0x0005,
          serial_number: "E661",
          description: "Board in FS mode",
          manufacturer: "MicroPython",
          board: "pico",
        },
        { device: "COM8", vid: 0x10c4, pid: 0xea60, serial_number: "01", description: "CP2102 USB to UART" },
        { device: "COM9", description: "Communications Port" },
      ],
      boards: {
        pico: { fs: paths().fs, fsSize: 1_441_792, blockSize: 4096, firmware, ...board },
      },
    }),
  );
}
async function boardFile(path: string, content: string | Buffer) {
  const full = join(paths().fs, ...path.split("/").filter(Boolean));
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}
const boardText = (path: string) =>
  readFileSync(join(paths().fs, ...path.split("/").filter(Boolean)), "utf8");
const boardHas = (path: string) => existsSync(join(paths().fs, ...path.split("/").filter(Boolean)));
const events = () => (existsSync(paths().log) ? readFileSync(paths().log, "utf8").trim().split("\n") : []);

function environment(extra: Record<string, string> = {}, mpremote = true): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: [...(mpremote ? [fakeMpremote] : []), fakeSerial].join(delimiter),
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    FAKE_MPY_BENCH: paths().bench,
    FAKE_MPY_STATE: paths().state,
    FAKE_MPY_LOG: paths().log,
    ...extra,
  };
}
// biome-ignore lint/suspicious/noExplicitAny: the helper's printed JSON documents, checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
  stderr: string;
}
function mpy(args: string[], extra: Record<string, string> = {}): Run {
  const result = spawnSync(python, [script, ...args], {
    cwd: root,
    env: environment(extra),
    encoding: "utf8",
    timeout: 90_000,
  });
  let json: Json = {};
  try {
    json = JSON.parse(result.stdout ?? "{}");
  } catch {
    json = { unparsed: result.stdout };
  }
  return { code: result.status, json, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
const device = (operation: string, ...rest: string[]) => [
  operation,
  "--port",
  "COM5",
  "--identity",
  PICO,
  ...rest,
];
const resultOf = (run: Run) => JSON.parse(readFileSync(join(root, run.json.resultPath ?? ""), "utf8"));
const codes = (run: Run) => (run.json.errors ?? []).map((error: { code: string }) => error.code);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-mpy-")));
  await mkdir(join(root, ".vera"));
  await mkdir(paths().fs);
  await boardFile("/boot.py", "# boot\n");
  await boardFile("/main.py", "print('app')\n");
  await boardFile("/lib/a.py", "A = 1\n");
  await setBench();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("package", () => {
  it("publishes the official micropython package with one pinned helper, two skills, catalog and pack entries", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({ id: "micropython", version: "1.0.0", platforms: ["windows-x64", "linux-x64"] });
    expect(Object.keys(m.programs)).toEqual(["micropython-tool"]);
    expect(m.programs["micropython-tool"]?.install).toEqual({ script: "scripts/micropython_tool.py" });
    expect(readFileSync(script, "utf8")).toContain(
      'dependencies = ["mpremote==1.29.0", "pyserial==3.5", "platformdirs==4.14.0"]',
    );
    const catalog = parse(readFileSync(join(software, "plugins", "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("micropython");
    expect(catalog.metadata.micropython.activities).toEqual(["flash", "testing"]);
    const packs = parse(readFileSync(join(software, "plugins", "packs.yaml"), "utf8"));
    const arduino = packs.find((pack: { id: string }) => pack.id === "arduino");
    expect(arduino.groups).toContainEqual({ name: "MicroPython", plugins: ["micropython"], default: true });
    expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("micropython");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "micropython")
      .map((skill) => skill.name);
    expect(names.sort()).toEqual(["micropython-deploy", "micropython-test-script"]);
    const deploy = (await skills.read("plugin", "micropython-deploy")).content;
    for (const text of ["deploy-file", "--expect-sha256", "--startup", "identity", "BUSY"])
      expect(deploy).toContain(text);
    const test = (await skills.read("plugin", "micropython-test-script")).content;
    for (const text of ["run-file", "--timeout", "program_stop", "keeps running"])
      expect(test).toContain(text);
  });

  it("classifies every operation by its effect on the board", () => {
    const m = manifest();
    const risk = (line: string) => {
      const [program, ...args] = line.split(" ");
      return classifyCommand(m.rules ?? [], program as string, args).risk;
    };
    for (const line of [
      "micropython-tool --version",
      "micropython-tool ports",
      "micropython-tool report --run r",
    ])
      expect(risk(line)).toBe("safe");
    for (const operation of [
      "identify",
      "files",
      "read-file --remote /a.py",
      "capture-output --duration 5",
      "reset --mode hard",
    ])
      expect(risk(`micropython-tool ${operation} --port COM5 --identity ${PICO}`)).toBe("device-read");
    expect(
      risk(`micropython-tool deploy-file --port COM5 --identity ${PICO} --source a.py --remote /lib/a.py`),
    ).toBe("device-write");
    expect(risk(`micropython-tool run-file --port COM5 --identity ${PICO} --source t.py`)).toBe(
      "device-write",
    );
    expect(
      risk(
        `micropython-tool deploy-file --port COM5 --identity ${PICO} --source m.py --remote /main.py --startup`,
      ),
    ).toBe("irreversible");
    const notes = (m.rules ?? []).map((rule) => `${rule.match} ${rule.note ?? ""}`).join("\n");
    expect(notes).toMatch(/identify,files,read-file\} \*.*interrupts the running program/);
    expect(notes).toMatch(/run-file \*.*Stop ends the helper, not code already running on the board/);
  });

  it("offers no REPL, connect, exec, eval or mount and refuses unknown options", () => {
    for (const args of [
      ["repl"],
      ["exec", "print(1)"],
      ["eval", "1+1"],
      ["mount", "."],
      ["connect", "COM5"],
      ["ports", "--bogus"],
    ]) {
      const run = mpy(args);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({ status: "blocked", errors: [{ code: "arguments" }] });
    }
    expect(events().filter((line) => line.startsWith("open"))).toEqual([]);
  });

  it("carries workspace.py as a byte-identical copy of the shared path rules", async () => {
    const ours = await readFile(join(scripts, "micropython_support", "workspace.py"));
    const theirs = await readFile(
      join(software, "plugins", "arduino-cli", "scripts", "arduino_support", "workspace.py"),
    );
    expect(ours.equals(theirs)).toBe(true);
  });
});

describe("ports and identity", () => {
  it("lists identity keys without naming a board behind a USB bridge or opening a port", () => {
    const run = mpy(["ports"]);
    expect(run.code).toBe(0);
    expect(run.json.ports).toEqual([
      expect.objectContaining({ address: "COM5", identity: PICO, stable: true, vid: "2e8a", pid: "0005" }),
      expect.objectContaining({
        address: "COM8",
        identity: "usb:10c4:ea60:01",
        bridge: "Silicon Labs CP210x",
      }),
      expect.objectContaining({ address: "COM9", identity: "serial:COM9", stable: false }),
    ]);
    expect(JSON.stringify(run.json.ports)).not.toMatch(/Pico|RP2040/);
    expect(run.json.ports.some((port: Json) => "board" in port || "boards" in port)).toBe(false);
    expect(events().some((line) => line.startsWith("open"))).toBe(false);
  });

  it("refuses a missing port or another identity before opening it", () => {
    const missing = mpy(["identify", "--port", "COM6", "--identity", PICO]);
    expect(missing.code).toBe(2);
    expect(codes(missing)).toEqual(["port-missing"]);
    const other = mpy(["identify", "--port", "com5", "--identity", "usb:2e8a:0005:AAAA"]);
    expect(other.code).toBe(2);
    expect(codes(other)).toEqual(["identity-mismatch"]);
    expect(events().some((line) => line.startsWith("open"))).toBe(false);
  });
});

describe("identify, files and read-file", () => {
  it("identifies the board, writes a run folder and leaves the program interrupted", () => {
    const run = mpy([...device("identify"), "--run-id", "id-1"]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result).toMatchObject({
      format: 1,
      kind: "micropython-tool-result",
      operation: "identify",
      runId: "id-1",
      status: "pass",
      port: { address: "COM5", identity: PICO, stable: true },
      firmware: {
        implementation: "micropython",
        version: "1.24.1",
        machine: firmware.machine,
        platform: "rp2",
        release: "1.24.1",
        mpy: 6,
      },
      uniqueId: "e6614c311b7e1234",
      memFree: 187264,
      filesystem: { size: 1_441_792, blockSize: 4096 },
      application: "interrupted",
    });
    expect(result.filesystem.free).toBeGreaterThan(0);
    expect(existsSync(join(root, "arduino-iot-results", "id-1", "report.md"))).toBe(true);
    expect(events()).toContain("open COM5");
    expect(events()).toContain("close COM5");
    // The raw REPL was left before the port closed: no REPL session stays open.
    expect(events().indexOf("raw-exit")).toBeGreaterThan(events().indexOf("open COM5"));
    expect(events().indexOf("raw-exit")).toBeLessThan(events().indexOf("close COM5"));
    expect(events()).not.toContain("soft-reset");
    const again = mpy([...device("identify"), "--run-id", "id-1"]);
    expect(codes(again)).toEqual(["run-exists"]);
    const vera = mpy([...device("identify"), "--results-dir", ".vera/x"]);
    expect(codes(vera)).toEqual(["path"]);
  });

  it("refuses CircuitPython and MicroPython older than 1.22 before listing or writing anything", async () => {
    await writeFile(join(root, "new.py"), "x = 1\n");
    for (const [name, version] of [
      ["circuitpython", [9, 2, 0]],
      ["micropython", [1, 21, 0]],
    ] as const) {
      await setBench({ firmware: { ...firmware, name, version } });
      for (const args of [
        device("identify"),
        device("files"),
        device("deploy-file", "--source", "new.py", "--remote", "/new.py"),
        device("run-file", "--source", "new.py"),
      ]) {
        const run = mpy(args);
        expect(run.code).toBe(2);
        expect(run.json).toMatchObject({
          status: "blocked",
          errors: [{ code: "incompatible-firmware" }],
          firmware: { implementation: name, version: version.join(".") },
        });
      }
    }
    expect(boardHas("/new.py")).toBe(false);
    expect(events().some((line) => line.includes("exec x = 1"))).toBe(false);
    // Refused firmware is not restarted either.
    expect(mpy([...device("identify"), "--restart"]).code).toBe(2);
    expect(events()).not.toContain("restart");
    await setBench({ firmware: { ...firmware, version: [1, 22, 0] } });
    expect(mpy(device("identify")).code).toBe(0);
  });

  it("lists files to a depth, caps the listing and refuses a missing folder", async () => {
    await boardFile("/lib/deep/deeper/x.py", "x\n");
    const shallow = mpy([...device("files"), "--depth", "1"]);
    expect(shallow.code).toBe(0);
    const listed = resultOf(shallow).entries.map((entry: { path: string }) => entry.path);
    expect(listed).toEqual(["/boot.py", "/lib", "/main.py"]);
    expect(resultOf(shallow).entries[0]).toEqual({ path: "/boot.py", type: "file", size: 7 });
    const deep = resultOf(mpy(device("files", "--path", "/lib")));
    expect(deep.entries.map((entry: { path: string }) => entry.path)).toEqual([
      "/lib/a.py",
      "/lib/deep",
      "/lib/deep/deeper",
      "/lib/deep/deeper/x.py",
    ]);
    await mkdir(join(paths().fs, "many"));
    for (let i = 0; i < 1005; i++)
      await writeFile(join(paths().fs, "many", `f${String(i).padStart(4, "0")}`), "");
    const many = mpy(device("files", "--path", "/many"));
    expect(resultOf(many).entries).toHaveLength(1000);
    expect(resultOf(many).omitted).toBe(5);
    expect(codes(mpy(device("files", "--path", "/nope")))).toEqual(["remote-missing"]);
  });

  it("copies a board file with its hashes, also without hashlib, and refuses folders and large files", async () => {
    const run = mpy(device("read-file", "--remote", "/main.py"));
    expect(run.code).toBe(0);
    const result = resultOf(run);
    const content = "print('app')\n";
    expect(result.file).toMatchObject({
      remote: "/main.py",
      size: content.length,
      sha256: sha256(content),
      deviceSha256: sha256(content),
    });
    expect(readFileSync(join(root, result.file.path), "utf8")).toBe(content);
    await setBench({ hashlib: false });
    expect(resultOf(mpy(device("read-file", "--remote", "/main.py"))).file).toMatchObject({
      sha256: sha256(content),
      deviceSha256: null,
    });
    expect(codes(mpy(device("read-file", "--remote", "/lib")))).toEqual(["not-a-file"]);
    await boardFile("/big.bin", Buffer.alloc(1024 * 1024 + 1));
    await setBench({ fsSize: 16 * 1024 * 1024 });
    expect(codes(mpy(device("read-file", "--remote", "/big.bin")))).toEqual(["too-large"]);
  });

  it("refuses remote paths outside the allowed form before opening the port", () => {
    for (const remote of [
      "lib/a.py",
      "/lib/../boot.py",
      "/a//b",
      "/a\\b",
      `/${"x".repeat(255)}`,
      "/a\nb",
      "/lib/a.py.vera-part",
    ]) {
      const run = mpy(device("read-file", "--remote", remote));
      expect(run.code, remote).toBe(2);
      expect(codes(run)).toEqual(["remote-path"]);
    }
    expect(codes(mpy(device("files", "--path", "/x/./y")))).toEqual(["remote-path"]);
    for (const remote of ["lib/a.py", "/lib/../a.py", "/a//b.py", "/lib/a.py.vera-part"])
      expect(codes(mpy(device("deploy-file", "--source", "x.py", "--remote", remote)))).toEqual([
        "remote-path",
      ]);
    expect(events().some((line) => line.startsWith("open"))).toBe(false);
  });
});

describe("deploy-file", () => {
  beforeEach(async () => {
    await writeFile(join(root, "a.py"), "A = 2  # new\n");
  });
  const deploy = (...rest: string[]) =>
    mpy(device("deploy-file", "--source", "a.py", "--remote", "/lib/a.py", ...rest));

  it("replaces a file through a verified temporary copy by rename and records both hashes", () => {
    const run = deploy("--restart");
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result).toMatchObject({
      status: "pass",
      remote: "/lib/a.py",
      source: { sha256: sha256("A = 2  # new\n"), size: 13 },
      before: { exists: true, size: 6, sha256: sha256("A = 1\n") },
      after: { size: 13, sha256: sha256("A = 2  # new\n") },
      mechanism: "rename",
      verified: true,
      application: "restarted",
    });
    expect(boardText("/lib/a.py")).toBe("A = 2  # new\n");
    expect(boardHas("/lib/a.py.vera-part")).toBe(false);
    expect(readFileSync(join(root, result.source.path), "utf8")).toBe("A = 2  # new\n");
    expect(events()).toContain("restart");
  });

  it("removes then renames where the file system cannot rename over a file, and records a new file as absent", async () => {
    await setBench({ renameOverExisting: false });
    expect(resultOf(deploy())).toMatchObject({ mechanism: "remove-then-rename", verified: true });
    const fresh = mpy(device("deploy-file", "--source", "a.py", "--remote", "/lib/new/b.py", "--mkdir"));
    expect(resultOf(fresh)).toMatchObject({
      before: { exists: false },
      created: ["/lib/new"],
      mechanism: "rename",
    });
    expect(codes(mpy(device("deploy-file", "--source", "a.py", "--remote", "/x/y.py")))).toEqual([
      "remote-missing",
    ]);
    // A refusal with --mkdir creates nothing: every check comes before the first write.
    const before = events().length;
    expect(
      codes(
        mpy(
          device(
            "deploy-file",
            "--source",
            "a.py",
            "--remote",
            "/q/z.py",
            "--mkdir",
            "--expect-sha256",
            sha256("x"),
          ),
        ),
      ),
    ).toEqual(["conflict"]);
    expect(boardHas("/q")).toBe(false);
    expect(
      events()
        .slice(before)
        .some((line) => line.includes("mkdir")),
    ).toBe(false);
    expect(
      resultOf(mpy(device("deploy-file", "--source", "a.py", "--remote", "/lib/sensor.py"))),
    ).toMatchObject({
      status: "pass",
      remote: "/lib/sensor.py",
    });
  });

  it("keeps the target when the board refuses a rename for another reason than an existing file", async () => {
    await setBench({ faults: { renameErrno: 5 } });
    const run = deploy();
    expect(run.code).toBe(1);
    expect(codes(run)).toEqual(["write-failed"]);
    expect(boardText("/lib/a.py")).toBe("A = 1\n");
    expect(boardHas("/lib/a.py.vera-part")).toBe(false);
  });

  it("deploys and runs through raw-paste mode with its flow control", async () => {
    await setBench({ rawPaste: true });
    await writeFile(join(root, "a.py"), "B = 3\n".repeat(200));
    expect(resultOf(deploy())).toMatchObject({ status: "pass", verified: true });
    expect(boardText("/lib/a.py")).toBe("B = 3\n".repeat(200));
    await writeFile(join(root, "t.py"), `print('paste')\n${"x = 1\n".repeat(100)}`);
    expect(resultOf(mpy(device("run-file", "--source", "t.py")))).toMatchObject({
      status: "pass",
      output: "paste\r\n",
    });
  });

  it("writes boot.py or main.py only with --startup, in any letter case", () => {
    const refused = mpy(device("deploy-file", "--source", "a.py", "--remote", "/main.py"));
    expect(codes(refused)).toEqual(["startup-file"]);
    for (const remote of ["/MAIN.PY", "/Boot.py", "/lib/main.py"])
      expect(codes(mpy(device("deploy-file", "--source", "a.py", "--remote", remote)))).toEqual([
        "startup-file",
      ]);
    expect(boardText("/main.py")).toBe("print('app')\n");
    expect(mpy(device("deploy-file", "--source", "a.py", "--remote", "/main.py", "--startup")).code).toBe(0);
    expect(boardText("/main.py")).toBe("A = 2  # new\n");
  });

  it("refuses an unexpected target, and fails without replacing when the target changes during the transfer", async () => {
    const wrong = deploy("--expect-sha256", sha256("other"));
    expect(wrong.code).toBe(2);
    expect(codes(wrong)).toEqual(["conflict"]);
    expect(codes(deploy("--expect-absent"))).toEqual(["conflict"]);
    expect(deploy("--expect-sha256", sha256("A = 1\n")).code).toBe(0);
    await boardFile("/lib/a.py", "A = 1\n");
    await setBench({
      faults: { concurrentWrite: { path: "/lib/a.py", afterChunks: 1, content: "A = 3\n" } },
    });
    const raced = deploy();
    expect(raced.code).toBe(1);
    expect(codes(raced)).toEqual(["conflict"]);
    expect(boardText("/lib/a.py")).toBe("A = 3\n");
    expect(boardHas("/lib/a.py.vera-part")).toBe(false);
  });

  it("fails on a device hash mismatch and leaves the target unchanged", async () => {
    await setBench({ faults: { corruptWrites: true } });
    const run = deploy();
    expect(run.code).toBe(1);
    expect(codes(run)).toEqual(["hash-mismatch"]);
    expect(boardText("/lib/a.py")).toBe("A = 1\n");
    expect(boardHas("/lib/a.py.vera-part")).toBe(false);
  });

  it("reports missing space before writing and during the transfer", async () => {
    await writeFile(join(root, "a.py"), "x".repeat(600));
    await setBench({ fsSize: 4 * 4096 });
    const early = deploy();
    expect(early.code).toBe(2);
    expect(codes(early)).toEqual(["no-space"]);
    expect(boardHas("/lib/a.py.vera-part")).toBe(false);
    await setBench({ faults: { noSpaceAfterBytes: 300 } });
    const late = deploy();
    expect(late.code).toBe(1);
    expect(codes(late)).toEqual(["no-space"]);
    expect(boardText("/lib/a.py")).toBe("A = 1\n");
    expect(boardHas("/lib/a.py.vera-part")).toBe(false);
  });

  it("reports an unplugged board and a reboot during the transfer distinctly, never as pass", async () => {
    await writeFile(join(root, "a.py"), "y".repeat(1500));
    await setBench({ faults: { disconnectAfterChunks: 2 } });
    const unplugged = deploy();
    expect(unplugged.code).toBe(3);
    expect(unplugged.json).toMatchObject({
      status: "error",
      errors: [{ code: "disconnected" }],
      phase: "transfer",
      application: "unknown",
    });
    expect(boardText("/lib/a.py")).toBe("A = 1\n");
    await rm(paths().state, { force: true });
    await setBench({ faults: { resetAfterChunks: 2 } });
    const rebooted = deploy();
    expect(rebooted.code).toBe(3);
    expect(rebooted.json).toMatchObject({
      status: "error",
      errors: [{ code: "device-reset" }],
      phase: "transfer",
    });
    expect(boardText("/lib/a.py")).toBe("A = 1\n");
    await setBench();
    const next = deploy();
    expect(next.code).toBe(0);
    expect(next.json.warnings.map((warning: { code: string }) => warning.code)).toContain(
      "stale-part-removed",
    );
    // The reboot happened while the chunk ran (after OK): mpremote waited for the end marker until its timeout.
  }, 60_000);

  it("classifies a silent board as no-response even after a reboot banner was read earlier", async () => {
    // Without hashlib the target is read back, so its bytes - a banner text - pass through the session first.
    await boardFile("/lib/a.py", "# MicroPython v1.24.1 soft reboot\n");
    await writeFile(join(root, "a.py"), "s".repeat(600));
    await setBench({ hashlib: false, faults: { silentAfterChunks: 1 } });
    const run = deploy();
    expect(run.code).toBe(3);
    expect(run.json).toMatchObject({ status: "error", errors: [{ code: "no-response" }], phase: "transfer" });
    expect(boardText("/lib/a.py")).toBe("# MicroPython v1.24.1 soft reboot\n");
  }, 60_000);

  it("leaves an incomplete result when the helper is killed during the transfer", async () => {
    await writeFile(join(root, "a.py"), "z".repeat(2000));
    await setBench({ faults: { slowChunks: 0.3 } });
    const child = spawn(
      python,
      [script, ...device("deploy-file", "--source", "a.py", "--remote", "/lib/a.py", "--run-id", "killed")],
      {
        cwd: root,
        env: environment(),
      },
    );
    const result = join(root, "arduino-iot-results", "killed", "result.json");
    const end = Date.now() + 30_000;
    while (!existsSync(result) && Date.now() < end) await sleep(50);
    await sleep(400);
    child.kill("SIGKILL");
    await new Promise((done) => child.on("close", done));
    expect(JSON.parse(readFileSync(result, "utf8"))).toMatchObject({
      status: "incomplete",
      phase: "transfer",
      target: "unchanged",
    });
    expect(boardText("/lib/a.py")).toBe("A = 1\n");
  });
});

describe("run-file, capture-output and reset", () => {
  it("runs a script from RAM with a verdict, a deadline and the application state", async () => {
    await writeFile(join(root, "ok.py"), "print('ok')\n");
    await writeFile(join(root, "bad.py"), "print('before')\nraise ValueError('boom')\n");
    await writeFile(join(root, "hang.py"), "import time\nwhile True:\n    time.sleep(0.05)\n");
    const ok = mpy(device("run-file", "--source", "ok.py"));
    expect(ok.code).toBe(0);
    const passed = resultOf(ok);
    expect(passed).toMatchObject({ status: "pass", application: "stopped", output: "ok\r\n" });
    expect(readFileSync(join(root, passed.outputPath), "utf8")).toBe("ok\r\n");
    expect(events()).toContain("soft-reset");
    const bad = mpy(device("run-file", "--source", "bad.py"));
    expect(bad.code).toBe(1);
    expect(resultOf(bad)).toMatchObject({
      status: "fail",
      exception: "ValueError: boom",
      output: "before\r\n",
    });
    expect(resultOf(bad).traceback).toContain("line 2");
    const started = Date.now();
    const hang = mpy(device("run-file", "--source", "hang.py", "--timeout", "2"));
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(hang.code).toBe(3);
    expect(hang.json).toMatchObject({
      status: "incomplete",
      errors: [{ code: "timeout" }],
      application: "interrupted",
    });
    expect(mpy(device("run-file", "--source", "ok.py", "--restart")).json.application).toBe("restarted");
    expect(readdirSync(paths().fs).sort()).toEqual(["boot.py", "lib", "main.py"]);
  });

  it("caps the captured output", async () => {
    await writeFile(join(root, "loud.py"), "for i in range(400):\n    print('0123456789')\n");
    const run = resultOf(mpy(device("run-file", "--source", "loud.py", "--max-output", "1024")));
    expect(run.output.length).toBe(1024);
    expect(run.outputTruncated).toBeGreaterThan(0);
  });

  it("captures the console for a bounded time, without sending anything unless --restart", async () => {
    await setBench({ app: "tick" });
    const plain = mpy(device("capture-output", "--duration", "1"));
    expect(plain.code).toBe(0);
    const captured = resultOf(plain);
    expect(captured.application).toBe("unchanged");
    expect(captured.firmware).toBeNull();
    expect(readFileSync(join(root, captured.outputPath), "utf8")).toMatch(/tick \d+/);
    expect(events()).not.toContain("interrupt");
    const restarted = resultOf(mpy(device("capture-output", "--duration", "1", "--restart")));
    expect(restarted.application).toBe("restarted");
    expect(events()).toContain("restart");
    for (const duration of ["0", "601"])
      expect(codes(mpy(device("capture-output", "--duration", duration)))).toEqual(["arguments"]);
  });

  it("resets softly or hard and finds the board again by identity", async () => {
    expect(resultOf(mpy(device("reset", "--mode", "soft")))).toMatchObject({
      status: "pass",
      application: "restarted",
      firmware: { version: "1.24.1" },
    });
    expect(events()).toContain("restart");
    await setBench({ faults: { hardResetPort: "COM6" } });
    const hard = mpy(device("reset", "--mode", "hard"));
    expect(hard.code).toBe(0);
    expect(resultOf(hard)).toMatchObject({
      port: { address: "COM5", after: "COM6", identity: PICO },
      application: "restarted",
    });
    expect(events()).toContain("hard-reset");
    await rm(paths().state, { force: true });
    await setBench({ faults: { hardResetLost: true } });
    const lost = mpy(device("reset", "--mode", "hard"));
    expect(lost.code).toBe(3);
    expect(codes(lost)).toEqual(["port-lost"]);
  }, 60_000);
});

describe("report", () => {
  it("summarizes run folders and refuses a folder without a micropython-tool result", async () => {
    await writeFile(join(root, "a.py"), "A = 2\n");
    const identify = mpy([...device("identify"), "--run-id", "r1"]);
    const deployed = mpy([
      ...device("deploy-file", "--source", "a.py", "--remote", "/lib/a.py"),
      "--run-id",
      "r2",
    ]);
    expect([identify.code, deployed.code]).toEqual([0, 0]);
    const run = mpy([
      "report",
      "--run",
      "arduino-iot-results/r1",
      "--run",
      "arduino-iot-results/r2",
      "--run-id",
      "sum",
    ]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result.runs).toEqual([
      expect.objectContaining({ operation: "identify", status: "pass", identity: PICO, firmware: "1.24.1" }),
      expect.objectContaining({
        operation: "deploy-file",
        targetSha256: sha256("A = 2\n"),
        sourceSha256: sha256("A = 2\n"),
      }),
    ]);
    expect(readFileSync(join(root, "arduino-iot-results", "sum", "report.md"), "utf8")).toContain(
      "deploy-file",
    );
    await mkdir(join(root, "other"));
    await writeFile(
      join(root, "other", "result.json"),
      JSON.stringify({ format: 1, kind: "arduino-tool-result" }),
    );
    expect(codes(mpy(["report", "--run", "other"]))).toEqual(["run-invalid"]);
  });
});

describe("VERA's runner and lease registry", { timeout: 60_000 }, () => {
  it("runs the helper and refuses its port while another VERA process holds it", async () => {
    const leaseRoot = join(root, "leases");
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      // The other holder below is a pid that does not run; alive() keeps it a live holder.
      leases: new core.ResourceLeases({ root: leaseRoot, app: "test", alive: () => true }),
    });
    const env = Object.fromEntries(
      Object.entries(environment()).filter(
        ([name]) => name.startsWith("FAKE_MPY") || ["PYTHONPATH", "PYTHONDONTWRITEBYTECODE"].includes(name),
      ),
    ) as Record<string, string>;
    const request = {
      sessionId: "s1",
      workbench: root,
      executable: python,
      env,
      args: [script, ...device("identify")],
    };
    const ok = await runner.run(request);
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toContain('"status": "pass"');
    const other = new core.ResourceLeases({
      root: leaseRoot,
      app: "cli",
      pid: process.pid + 1,
      alive: () => true,
    });
    const held = await other.acquire(
      [{ kind: "serial", alias: "COM5", resource: "COM5", keys: ["serial:COM5"], actuates: false }],
      { sessionId: "cli", runId: "cli-run" },
    );
    await expect(runner.run(request)).rejects.toMatchObject({ code: "BUSY", params: { resource: "COM5" } });
    await held.release();
    expect((await runner.run(request)).exitCode).toBe(0);
  });
});

// Opt-in: the real mpremote 1.29.0 from PyPI (VERA_MICROPYTHON_UV = a real uv), driving the simulated board through
// the fake pyserial. This proves the helper against the pinned package's raw-REPL client, not any board.
describe.skipIf(!process.env.VERA_MICROPYTHON_UV)(
  "real mpremote over the simulated board (opt-in)",
  { timeout: 900_000 },
  () => {
    it("installs the pinned packages through VERA's provisioner and identifies, deploys and runs", async () => {
      const data = join(root, "data");
      const store = new core.PluginStore({ root: join(data, "plugins") });
      await store.install(pluginFolder);
      const host = new core.NodeProcessHost(spawn);
      // VERA_MICROPYTHON_PYTHON_SEED: a uv python folder whose cpython-3.13.* install is copied in, so only PyPI is reached.
      const seed = process.env.VERA_MICROPYTHON_PYTHON_SEED;
      if (seed)
        for (const name of await readdir(seed))
          if (/^cpython-3\.13\.\d+-/.test(name))
            await cp(join(seed, name), join(data, "plugins", "runtime", "python", name), { recursive: true });
      const provisioner = new core.Provisioner({
        store,
        root: join(data, "plugins", "runtime"),
        uv: { executable: process.env.VERA_MICROPYTHON_UV as string, prefix: [] },
        host,
        clock: { sleep },
        platform: core.pluginPlatform(process.platform, process.arch),
        fetch: (url, init) => fetch(url, init.signal ? { signal: init.signal } : {}),
        settings: () => undefined,
      });
      const statuses = await provisioner.install("micropython");
      expect(statuses[0]?.state).toBe("ready");
      const plugin = await store.load("micropython");
      const resolved = await provisioner.resolve(plugin, "micropython-tool");
      if (!resolved) throw Error("micropython-tool did not resolve");
      const runner = new core.ProgramRunner({
        host,
        clock: { sleep },
        leases: new core.ResourceLeases({ root: join(root, "leases"), app: "test" }),
      });
      const env = {
        ...resolved.env,
        PYTHONPATH: fakeSerial,
        FAKE_MPY_BENCH: paths().bench,
        FAKE_MPY_STATE: paths().state,
        FAKE_MPY_LOG: paths().log,
      };
      const run = async (args: string[]) => {
        const result = await runner.run({
          sessionId: "s1",
          workbench: root,
          executable: resolved.executable,
          env,
          args: [...(resolved.prefix ?? []), ...args],
        });
        return { ...result, json: JSON.parse(result.output.slice(result.output.indexOf("{"))) as Json };
      };
      // Real mpremote takes the raw-paste path, with its window flow control, against the simulated board.
      await setBench({ rawPaste: true });
      const identified = await run(device("identify"));
      expect(identified.json).toMatchObject({ status: "pass", firmware: { version: "1.24.1" } });
      await writeFile(join(root, "a.py"), "A = 5\n".repeat(100));
      const deployed = await run(device("deploy-file", "--source", "a.py", "--remote", "/lib/a.py"));
      expect(deployed.json).toMatchObject({ status: "pass", verified: true, mechanism: "rename" });
      expect(boardText("/lib/a.py")).toBe("A = 5\n".repeat(100));
      await writeFile(join(root, "t.py"), "print('real mpremote')\n");
      const ran = await run(device("run-file", "--source", "t.py"));
      expect(ran.json).toMatchObject({ status: "pass", output: "real mpremote\r\n" });
    });
  },
);

// Hardware: a real MicroPython board named by VERA_TEST_MICROPYTHON_PORT and VERA_TEST_MICROPYTHON_IDENTITY, with
// mpremote importable by the Python in VERA_TEST_PYTHON. Writes only /vera-test.py and removes nothing else.
describe.skipIf(!process.env.VERA_TEST_MICROPYTHON_PORT || !process.env.VERA_TEST_MICROPYTHON_IDENTITY)(
  "real MicroPython board (hardware)",
  { timeout: 300_000 },
  () => {
    const real = (operation: string, ...rest: string[]) => {
      const result = spawnSync(
        python,
        [
          script,
          operation,
          "--port",
          process.env.VERA_TEST_MICROPYTHON_PORT as string,
          "--identity",
          process.env.VERA_TEST_MICROPYTHON_IDENTITY as string,
          ...rest,
        ],
        { cwd: root, encoding: "utf8", timeout: 120_000 },
      );
      return JSON.parse(result.stdout) as Json;
    };
    it("identifies the board, deploys a file, runs a script and reads the file back", async () => {
      expect(real("identify")).toMatchObject({ status: "pass", firmware: { implementation: "micropython" } });
      await writeFile(join(root, "vera-test.py"), "print('vera hardware test')\n");
      expect(real("deploy-file", "--source", "vera-test.py", "--remote", "/vera-test.py")).toMatchObject({
        status: "pass",
        verified: true,
      });
      expect(real("run-file", "--source", "vera-test.py")).toMatchObject({
        status: "pass",
        output: "vera hardware test\r\n",
      });
      expect(real("read-file", "--remote", "/vera-test.py").file.sha256).toBe(
        sha256("print('vera hardware test')\n"),
      );
    });
  },
);
