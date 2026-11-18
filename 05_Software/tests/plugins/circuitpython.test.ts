// The circuitpython plugin without a board. Default tests check the package, the risk rules and circuitpython-tool
// against simulated CircuitPython boards: host folders stand for CIRCUITPY drives (VERA_CIRCUITPYTHON_FAKE_BENCH), a
// fake pyserial console (tests/fixtures/circuitpython/fake-serial) reruns code.py like the firmware's autoreload, a
// fake circup (fake-circup) supplies the bundle conventions, and fixture bundle zips (tests/support/
// make-circuitpython-bundle.py) are served from 127.0.0.1 - offline evidence only, never proof of a real board.
// VERA_CIRCUITPYTHON_UV names a real uv: the opt-in test installs the pinned circup through VERA's provisioner;
// with VERA_CIRCUITPYTHON_BUNDLE_TAG as well it downloads that real bundle tag from github.com.
// VERA_TEST_CIRCUITPY_VOLUME and VERA_TEST_CIRCUITPY_IDENTITY name a real board for the hardware test.
// REQ-DATA-8f309a53 REQ-SEC-a6773cd2 REQ-FUNC-1bb6b2bb REQ-FUNC-3f98ad97 REQ-SEC-b561dad0 REQ-SEC-8ddddfbb
// REQ-REL-e00b3fb2 REQ-FUNC-96d699ae REQ-FUNC-33fb01a8 REQ-FUNC-e51d0294 REQ-FUNC-37730607 REQ-REL-33085a32
// REQ-REL-ca9500d0 REQ-SEC-15d58156 REQ-SEC-1d4b7f0a REQ-FUNC-5a6f4aec REQ-SEC-a59697a3 REQ-REL-aa8de0c7
// REQ-REL-3542e56c REQ-REL-dff06f35 REQ-REL-b71b5cab REQ-FUNC-9845bd14 REQ-FUNC-3371a413 REQ-FUNC-52e12d99
// REQ-SEC-1102b4a6 REQ-FUNC-998ebdb7 REQ-FUNC-96c2f1de REQ-TEST-5af7bf4a
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { reportSkip } from "../support/skip-marker.js";

const software = fileURLToPath(new URL("../../", import.meta.url));
const pluginFolder = join(software, "plugins", "circuitpython");
const scripts = join(pluginFolder, "scripts");
const script = join(scripts, "circuitpython_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/circuitpython/", import.meta.url));
const fakeSerial = join(fixtures, "fake-serial");
const fakeCircup = join(fixtures, "fake-circup");
const bundleMaker = join(software, "tests", "support", "make-circuitpython-bundle.py");
const windows = process.platform === "win32";
const python = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const TAG = "20261110";
const UID = "E6614C311B7B6A2F";
const QTPY = `usb:239a:80f4:${UID}`;
const bootOut = (version = "9.2.1", uid: string | null = UID) =>
  `Adafruit CircuitPython ${version} on 2024-11-20; Adafruit QT Py RP2040 with rp2040\r\nBoard ID:adafruit_qtpy_rp2040\r\n${uid ? `UID:${uid}\r\n` : ""}`;

// biome-ignore lint/suspicious/noExplicitAny: the helper's printed JSON documents, checked field by field.
type Json = Record<string, any>;
interface Bench {
  volumes?: Json[];
  ports?: Json[];
  faults?: Json;
}

let root = "";
let served = "";
let base = "";
const paths = () => ({
  bench: join(root, "bench.json"),
  log: join(root, "console.log"),
  vol: join(root, "CIRCUITPY"),
  home: join(root, "cpy-home"),
});
const volume = (fields: Json = {}) => ({
  path: paths().vol,
  label: "CIRCUITPY",
  serial: "1234ABCD",
  ...fields,
});
const qtpyPort = (fields: Json = {}) => ({
  device: "COM7",
  vid: 0x239a,
  pid: 0x80f4,
  serial_number: UID,
  description: "QT Py RP2040",
  manufacturer: "Adafruit",
  volume: paths().vol,
  autoreload: true,
  ...fields,
});
async function setBench(bench: Bench = {}) {
  await writeFile(
    paths().bench,
    JSON.stringify({
      volumes: bench.volumes ?? [volume()],
      ports: bench.ports ?? [qtpyPort(), { device: "COM9", vid: 0x10c4, pid: 0xea60, serial_number: "01" }],
      faults: bench.faults ?? {},
    }),
  );
}
async function volFile(path: string, content: string | Buffer, folder = paths().vol) {
  const full = join(folder, ...path.split("/").filter(Boolean));
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}
const volText = (path: string, folder = paths().vol) =>
  readFileSync(join(folder, ...path.split("/").filter(Boolean)), "utf8");
const volHas = (path: string, folder = paths().vol) =>
  existsSync(join(folder, ...path.split("/").filter(Boolean)));
const consoleLog = () =>
  existsSync(paths().log) ? readFileSync(paths().log, "utf8").trim().split("\n") : [];
const parts = (folder = paths().vol): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".vera-part")) found.push(entry.name);
    }
  };
  walk(folder);
  return found;
};

function environment(extra: Record<string, string> = {}, circup = true): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: [...(circup ? [fakeCircup] : []), fakeSerial].join(delimiter),
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    VERA_CIRCUITPYTHON_FAKE_BENCH: paths().bench,
    FAKE_CPY_BENCH: paths().bench,
    FAKE_CPY_LOG: paths().log,
    VERA_CIRCUITPYTHON_HOME: paths().home,
    VERA_CIRCUITPYTHON_DOWNLOAD_BASE: base,
    ...extra,
  };
}
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
  stderr: string;
}
function cpy(args: string[], extra: Record<string, string> = {}): Run {
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
const vol = (operation: string, ...rest: string[]) => [
  operation,
  "--volume",
  paths().vol,
  "--identity",
  QTPY,
  ...rest,
];
const prepare = (...rest: string[]) =>
  cpy(["prepare-libraries", "--circuitpython", "9", "--bundle-tag", TAG, ...rest]);

// The fixture bundles are served by a separate process: the helper runs under spawnSync, which blocks this one.
const SERVER = String.raw`
import http.server, os, re, sys
folder, log = sys.argv[1], sys.argv[2]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with open(log, "a") as handle:
            handle.write(self.path + "\n")
        file = os.path.join(folder, *self.path.strip("/").split("/"))
        if not re.fullmatch(r"/\d{8}/[\w.-]+\.zip", self.path) or not os.path.isfile(file):
            self.send_response(404); self.end_headers(); return
        data = open(file, "rb").read()
        self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, *args):
        pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
`;
let serverProcess: ReturnType<typeof spawn>;
const requestLog = () => join(served, "requests.log");
const requests = () =>
  existsSync(requestLog()) ? readFileSync(requestLog(), "utf8").split(/\r?\n/).filter(Boolean) : [];
const clearRequests = () => writeFile(requestLog(), "");

beforeAll(async () => {
  served = await realpath(await mkdtemp(join(tmpdir(), "vera-cpy-bundles-")));
  const made = spawnSync(python, [bundleMaker, join(served, TAG), TAG], { encoding: "utf8" });
  if (made.status !== 0) throw Error(made.stderr);
  serverProcess = spawn(python, ["-c", SERVER, served, requestLog()], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<string>((done, fail) => {
    serverProcess.stdout?.once("data", (chunk: Buffer) => done(chunk.toString().trim()));
    serverProcess.once("exit", () => fail(Error("bundle server exited")));
  });
  base = `http://127.0.0.1:${port}/`;
});
afterAll(async () => {
  serverProcess.kill();
  await rm(served, { recursive: true, force: true, maxRetries: 5 });
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-circuitpython-")));
  await mkdir(join(root, ".vera"));
  await mkdir(paths().vol);
  await volFile("/boot_out.txt", bootOut());
  await setBench();
  await clearRequests();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("package", () => {
  it("publishes the official circuitpython package with one pinned helper, two skills, catalog and pack entries", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({
      id: "circuitpython",
      version: "0.2.1",
      platforms: ["windows-x64", "linux-x64"],
    });
    expect(Object.keys(m.programs)).toEqual(["circuitpython-tool"]);
    expect(m.programs["circuitpython-tool"]?.install).toEqual({ script: "scripts/circuitpython_tool.py" });
    expect(readFileSync(script, "utf8")).toContain('dependencies = ["circup==3.1.0", "pyserial==3.5"]');
    const catalog = parse(readFileSync(join(software, "plugins", "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("circuitpython");
    expect(catalog.metadata.circuitpython.activities).toEqual(["flash", "testing"]);
    const packs = parse(readFileSync(join(software, "plugins", "packs.yaml"), "utf8"));
    const arduino = packs.find((pack: { id: string }) => pack.id === "arduino");
    expect(arduino.groups).toContainEqual({
      name: "CircuitPython",
      plugins: ["circuitpython"],
      default: true,
    });
    expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("circuitpython");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "circuitpython")
      .map((skill) => skill.name);
    expect(names.sort()).toEqual(["circuitpython-deploy", "circuitpython-libraries"]);
    const deploy = (await skills.read("plugin", "circuitpython-deploy")).content;
    for (const text of [
      "--expect-from",
      "--boot",
      "--capture",
      "identity",
      "settings.toml",
      "keeps running",
      "BUSY",
    ])
      expect(deploy).toContain(text);
    const libraries = (await skills.read("plugin", "circuitpython-libraries")).content;
    for (const text of ["prepare-libraries", "--bundle-tag", "mpy-incompatible", "incompatible-libraries"])
      expect(libraries).toContain(text);
  });

  it("classifies every operation by its effect on the board", () => {
    const m = manifest();
    const risk = (line: string) => {
      const [program, ...args] = line.split(" ");
      return classifyCommand(m.rules ?? [], program as string, args).risk;
    };
    for (const line of [
      "circuitpython-tool --version",
      "circuitpython-tool devices",
      "circuitpython-tool report --run r",
    ])
      expect(risk(line)).toBe("safe");
    for (const operation of ["identify", "inspect-code", "inspect-libraries"])
      expect(risk(`circuitpython-tool ${operation} --volume E: --identity ${QTPY}`)).toBe("device-read");
    expect(risk(`circuitpython-tool capture-output --port COM7 --identity ${QTPY} --duration 5`)).toBe(
      "device-read",
    );
    expect(
      risk(`circuitpython-tool capture-output --port COM7 --identity ${QTPY} --duration 5 --reload`),
    ).toBe("device-write");
    expect(
      risk(`circuitpython-tool prepare-libraries --library neopixel --circuitpython 9 --bundle-tag ${TAG}`),
    ).toBe("device-write");
    expect(
      risk(`circuitpython-tool deploy --volume E: --identity ${QTPY} --source a.py --target /code.py`),
    ).toBe("device-write");
    expect(
      risk(`circuitpython-tool deploy --volume E: --identity ${QTPY} --source b.py --target /boot.py --boot`),
    ).toBe("irreversible");
    expect(risk("circuitpython-tool update --all")).not.toBe("safe");
    const notes = (m.rules ?? []).map((rule) => `${rule.match} ${rule.note ?? ""}`).join("\n");
    expect(notes).toMatch(
      /deploy \*.*reloads code\.py.*Stop ends the helper, not code already running on the board/,
    );
  });

  it("offers no REPL, exec, firmware or update operation and refuses incomplete deploys", () => {
    for (const args of [
      ["repl"],
      ["exec", "print(1)"],
      ["update"],
      ["update-all"],
      ["install-firmware"],
      ["uf2"],
    ]) {
      const run = cpy(args);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({ status: "blocked", errors: [{ code: "arguments" }] });
    }
    expect(cpy(vol("deploy")).json.errors[0].code).toBe("arguments");
    expect(cpy(vol("deploy", "--source", "a.py")).json.errors[0].code).toBe("arguments");
    expect(
      cpy(vol("deploy", "--source", "a.py", "--target", "/a.py", "--port", "COM7")).json.errors[0].code,
    ).toBe("arguments");
    expect(cpy(["--version"]).stdout.trim()).toBe("circuitpython-tool 0.2.1");
    expect(cpy(vol("identify", "--run-id", "same")).json.status).toBe("pass");
    const again = cpy(vol("identify", "--run-id", "same"));
    expect(again.code).toBe(2);
    expect(again.json.errors[0].code).toBe("run-exists");
    const inside = cpy(vol("identify", "--results-dir", ".vera/results"));
    expect(inside.json).toMatchObject({ status: "blocked", errors: [{ code: "path" }] });
    expect(readdirSync(join(root, ".vera"))).toEqual([]);
  });

  it("carries workspace.py as a byte-identical copy of the shared path rules", async () => {
    const ours = await readFile(join(scripts, "circuitpython_support", "workspace.py"));
    const theirs = await readFile(
      join(software, "plugins", "micropython", "scripts", "micropython_support", "workspace.py"),
    );
    expect(ours.equals(theirs)).toBe(true);
  });
});

describe("devices and identity", () => {
  it("lists CIRCUITPY volumes with firmware and binding and the serial ports, without writing or opening", async () => {
    const second = join(root, "SECOND");
    await mkdir(second);
    await volFile("/boot_out.txt", bootOut("10.0.3", "AA11BB22CC33DD44"), second);
    const other = join(root, "OTHER");
    await mkdir(other);
    await setBench({
      volumes: [
        volume(),
        { path: second, label: "CIRCUITPY", serial: "5555AAAA" },
        { path: other, label: "USBSTICK" },
      ],
    });
    const run = cpy(["devices"]);
    expect(run.code).toBe(0);
    expect(run.json.volumes).toHaveLength(2);
    expect(run.json.volumes[0]).toMatchObject({
      path: paths().vol,
      identity: QTPY,
      stable: true,
      bound: true,
      port: "COM7",
      readOnly: false,
      firmware: { version: "9.2.1", major: 9, boardId: "adafruit_qtpy_rp2040", uid: UID },
    });
    expect(run.json.volumes[1]).toMatchObject({
      identity: "circuitpy-uid:aa11bb22cc33dd44",
      bound: false,
      port: null,
      firmware: { version: "10.0.3", major: 10 },
    });
    expect(run.json.ports.map((port: Json) => port.identity)).toEqual([QTPY, "usb:10c4:ea60:01"]);
    expect(consoleLog()).toEqual([]);
    expect(readdirSync(paths().vol)).toEqual(["boot_out.txt"]);
  });

  it("binds a volume to a port only by a UID that exactly one port reports", async () => {
    await volFile("/boot_out.txt", bootOut("9.2.1", null));
    let listed = cpy(["devices"]).json.volumes[0];
    expect(listed).toMatchObject({ identity: "volume-serial:1234ABCD", stable: false, bound: false });
    await volFile("/boot_out.txt", bootOut());
    await setBench({ ports: [qtpyPort(), qtpyPort({ device: "COM8" })] });
    listed = cpy(["devices"]).json.volumes[0];
    expect(listed).toMatchObject({
      identity: `circuitpy-uid:${UID.toLowerCase()}`,
      bound: false,
      port: null,
    });
    await setBench({ ports: [qtpyPort({ serial_number: UID.toLowerCase() })] });
    expect(cpy(["devices"]).json.volumes[0]).toMatchObject({ bound: true, port: "COM7" });
  });

  it("refuses a missing volume or another identity before reading or writing it", async () => {
    await writeFile(join(root, "a.py"), "print(1)\n");
    const missing = cpy([
      "deploy",
      "--volume",
      join(root, "NOPE"),
      "--identity",
      QTPY,
      "--source",
      "a.py",
      "--target",
      "/a.py",
    ]);
    expect(missing.code).toBe(2);
    expect(missing.json.errors[0].code).toBe("volume-missing");
    const other = cpy([
      "deploy",
      "--volume",
      paths().vol,
      "--identity",
      "usb:239a:80f4:FFFF",
      "--source",
      "a.py",
      "--target",
      "/a.py",
    ]);
    expect(other.json).toMatchObject({ status: "blocked", errors: [{ code: "identity-mismatch" }] });
    expect(volHas("/a.py")).toBe(false);
    expect(consoleLog()).toEqual([]);
    expect(existsSync(join(root, "arduino-iot-results"))).toBe(false);
  });

  it("refuses writes when two volumes share an identity or a volume has none, and still reads them", async () => {
    const twin = join(root, "TWIN");
    await mkdir(twin);
    await volFile("/boot_out.txt", bootOut("9.2.1", null));
    await volFile("/boot_out.txt", bootOut("9.2.1", null), twin);
    await setBench({ volumes: [volume(), { path: twin, label: "CIRCUITPY", serial: "1234ABCD" }] });
    await writeFile(join(root, "a.py"), "print(1)\n");
    const key = "volume-serial:1234ABCD";
    const deploy = (folder: string) =>
      cpy(["deploy", "--volume", folder, "--identity", key, "--source", "a.py", "--target", "/a.py"]);
    expect(deploy(paths().vol).json.errors[0].code).toBe("ambiguous");
    expect(deploy(twin).json.errors[0].code).toBe("ambiguous");
    expect(cpy(["identify", "--volume", twin, "--identity", key]).json.status).toBe("pass");
    await setBench({ volumes: [volume({ serial: null })] });
    const none = cpy([
      "deploy",
      "--volume",
      paths().vol,
      "--identity",
      "volume-serial:1234ABCD",
      "--source",
      "a.py",
      "--target",
      "/a.py",
    ]);
    expect(none.json.errors[0].code).toBe("identity-insufficient");
    expect(cpy(["devices"]).json.volumes[0].identity).toBeNull();
    expect(volHas("/a.py")).toBe(false);
    expect(volHas("/a.py", twin)).toBe(false);
  });

  it("refuses firmware other than CircuitPython 9 to 11 on every volume operation", async () => {
    await volFile("/boot_out.txt", bootOut("8.2.10"));
    await writeFile(join(root, "a.py"), "print(1)\n");
    for (const args of [
      vol("identify"),
      vol("inspect-libraries"),
      vol("deploy", "--source", "a.py", "--target", "/a.py"),
    ]) {
      const run = cpy(args);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({
        status: "blocked",
        errors: [{ code: "incompatible-firmware" }],
        firmware: { version: "8.2.10" },
      });
    }
    expect(volHas("/a.py")).toBe(false);
    await rm(join(paths().vol, "boot_out.txt"));
    await setBench({ volumes: [volume()], ports: [] });
    const missing = cpy(["identify", "--volume", paths().vol, "--identity", "volume-serial:1234ABCD"]);
    expect(missing.json).toMatchObject({
      status: "blocked",
      firmware: null,
      errors: [{ code: "incompatible-firmware" }],
    });
    await volFile("/boot_out.txt", bootOut("10.0.3"));
    await setBench();
    expect(cpy(vol("identify")).json).toMatchObject({ status: "pass", platform: "10.x-mpy" });
  });
});

describe("identify and inspection", () => {
  it("identifies the board from its volume without writing to it", async () => {
    await setBench({ volumes: [volume({ free: 900_000, size: 1_000_000, blockSize: 512 })] });
    const before = readFileSync(join(paths().vol, "boot_out.txt"));
    const touched = statSync(join(paths().vol, "boot_out.txt")).mtimeMs;
    const run = cpy(vol("identify", "--run-id", "id1"));
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({
      status: "pass",
      runId: "id1",
      firmware: {
        version: "9.2.1",
        major: 9,
        date: "2024-11-20",
        board: "Adafruit QT Py RP2040",
        boardId: "adafruit_qtpy_rp2040",
        uid: UID,
      },
      platform: "9.x-mpy",
      mpyHeader: "C6",
      filesystem: { size: 1_000_000, free: 900_000, blockSize: 512 },
      readOnly: false,
      port: "COM7",
      volume: { identity: QTPY, bound: true },
    });
    expect(readFileSync(join(root, "arduino-iot-results", "id1", "report.md"), "utf8")).toContain(
      "CircuitPython 9.2.1",
    );
    expect(readFileSync(join(paths().vol, "boot_out.txt")).equals(before)).toBe(true);
    expect(statSync(join(paths().vol, "boot_out.txt")).mtimeMs).toBe(touched);
    expect(readdirSync(paths().vol)).toEqual(["boot_out.txt"]);
  });

  it("inspects the code files, names the startup file and never reads settings.toml", async () => {
    await volFile("/code.py", "print('code')\n");
    await volFile("/main.py", "print('main')\n");
    await volFile("/boot.py", "import storage\n");
    await volFile("/settings.toml", 'CIRCUITPY_WIFI_PASSWORD = "hunter2"\n');
    await volFile("/lib/neopixel.mpy", "C\x06x");
    const run = cpy(vol("inspect-code"));
    expect(run.json).toMatchObject({ status: "pass", startup: "/code.py" });
    const entries = Object.fromEntries(run.json.entries.map((entry: Json) => [entry.path, entry]));
    expect(entries["/code.py"]).toMatchObject({ type: "file", size: 14, sha256: sha256("print('code')\n") });
    expect(entries["/lib"]).toMatchObject({ type: "dir" });
    expect(entries["/settings.toml"]).toMatchObject({ secret: true, size: 36 });
    expect(entries["/settings.toml"].sha256).toBeUndefined();
    const folder = join(root, run.json.resultPath, "..");
    expect(readFileSync(join(folder, "files", "code.py"), "utf8")).toBe("print('code')\n");
    expect(readFileSync(join(folder, "files", "boot.py"), "utf8")).toBe("import storage\n");
    expect(readFileSync(join(folder, "result.json"), "utf8")).not.toContain("hunter2");
    expect(readFileSync(join(folder, "report.md"), "utf8")).not.toContain("hunter2");
    expect(existsSync(join(folder, "files", "settings.toml"))).toBe(false);
    await rm(join(paths().vol, "code.py"));
    expect(cpy(vol("inspect-code")).json.startup).toBe("/main.py");
  });

  it("marks .mpy modules that are not CircuitPython 9+ bytecode incompatible", async () => {
    await volFile("/lib/good.mpy", Buffer.from("C\x06\x00\x1f__version__\x002.0.1\x00", "latin1"));
    await volFile("/lib/old.mpy", Buffer.from("C\x05\x00\x1f__version__\x00", "latin1"));
    await volFile("/lib/micro.mpy", Buffer.from("M\x06\x00\x1f", "latin1"));
    await volFile("/lib/src.py", '__version__ = "1.0.0"\n');
    await volFile("/lib/pkg/__init__.mpy", Buffer.from("C\x06\x00\x1f__version__\x003.1.4\x00", "latin1"));
    await volFile("/lib/pkg/part.mpy", Buffer.from("C\x06\x00", "latin1"));
    const run = cpy(vol("inspect-libraries"));
    expect(run.json.status).toBe("pass");
    const verdicts = Object.fromEntries(run.json.modules.map((module: Json) => [module.name, module.abi]));
    expect(verdicts).toEqual({
      good: "compatible",
      micro: "incompatible",
      old: "incompatible",
      pkg: "compatible",
      src: "source",
    });
    const versions = Object.fromEntries(
      run.json.modules.map((module: Json) => [module.name, module.version]),
    );
    expect(versions).toMatchObject({ good: "2.0.1", src: "1.0.0", pkg: "3.1.4" });
    expect(run.json.warnings.filter((item: Json) => item.code === "mpy-incompatible")).toHaveLength(2);
  });
});

describe("prepare-libraries", () => {
  it("resolves dependencies from the pinned tag into a library set, from the cache the second time", async () => {
    const run = prepare(
      "--library",
      "adafruit_bme280",
      "--library",
      "Adafruit-CircuitPython-Extra",
      "--library",
      "adafruit_ghost",
      "--run-id",
      "set1",
    );
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({
      status: "pass",
      circuitpython: 9,
      platform: "9.x-mpy",
      network: true,
      librarySet: "arduino-iot-results/set1/library-set.json",
    });
    expect(requests().sort()).toEqual([
      `/${TAG}/adafruit-circuitpython-bundle-9.x-mpy-${TAG}.zip`,
      `/${TAG}/adafruit-circuitpython-bundle-py-${TAG}.zip`,
    ]);
    const set = JSON.parse(
      readFileSync(join(root, "arduino-iot-results", "set1", "library-set.json"), "utf8"),
    );
    expect(set).toMatchObject({
      format: 1,
      kind: "circuitpython-library-set",
      circuitpython: 9,
      platform: "9.x-mpy",
      requested: ["adafruit_bme280", "adafruit_extra", "adafruit_ghost"],
    });
    const byName = Object.fromEntries(set.libraries.map((library: Json) => [library.name, library]));
    expect(Object.keys(byName).sort()).toEqual([
      "adafruit_bme280",
      "adafruit_bus_device",
      "adafruit_extra",
      "adafruit_ghost",
      "adafruit_register",
      "adafruit_ticks",
    ]);
    expect(byName.adafruit_bus_device.requiredBy.sort()).toEqual(["adafruit_bme280", "adafruit_register"]);
    expect(byName.adafruit_ticks.requiredBy).toEqual(["adafruit_extra"]);
    expect(byName.adafruit_bme280).toMatchObject({ version: "2.6.4", requiredBy: [] });
    for (const library of set.libraries)
      for (const file of library.files) {
        const data = readFileSync(join(root, "arduino-iot-results", "set1", "libraries", file.path));
        expect(sha256(data)).toBe(file.sha256);
        expect(file.path).toMatch(/^lib\/.*\.mpy$/);
      }
    expect(set.bundle.assets.map((item: Json) => item.sha256)).toEqual([
      sha256(readFileSync(join(served, TAG, `adafruit-circuitpython-bundle-py-${TAG}.zip`))),
      sha256(readFileSync(join(served, TAG, `adafruit-circuitpython-bundle-9.x-mpy-${TAG}.zip`))),
    ]);
    expect(run.json.warnings).toEqual([expect.objectContaining({ code: "dependency-not-in-bundle" })]);
    expect(existsSync(join(root, "arduino-iot-results", "set1", "libraries", "lib", "neopixel.mpy"))).toBe(
      false,
    );
    await clearRequests();
    const again = prepare("--library", "neopixel");
    expect(again.json).toMatchObject({ status: "pass", network: false });
    expect(again.json.libraries.map((library: Json) => library.name)).toEqual([
      "neopixel",
      "adafruit_pixelbuf",
    ]);
    expect(requests()).toEqual([]);
    expect(readdirSync(paths().vol)).toEqual(["boot_out.txt"]);
  });

  it("writes no set when a selected library holds an incompatible .mpy file", () => {
    for (const library of ["adafruit_bad", "adafruit_badchild"]) {
      const run = prepare("--library", library);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({
        status: "blocked",
        errors: [{ code: "mpy-incompatible", files: ["lib/adafruit_bad.mpy"] }],
      });
      const folder = join(root, run.json.resultPath, "..");
      expect(existsSync(join(folder, "library-set.json"))).toBe(false);
      expect(existsSync(join(folder, "libraries"))).toBe(false);
    }
  });

  it("reports an unknown library, a missing tag, a bad tag and a changed cache distinctly", async () => {
    const unknown = prepare("--library", "adafruit_nothing");
    expect(unknown.json).toMatchObject({ status: "blocked", errors: [{ code: "unknown-library" }] });
    expect(existsSync(join(root, unknown.json.resultPath, "..", "library-set.json"))).toBe(false);
    const missing = cpy([
      "prepare-libraries",
      "--library",
      "neopixel",
      "--circuitpython",
      "9",
      "--bundle-tag",
      "20990101",
    ]);
    expect(missing.code).toBe(3);
    expect(missing.json).toMatchObject({ status: "error", errors: [{ code: "download-failed" }] });
    expect(existsSync(join(root, missing.json.resultPath, "..", "library-set.json"))).toBe(false);
    await clearRequests();
    expect(
      cpy(["prepare-libraries", "--library", "neopixel", "--circuitpython", "9", "--bundle-tag", "latest"])
        .json.errors[0].code,
    ).toBe("arguments");
    expect(
      cpy(["prepare-libraries", "--library", "neopixel", "--circuitpython", "8", "--bundle-tag", TAG]).json
        .errors[0].code,
    ).toBe("arguments");
    expect(requests()).toEqual([]);
    const cached = join(paths().home, "bundles", TAG, `adafruit-circuitpython-bundle-9.x-mpy-${TAG}.zip`);
    await writeFile(cached, Buffer.concat([readFileSync(cached), Buffer.from("tampered")]));
    const changed = prepare("--library", "neopixel");
    expect(changed.json).toMatchObject({ status: "blocked", errors: [{ code: "cache-changed" }] });
    expect(
      cpy(["prepare-libraries", "--library", "neopixel", "--circuitpython", "9", "--bundle-tag", TAG], {
        VERA_CIRCUITPYTHON_DOWNLOAD_BASE: "https://example.com/",
      }).json.errors[0].code,
    ).toBe("arguments");
  });
});

describe("deploy", () => {
  async function prepared(runId = "set", major = "9") {
    const run = cpy([
      "prepare-libraries",
      "--library",
      "adafruit_bme280",
      "--circuitpython",
      major,
      "--bundle-tag",
      TAG,
      "--run-id",
      runId,
    ]);
    expect(run.json.status).toBe("pass");
    return `arduino-iot-results/${runId}/library-set.json`;
  }

  it("writes the library set first and the startup code last, each file confirmed by its read-back hash", async () => {
    const set = await prepared();
    await writeFile(join(root, "code.py"), "import adafruit_bme280\nprint('deployed')\n");
    await writeFile(join(root, "helper.py"), "X = 1\n");
    await volFile("/code.py", "print('old')\n");
    await clearRequests();
    const run = cpy(
      vol(
        "deploy",
        "--libraries",
        set,
        "--source",
        "code.py",
        "--target",
        "/code.py",
        "--source",
        "helper.py",
        "--target",
        "/lib/helper.py",
      ),
    );
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({
      status: "pass",
      application: "updated",
      autoreload: "expected",
      librarySet: set,
    });
    const targets = run.json.files.map((file: Json) => file.target);
    expect(targets.at(-1)).toBe("/code.py");
    expect(targets.at(-2)).toBe("/lib/helper.py");
    expect(targets.slice(0, -2).every((target: string) => target.startsWith("/lib/adafruit_"))).toBe(true);
    expect(run.json.files.every((file: Json) => file.state === "confirmed")).toBe(true);
    const code = run.json.files.at(-1);
    expect(code).toMatchObject({
      source: "code.py",
      sha256: sha256("import adafruit_bme280\nprint('deployed')\n"),
      before: { exists: true, sha256: sha256("print('old')\n") },
    });
    expect(volText("/code.py")).toBe("import adafruit_bme280\nprint('deployed')\n");
    expect(volHas("/lib/adafruit_bus_device/i2c_device.mpy")).toBe(true);
    expect(parts()).toEqual([]);
    expect(run.json.created).toContain("/lib/adafruit_bme280");
    expect(requests()).toEqual([]);
  });

  it("warns about a startup file that shadows the deployed one and keeps a secret target's hash out of the result", async () => {
    await volFile("/code.py", "print('old code')\n");
    await writeFile(join(root, "main.py"), "print('main')\n");
    const shadowed = cpy(vol("deploy", "--source", "main.py", "--target", "/main.py"));
    expect(shadowed.json).toMatchObject({ status: "pass", startup: "/code.py" });
    expect(shadowed.json.warnings).toEqual([expect.objectContaining({ code: "startup-shadowed" })]);
    const secret = 'CIRCUITPY_WIFI_PASSWORD = "hunter2"\n';
    await volFile("/settings.toml", secret);
    await writeFile(join(root, "settings.toml"), 'CIRCUITPY_WIFI_PASSWORD = "new"\n');
    const inspected = cpy(vol("inspect-code", "--run-id", "secrets"));
    const deployed = cpy(
      vol(
        "deploy",
        "--source",
        "settings.toml",
        "--target",
        "/settings.toml",
        "--expect-from",
        inspected.json.resultPath,
      ),
    );
    expect(deployed.json).toMatchObject({
      status: "pass",
      files: [{ before: { exists: true, size: 36, secret: true } }],
    });
    expect(deployed.json.files[0].before.sha256).toBeUndefined();
    expect(readFileSync(join(root, deployed.json.resultPath), "utf8")).not.toContain(sha256(secret));
  });

  it("fails on a corrupted read-back and leaves that target unchanged", async () => {
    await writeFile(join(root, "code.py"), "print('new')\n");
    await volFile("/code.py", "print('old')\n");
    await setBench({ faults: { corruptReadBack: "/code.py" } });
    const run = cpy(vol("deploy", "--source", "code.py", "--target", "/code.py"));
    expect(run.code).toBe(1);
    expect(run.json).toMatchObject({
      status: "fail",
      errors: [{ code: "hash-mismatch" }],
      application: "unchanged",
    });
    expect(volText("/code.py")).toBe("print('old')\n");
    expect(parts()).toEqual([]);
  });

  it("refuses a library set made for another major version or changed since it was prepared", async () => {
    const set = await prepared("set10", "10");
    let run = cpy(vol("deploy", "--libraries", set));
    expect(run.json).toMatchObject({ status: "blocked", errors: [{ code: "incompatible-libraries" }] });
    const nine = await prepared("set9");
    const file = join(
      root,
      "arduino-iot-results",
      "set9",
      "libraries",
      "lib",
      "adafruit_bme280",
      "basic.mpy",
    );
    await writeFile(file, Buffer.concat([readFileSync(file), Buffer.from("x")]));
    run = cpy(vol("deploy", "--libraries", nine));
    expect(run.json).toMatchObject({ status: "blocked", errors: [{ code: "library-set-changed" }] });
    await writeFile(join(root, "not-a-set.json"), "{}");
    expect(cpy(vol("deploy", "--libraries", "not-a-set.json")).json.errors[0].code).toBe(
      "library-set-invalid",
    );
    expect(volHas("/lib")).toBe(false);
  });

  it("writes boot.py only with --boot and refuses firmware files and malformed targets", async () => {
    await writeFile(join(root, "b.py"), "import storage\n");
    for (const target of ["/boot.py", "/BOOT.PY"])
      expect(cpy(vol("deploy", "--source", "b.py", "--target", target)).json.errors[0].code).toBe(
        "startup-file",
      );
    for (const target of ["/boot_out.txt", "/lib/a.py.vera-part", "lib/a.py", "/lib/../a.py", "/a\\b.py"])
      expect(cpy(vol("deploy", "--source", "b.py", "--target", target)).json.errors[0].code).toBe(
        "target-path",
      );
    // Windows would write these as boot.py, below the --boot guard.
    for (const target of ["/boot.py.", "/boot.py ", "/boot.py::$DATA", "/lib./a.py"]) {
      const refused = cpy(vol("deploy", "--source", "b.py", "--target", target)).json.errors[0];
      expect(refused.code, target).toBe("target-path");
      expect(refused.message).toContain("name the file without them");
    }
    expect(
      cpy(vol("deploy", "--source", "b.py", "--target", "/a.py", "--source", "b.py", "--target", "/A.PY"))
        .json.errors[0].code,
    ).toBe("target-path");
    expect(readdirSync(paths().vol)).toEqual(["boot_out.txt"]);
    const run = cpy(vol("deploy", "--source", "b.py", "--target", "/boot.py", "--boot"));
    expect(run.json.status).toBe("pass");
    expect(volText("/boot.py")).toBe("import storage\n");
  });

  it("refuses a read-only volume before writing and stops when a write is refused as read-only", async () => {
    await writeFile(join(root, "a.py"), "A = 1\n");
    await writeFile(join(root, "b.py"), "B = 1\n");
    await setBench({ volumes: [volume({ readOnly: true })] });
    const before = cpy(vol("deploy", "--source", "a.py", "--target", "/a.py"));
    expect(before.json).toMatchObject({ status: "blocked", errors: [{ code: "read-only" }] });
    expect(volHas("/a.py")).toBe(false);
    await setBench({ faults: { readOnlyAtFile: 2 } });
    const during = cpy(
      vol("deploy", "--source", "a.py", "--target", "/a.py", "--source", "b.py", "--target", "/b.py"),
    );
    expect(during.code).toBe(1);
    expect(during.json).toMatchObject({
      status: "fail",
      errors: [{ code: "read-only" }],
      application: "partially-updated",
    });
    expect(during.json.files.map((file: Json) => file.state)).toEqual(["confirmed", "failed"]);
    expect(volHas("/b.py")).toBe(false);
  });

  it("refuses a deploy that does not fit and reports a volume that fills up during the transfer", async () => {
    await writeFile(join(root, "big.py"), "x".repeat(5000));
    await writeFile(join(root, "a.py"), "A = 1\n");
    await setBench({ volumes: [volume({ free: 1000, blockSize: 512 })] });
    const before = cpy(vol("deploy", "--source", "big.py", "--target", "/big.py"));
    expect(before.json).toMatchObject({
      status: "blocked",
      errors: [{ code: "no-space" }],
      space: { free: 1000 },
    });
    expect(before.json.space.needed).toBeGreaterThan(5000);
    expect(volHas("/big.py")).toBe(false);
    await volFile("/big.py", "old");
    await setBench({ faults: { noSpaceAtFile: 2 } });
    const during = cpy(
      vol("deploy", "--source", "a.py", "--target", "/a.py", "--source", "big.py", "--target", "/big.py"),
    );
    expect(during.json).toMatchObject({ status: "fail", errors: [{ code: "no-space" }] });
    expect(during.json.files.map((file: Json) => file.state)).toEqual(["confirmed", "failed"]);
    expect(volText("/big.py")).toBe("old");
    expect(parts()).toEqual([]);
  });

  it("reports an unplug as incomplete with the confirmed files, and leaves an incomplete result when killed", async () => {
    await writeFile(join(root, "a.py"), "A = 1\n");
    await writeFile(join(root, "code.py"), "print(1)\n");
    await setBench({ faults: { unplugAtFile: 2 } });
    const run = cpy(
      vol("deploy", "--source", "a.py", "--target", "/a.py", "--source", "code.py", "--target", "/code.py"),
    );
    expect(run.code).toBe(3);
    expect(run.json).toMatchObject({
      status: "incomplete",
      errors: [{ code: "disconnected" }],
      application: "unknown",
    });
    expect(run.json.files.map((file: Json) => file.state)).toEqual(["confirmed", "unconfirmed"]);
    // A Linux mount point can outlive the device: a write failing with EIO is a lost board, not a write failure.
    await setBench({ faults: { ioErrorAtFile: 2 } });
    const eio = cpy(
      vol("deploy", "--source", "a.py", "--target", "/a.py", "--source", "code.py", "--target", "/code.py"),
    );
    expect(eio.json).toMatchObject({
      status: "incomplete",
      errors: [{ code: "disconnected" }],
      application: "unknown",
    });
    await setBench({ faults: { slowWriteSeconds: 3 } });
    const child = spawn(
      python,
      [
        script,
        ...vol(
          "deploy",
          "--source",
          "a.py",
          "--target",
          "/a.py",
          "--source",
          "code.py",
          "--target",
          "/code.py",
          "--run-id",
          "killed",
        ),
      ],
      { cwd: root, env: environment() },
    );
    const result = join(root, "arduino-iot-results", "killed", "result.json");
    const end = Date.now() + 30_000;
    while (!existsSync(result) && Date.now() < end) await sleep(50);
    await sleep(300);
    child.kill("SIGKILL");
    await new Promise((done) => child.on("close", done));
    const left = JSON.parse(readFileSync(result, "utf8"));
    expect(left).toMatchObject({ status: "incomplete", phase: "transfer" });
    expect(left.application).not.toBe("updated");
    expect(left.files.some((file: Json) => file.state === "unconfirmed")).toBe(true);
  });

  it("refuses files changed since an inspection and fails when an editor changes a target during the deploy", async () => {
    await volFile("/code.py", "print('v1')\n");
    const inspected = cpy(vol("inspect-code", "--run-id", "look"));
    await volFile("/code.py", "print('editor')\n");
    await writeFile(join(root, "code.py"), "print('vera')\n");
    const stale = cpy(
      vol(
        "deploy",
        "--source",
        "code.py",
        "--target",
        "/code.py",
        "--expect-from",
        inspected.json.resultPath,
      ),
    );
    expect(stale.json).toMatchObject({ status: "blocked", errors: [{ code: "conflict" }] });
    expect(volText("/code.py")).toBe("print('editor')\n");
    const fresh = cpy(vol("inspect-code", "--run-id", "look2"));
    await setBench({ faults: { changeDuring: { target: "/code.py", content: "print('typing')\n" } } });
    const during = cpy(
      vol("deploy", "--source", "code.py", "--target", "/code.py", "--expect-from", fresh.json.resultPath),
    );
    expect(during.json).toMatchObject({ status: "fail", errors: [{ code: "conflict" }] });
    expect(volText("/code.py")).toBe("print('typing')\n");
    expect(parts()).toEqual([]);
  });
});

describe("console", { timeout: 60_000 }, () => {
  const capture = (...rest: string[]) =>
    cpy(["capture-output", "--port", "COM7", "--identity", QTPY, ...rest]);

  it("captures a run with its verdict and autoreload state, writing to the port only with --reload", async () => {
    await volFile("/code.py", "print('hello from code')\n");
    const passive = capture("--duration", "1");
    expect(passive.json).toMatchObject({ status: "pass", application: "unchanged" });
    expect(consoleLog().some((line) => line.startsWith("write"))).toBe(false);
    const done = capture("--duration", "10", "--reload");
    expect(done.json).toMatchObject({
      status: "pass",
      autoreload: "on",
      run: { file: "code.py", state: "finished" },
    });
    expect(done.json.run.output).toContain("hello from code");
    expect(consoleLog().filter((line) => line.startsWith("write"))).toEqual([
      "write COM7 03",
      "write COM7 04",
    ]);
    await volFile("/code.py", "print('before')\nraise ValueError('boom')\n");
    const failed = capture("--duration", "10", "--reload");
    expect(failed.code).toBe(1);
    expect(failed.json).toMatchObject({
      status: "fail",
      errors: [{ code: "exception" }],
      run: { state: "exception", exception: "ValueError: boom" },
    });
    expect(failed.json.run.traceback).toContain("Traceback (most recent call last):");
    await volFile("/code.py", "import time\nprint('loop')\nwhile True:\n    time.sleep(0.1)\n");
    const looping = capture("--duration", "4", "--reload");
    expect(looping.json).toMatchObject({ status: "pass", run: { state: "running" } });
    expect(readFileSync(join(root, looping.json.consolePath), "utf8")).toContain("loop");
    expect(capture("--duration", "1", "--identity", "usb:1:2:3").json.errors[0].code).toBe(
      "identity-mismatch",
    );
  });

  it("captures the run an autoreload starts after a deploy", async () => {
    await writeFile(join(root, "ok.py"), "print('deployed ok')\n");
    const ok = cpy(
      vol("deploy", "--source", "ok.py", "--target", "/code.py", "--capture", "15", "--port", "COM7"),
    );
    expect(ok.json).toMatchObject({
      status: "pass",
      application: "updated",
      autoreload: "on",
      run: { state: "finished" },
    });
    expect(ok.json.run.output).toContain("deployed ok");
    await writeFile(join(root, "bad.py"), "raise RuntimeError('wired wrong')\n");
    const bad = cpy(
      vol("deploy", "--source", "bad.py", "--target", "/code.py", "--capture", "15", "--port", "COM7"),
    );
    expect(bad.json).toMatchObject({
      status: "fail",
      errors: [{ code: "exception" }],
      run: { exception: "RuntimeError: wired wrong" },
    });
    expect(bad.json.files[0].state).toBe("confirmed");
    await setBench({ ports: [qtpyPort({ autoreload: false })] });
    const off = cpy(
      vol("deploy", "--source", "ok.py", "--target", "/code.py", "--capture", "2", "--port", "COM7"),
    );
    expect(off.code).toBe(3);
    // With autoreload off the firmware prints no banner, so the state is not observable from the writes alone.
    expect(off.json).toMatchObject({
      status: "incomplete",
      errors: [{ code: "no-run-observed" }],
      autoreload: "unknown",
    });
    await setBench();
    await writeFile(join(root, "other.py"), "print(2)\n");
    const wrong = cpy(
      vol("deploy", "--source", "other.py", "--target", "/other.py", "--capture", "2", "--port", "COM9"),
    );
    expect(wrong.json).toMatchObject({ status: "blocked", errors: [{ code: "port-mismatch" }] });
    expect(volHas("/other.py")).toBe(false);
  });
});

describe("report", () => {
  it("summarizes run folders and refuses a folder without a circuitpython-tool result", async () => {
    const prepared = prepare("--library", "neopixel", "--run-id", "p1");
    await writeFile(join(root, "a.py"), "A = 1\n");
    const deployed = cpy(vol("deploy", "--source", "a.py", "--target", "/a.py", "--run-id", "d1"));
    expect(deployed.json.status).toBe("pass");
    const run = cpy([
      "report",
      "--run",
      "arduino-iot-results/p1",
      "--run",
      "arduino-iot-results/d1",
      "--run-id",
      "r1",
    ]);
    expect(run.json).toMatchObject({ status: "pass" });
    expect(run.json.runs).toMatchObject([
      { operation: "prepare-libraries", status: "pass", librarySet: prepared.json.librarySet },
      { operation: "deploy", status: "pass", identity: QTPY, firmware: "9.2.1", confirmed: 1 },
    ]);
    const markdown = readFileSync(join(root, "arduino-iot-results", "r1", "report.md"), "utf8");
    expect(markdown).toContain("| `arduino-iot-results/d1` | deploy | pass |");
    expect(markdown).toContain(prepared.json.librarySet);
    await volFile("/code.py", "print('c')\n");
    const captured = cpy([
      "capture-output",
      "--port",
      "COM7",
      "--identity",
      QTPY,
      "--duration",
      "1",
      "--run-id",
      "c1",
    ]);
    expect(captured.json.status).toBe("pass");
    const withCapture = cpy(["report", "--run", "arduino-iot-results/c1"]);
    expect(withCapture.json.runs[0]).toMatchObject({ operation: "capture-output", identity: QTPY });
    await mkdir(join(root, "empty"));
    expect(cpy(["report", "--run", "empty"]).json.errors[0].code).toBe("run-invalid");
  });
});

describe("VERA's runner and lease registry", { timeout: 60_000 }, () => {
  it("runs the helper and refuses its volume while another VERA process holds it", async () => {
    const leaseRoot = join(root, "leases");
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases: new core.ResourceLeases({ root: leaseRoot, app: "test", alive: () => true }),
    });
    const env = Object.fromEntries(
      Object.entries(environment()).filter(
        ([name]) =>
          name.startsWith("FAKE_CPY") ||
          name.startsWith("VERA_CIRCUITPYTHON") ||
          ["PYTHONPATH", "PYTHONDONTWRITEBYTECODE"].includes(name),
      ),
    ) as Record<string, string>;
    const request = {
      sessionId: "s1",
      workbench: root,
      executable: python,
      env,
      args: [script, ...vol("identify")],
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
    const key = core.volumeKeys(["--volume", paths().vol], (path: string) => path)[0] as string;
    const held = await other.acquire(
      [{ kind: "volume", alias: paths().vol, resource: paths().vol, keys: [key], actuates: false }],
      { sessionId: "cli", runId: "cli-run" },
    );
    await expect(runner.run(request)).rejects.toMatchObject({ code: "BUSY" });
    await held.release();
    expect((await runner.run(request)).exitCode).toBe(0);
  });
});

reportSkip(
  !process.env.VERA_CIRCUITPYTHON_UV,
  "the real circup tests",
  "set VERA_CIRCUITPYTHON_UV to a uv executable",
);

// Opt-in: the real circup 3.1.0 and pyserial 3.5 from PyPI (VERA_CIRCUITPYTHON_UV = a real uv), installed by VERA's
// provisioner. The fixture bundle and simulated volume stay; only circup's conventions are real. With
// VERA_CIRCUITPYTHON_BUNDLE_TAG the real Adafruit bundle of that tag is downloaded from github.com as well.
describe.skipIf(!process.env.VERA_CIRCUITPYTHON_UV)("real circup (opt-in)", { timeout: 900_000 }, () => {
  it("installs the pinned packages through VERA's provisioner and prepares, inspects and deploys", async () => {
    const data = join(root, "data");
    const store = new core.PluginStore({ root: join(data, "plugins") });
    await store.install(pluginFolder);
    const host = new core.NodeProcessHost(spawn);
    // VERA_CIRCUITPYTHON_PYTHON_SEED: a uv python folder whose cpython-3.13.* install is copied in, so only PyPI is reached.
    const seed = process.env.VERA_CIRCUITPYTHON_PYTHON_SEED;
    if (seed)
      for (const name of readdirSync(seed))
        if (/^cpython-3\.13\.\d+-/.test(name))
          await cp(join(seed, name), join(data, "plugins", "runtime", "python", name), { recursive: true });
    const provisioner = new core.Provisioner({
      store,
      root: join(data, "plugins", "runtime"),
      uv: { executable: process.env.VERA_CIRCUITPYTHON_UV as string, prefix: [] },
      host,
      clock: { sleep },
      platform: core.pluginPlatform(process.platform, process.arch),
      fetch: (url, init) => fetch(url, init.signal ? { signal: init.signal } : {}),
      settings: () => undefined,
    });
    const statuses = await provisioner.install("circuitpython");
    expect(statuses[0]?.state).toBe("ready");
    const plugin = await store.load("circuitpython");
    const resolved = await provisioner.resolve(plugin, "circuitpython-tool");
    if (!resolved) throw Error("circuitpython-tool did not resolve");
    const runner = new core.ProgramRunner({ host, clock: { sleep } });
    const tag = process.env.VERA_CIRCUITPYTHON_BUNDLE_TAG;
    const env: Record<string, string> = {
      ...resolved.env,
      PYTHONPATH: fakeSerial,
      VERA_CIRCUITPYTHON_FAKE_BENCH: paths().bench,
      FAKE_CPY_BENCH: paths().bench,
      FAKE_CPY_LOG: paths().log,
      VERA_CIRCUITPYTHON_HOME: paths().home,
      ...(tag ? {} : { VERA_CIRCUITPYTHON_DOWNLOAD_BASE: base }),
    };
    const run = async (args: string[]) => {
      const result = await runner.run({
        sessionId: "s1",
        workbench: root,
        executable: resolved.executable,
        env,
        args: [...(resolved.prefix ?? []), ...args],
      });
      return JSON.parse(result.output.slice(result.output.indexOf("{"))) as Json;
    };
    const set = await run([
      "prepare-libraries",
      "--library",
      "adafruit_bme280",
      "--circuitpython",
      "9",
      "--bundle-tag",
      tag ?? TAG,
      "--run-id",
      "real",
    ]);
    expect(set).toMatchObject({ status: "pass", platform: "9.x-mpy" });
    const names = set.libraries.map((library: Json) => library.name);
    expect(names).toEqual(
      expect.arrayContaining(["adafruit_bme280", "adafruit_bus_device", "adafruit_register"]),
    );
    expect(set.libraries[0].version).toMatch(/^\d+\.\d+\.\d+$/);
    const deployed = await run(vol("deploy", "--libraries", set.librarySet));
    expect(deployed).toMatchObject({ status: "pass", application: "updated" });
    const inspected = await run(vol("inspect-libraries"));
    expect(inspected.modules.every((module: Json) => module.abi === "compatible")).toBe(true);
    expect(inspected.modules.find((module: Json) => module.name === "adafruit_bme280").version).toBe(
      set.libraries[0].version,
    );
  });
});

reportSkip(
  !process.env.VERA_TEST_CIRCUITPY_VOLUME || !process.env.VERA_TEST_CIRCUITPY_IDENTITY,
  "the real CircuitPython board test",
  "set VERA_TEST_CIRCUITPY_VOLUME and VERA_TEST_CIRCUITPY_IDENTITY",
);

// Hardware: a real CircuitPython board named by VERA_TEST_CIRCUITPY_VOLUME and VERA_TEST_CIRCUITPY_IDENTITY, with
// circup and pyserial importable by the Python in VERA_TEST_PYTHON. Writes only /vera-test.py on that drive.
describe.skipIf(!process.env.VERA_TEST_CIRCUITPY_VOLUME || !process.env.VERA_TEST_CIRCUITPY_IDENTITY)(
  "real CircuitPython board (hardware)",
  { timeout: 300_000 },
  () => {
    it("identifies the board, inspects it and deploys one file with a confirmed hash", async () => {
      const real = (operation: string, ...rest: string[]) => {
        const result = spawnSync(
          python,
          [
            script,
            operation,
            "--volume",
            process.env.VERA_TEST_CIRCUITPY_VOLUME as string,
            "--identity",
            process.env.VERA_TEST_CIRCUITPY_IDENTITY as string,
            ...rest,
          ],
          { cwd: root, encoding: "utf8", timeout: 120_000 },
        );
        return JSON.parse(result.stdout) as Json;
      };
      expect(real("identify")).toMatchObject({ status: "pass", firmware: { major: expect.any(Number) } });
      expect(real("inspect-libraries").status).toBe("pass");
      await writeFile(join(root, "vera-test.py"), "print('vera hardware test')\n");
      const deployed = real("deploy", "--source", "vera-test.py", "--target", "/vera-test.py");
      expect(deployed).toMatchObject({
        status: "pass",
        files: [{ state: "confirmed", sha256: sha256("print('vera hardware test')\n") }],
      });
    });
  },
);
