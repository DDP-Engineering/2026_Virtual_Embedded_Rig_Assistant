// The raspberry-pi-linux plugin without a Raspberry Pi. Default tests check the package, the risk rules and pi-tool's
// offline refusals. The SSH block starts a local asyncssh 2.24.1 test server (tests/support/pi-test-sshd.py) and test
// agent (pi-test-agent.py) with generated keys on 127.0.0.1; the server runs each exec request as `sh -c` in a real
// Linux shell - this host on Linux, the default WSL distribution on Windows - so the remote helper meets a real
// kernel, /proc and systemd user manager. That is SSH-protocol and Linux evidence, never proof of a Raspberry Pi.
// No test connects to any other host, and none reads the developer's own ~/.ssh: PI_SSH_DIR names a folder of the
// test. VERA_TEST_PI_REMOTE=none skips the SSH block.
// REQ-DATA-44547a17 REQ-SEC-da232972 REQ-FUNC-9ea5add1 REQ-SEC-0513894a REQ-SEC-6b76749c REQ-FUNC-ac086c52
// REQ-SEC-255ef057 REQ-FUNC-38952891 REQ-SEC-c2cd454d REQ-FUNC-379be3d8 REQ-SEC-90a99d8d REQ-FUNC-d7e0c14e
// REQ-SEC-9e1f9401 REQ-FUNC-cf78987c REQ-REL-4569ba1a REQ-REL-0b7928f1 REQ-REL-8352b260 REQ-REL-d58d8abe
// REQ-FUNC-53db2460 REQ-FUNC-12ea8292 REQ-FUNC-ea84ae6e REQ-SEC-69c28e7f REQ-TEST-031f6831 REQ-DATA-6c8b61c9
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { reportSkip } from "../support/skip-marker.js";

const software = fileURLToPath(new URL("../../", import.meta.url));
const pluginFolder = join(software, "plugins", "raspberry-pi-linux");
const scripts = join(pluginFolder, "scripts");
const script = join(scripts, "pi_tool.py");
const support = join(software, "tests", "support");
const fixture = join(software, "tests", "fixtures", "raspberry-pi-linux", "project");
const windows = process.platform === "win32";
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
// biome-ignore lint/suspicious/noExplicitAny: printed JSON documents, checked field by field.
type Json = Record<string, any>;

/** The toolchain's Python with the pinned asyncssh; pi-tool, the test server and the test agent run on it. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(
    name,
    [
      "-c",
      "import sys, asyncssh; assert asyncssh.__version__ == '2.24.1', asyncssh.__version__; print(sys.executable)",
    ],
    { encoding: "utf8" },
  );
  if (found.status !== 0)
    throw new Error(`These tests need Python 3.11+ with asyncssh 2.24.1 as ${name}: ${found.stderr}`);
  return found.stdout.trim();
})();

/** The Linux shell the test server runs exec requests in, or undefined (the SSH block is skipped). */
const linux = (() => {
  const wanted = process.env.VERA_TEST_PI_REMOTE;
  if (wanted === "none") return undefined;
  const probe = "id -un && id -u && test -x /usr/bin/python3 && cat /etc/machine-id";
  const result = windows
    ? spawnSync("wsl.exe", ["-e", "sh", "-c", probe], { encoding: "utf8", timeout: 90_000 })
    : spawnSync("sh", ["-c", probe], { encoding: "utf8" });
  const lines = (result.stdout ?? "").replaceAll("\r", "").trim().split("\n");
  if (result.status !== 0 || lines.length < 3) return undefined;
  return {
    kind: windows ? "wsl" : "local",
    user: lines[0] as string,
    uid: lines[1] as string,
    machineId: lines[2] as string,
  };
})();

/** Runs a command in the test server's Linux shell (what the "board" sees). */
function sh(command: string): { code: number | null; out: string } {
  const result = windows
    ? spawnSync("wsl.exe", ["-e", "sh", "-c", command], { encoding: "utf8", timeout: 60_000 })
    : spawnSync("sh", ["-c", command], { encoding: "utf8", timeout: 60_000 });
  return { code: result.status, out: (result.stdout ?? "").replaceAll("\r", "").trim() };
}

let root = "";
const registryPath = () => join(root, "lab", "resources.json");
let agentPath = "";
/** A path no SSH agent listens on. */
const noAgent = () => (windows ? "\\\\.\\pipe\\vera-pi-no-agent" : join(root, "no-agent.sock"));
const RESULTS = "raspberry-pi-results";

function environment(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined && !name.startsWith("VERA_") && name.toUpperCase() !== "SSH_AUTH_SOCK")
      env[name] = value;
  return {
    ...env,
    PI_REGISTRY: registryPath(),
    PYTHONUTF8: "1",
    // An empty folder by default: the agent is the only key source, and no known_hosts counts.
    PI_SSH_DIR: join(root, "ssh-none"),
    ...(agentPath ? { SSH_AUTH_SOCK: agentPath } : {}),
    ...extra,
  };
}
function pi(
  args: string[],
  extra: Record<string, string> = {},
): { code: number | null; json: Json; stderr: string } {
  const result = spawnSync(python, [script, ...args], {
    cwd: root,
    env: environment(extra),
    encoding: "utf8",
    timeout: 240_000,
  });
  let json: Json = {};
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`pi-tool printed no JSON (exit ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { code: result.status, json, stderr: result.stderr };
}
function piAsync(
  args: string[],
  extra: Record<string, string> = {},
): { child: ChildProcess; done: Promise<{ code: number | null; json: Json }> } {
  const child = spawn(python, [script, ...args], { cwd: root, env: environment(extra) });
  let stdout = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.resume();
  const done = new Promise<{ code: number | null; json: Json }>((resolve) =>
    child.on("close", (code) => resolve({ code, json: JSON.parse(stdout || "{}") })),
  );
  return { child, done };
}
async function writeRegistry(resources: Json[]) {
  await mkdir(join(root, "lab"), { recursive: true });
  await writeFile(registryPath(), JSON.stringify({ format: 1, resources }));
}
async function writeProject(change: (project: Json) => void = () => {}): Promise<string> {
  const folder = join(root, "project");
  if (!existsSync(folder)) {
    cpSync(fixture, folder, { recursive: true });
    // Git may check the fixture out without its executable bit; the script must deploy as 0755.
    if (!windows) chmodSync(join(folder, "run.sh"), 0o755);
  }
  const document = JSON.parse(readFileSync(join(fixture, "vera-pi.json"), "utf8"));
  change(document);
  await writeFile(join(folder, "vera-pi.json"), JSON.stringify(document, null, 2));
  return "project/vera-pi.json";
}
const BOARD = {
  alias: "pi",
  kind: "linux-board",
  host: "127.0.0.1",
  port: 1,
  user: "vera",
  hostKeys: [] as string[],
  identity: { machineId: "0".repeat(32) },
  root: "/home/vera/vera-projects",
};

describe("package", () => {
  it("publishes the official raspberry-pi-linux package with one pinned helper, a supervised board, skills, catalog and pack", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-pi-pkg-")));
    try {
      const m = manifest();
      expect(validatePluginManifest(m).issues).toEqual([]);
      expect(m).toMatchObject({
        id: "raspberry-pi-linux",
        version: "0.3.0",
        platforms: ["windows-x64", "linux-x64"],
      });
      const program = m.programs["pi-tool"];
      expect(program?.install).toEqual({ script: "scripts/pi_tool.py" });
      expect(program?.sshAgent).toBe(true);
      expect(program?.resources).toEqual({
        option: "--board",
        kinds: ["linux-board"],
        grace: 10,
        cleanup: ["stop-owned"],
        cleanupTimeout: 60,
      });
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest placeholder, compared literally.
      expect(program?.env).toEqual({ PI_REGISTRY: "${workbench}/lab/resources.json" });
      const source = readFileSync(script, "utf8");
      for (const pin of ['"asyncssh==2.24.1"', '"cryptography==49.0.0"', '"typing-extensions==4.16.0"'])
        expect(source).toContain(pin);
      const catalog = parse(readFileSync(join(software, "plugins", "catalog.yaml"), "utf8"));
      expect(catalog.official).toContain("raspberry-pi-linux");
      expect(catalog.metadata["raspberry-pi-linux"].keywords).toContain("Raspberry Pi");
      const packs = parse(readFileSync(join(software, "plugins", "packs.yaml"), "utf8"));
      const arduino = packs.find((pack: { id: string }) => pack.id === "arduino");
      expect(arduino.groups).toContainEqual({
        name: "Raspberry Pi Linux projects",
        plugins: ["raspberry-pi-linux"],
        default: false,
      });
      expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(pluginFolder);
      const installed = await store.load("raspberry-pi-linux");
      const skills = new core.SkillCatalog({
        root,
        disabled: () => [],
        plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
      });
      const names = (await skills.list())
        .filter((skill) => skill.plugin === "raspberry-pi-linux")
        .map((skill) => skill.name);
      expect(names.sort()).toEqual(["raspberry-pi-projects", "raspberry-pi-tasks"]);
      const projects = (await skills.read("plugin", "raspberry-pi-projects")).content;
      for (const text of [
        "host-key-changed",
        "trust-host-key",
        "--overwrite",
        "requirements",
        "conflict",
        "pi-tool exec",
        "pi-tool fetch",
      ])
        expect(projects).toContain(text);
      const tasks = (await skills.read("plugin", "raspberry-pi-tasks")).content;
      for (const text of [
        "lost-by-reboot",
        "connection-lost",
        "stop-owned",
        "keepRunning",
        "service-not-allowed",
      ])
        expect(tasks).toContain(text);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("rates each operation by its effect on the board", () => {
    const rules = manifest().rules;
    const risk = (args: string[]) => classifyCommand(rules, "pi-tool", args).risk;
    for (const args of [
      ["--version"],
      ["capabilities"],
      ["inspect-project", "--project", "p/vera-pi.json"],
      ["report", "--run", "x"],
    ])
      expect(risk(args), args.join(" ")).toBe("safe");
    for (const op of [
      "check-host-key",
      "identify",
      "compare",
      "task-status",
      "service-status",
      "collect-logs",
      "fetch",
    ])
      expect(risk([op, "--board", "pi"]), op).toBe("device-read");
    for (const op of [
      "trust-host-key",
      "install-helper",
      "deploy",
      "deploy-candidate",
      "apply-candidate",
      "run-task",
      "exec",
      "service-start",
      "service-stop",
      "stop-owned",
    ])
      expect(risk([op, "--board", "pi"]), op).toBe("device-write");
    expect(risk(["exec", "--board", "pi", "--command", "sudo reboot"])).toBe("device-write");
    expect(risk(["deploy", "--board", "pi", "--project", "p/vera-pi.json", "--overwrite", "app.py"])).toBe(
      "irreversible",
    );
    expect(risk(["apply-candidate", "--board", "pi", "--candidate", "c.json", "--overwrite", "app.py"])).toBe(
      "irreversible",
    );
    expect(risk(["apply-candidate", "--board", "pi", "--candidate", "c.json", "--overwrite=app.py"])).toBe(
      "irreversible",
    );
    expect(classifyCommand(rules, "pi-tool", ["run-task", "--board", "pi"]).timeout).toBe(3600);
  });

  it("carries workspace.py and lifecycle.py as byte-identical copies", async () => {
    for (const [name, other] of [
      ["workspace.py", join(software, "plugins", "ble-tools", "scripts", "ble_support", "workspace.py")],
      ["lifecycle.py", join(software, "plugins", "ble-tools", "scripts", "ble_support", "lifecycle.py")],
    ] as const)
      expect(await readFile(join(scripts, "pi_support", name)), name).toEqual(await readFile(other));
  });

  it("sends only two constant commands that carry the helper's version and hash and nothing else", () => {
    const run = spawnSync(
      python,
      [
        "-c",
        "import sys, json; sys.path.insert(0, sys.argv[1]); from pi_support import remote; print(json.dumps([*remote.commands(), remote.helper()[1]]))",
        scripts,
      ],
      { encoding: "utf8" },
    );
    const [install, call, digest] = JSON.parse(run.stdout) as string[];
    const helper = readFileSync(join(scripts, "remote", "vera_pi_remote.py"));
    expect(digest).toBe(createHash("sha256").update(helper).digest("hex"));
    for (const command of [install, call] as string[]) {
      expect(command.startsWith("/usr/bin/python3 -I -c '")).toBe(true);
      expect(command.endsWith("'")).toBe(true);
      expect(command.slice(24, -1)).not.toContain("'");
      expect(command).toContain(digest);
      expect(command).toContain("0.3.0");
    }
  });
});

describe("refusals before any connection", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "vera-pi-offline-")));
    await writeRegistry([BOARD]);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("describes its versions, matrix, limits and helper", () => {
    const run = pi(["capabilities"]);
    expect(run.code).toBe(0);
    expect(run.json.helper).toMatchObject({
      version: "0.3.0",
      path: "~/.local/share/vera-pi/0.3.0/vera_pi_remote.py",
    });
    expect(run.json.matrix.boards).toContain("Raspberry Pi OS 12");
    expect(run.json.operations).toEqual(expect.arrayContaining(["deploy", "exec", "fetch", "compare"]));
  });

  it("inspects the fixture project offline: files with hashes, tasks, services and classification", async () => {
    const project = await writeProject();
    const run = pi(["inspect-project", "--project", project]);
    expect(run.code).toBe(0);
    expect(run.json.files.map((file: Json) => file.path)).toEqual([
      "app.py",
      "config.json",
      "dir with space/a b.txt",
      "run.sh",
    ]);
    const app = run.json.files.find((file: Json) => file.path === "app.py");
    expect(app.sha256).toBe(
      createHash("sha256")
        .update(readFileSync(join(fixture, "app.py")))
        .digest("hex"),
    );
    expect(run.json.files.find((file: Json) => file.path === "run.sh").mode).toBe("0755");
    expect(app.mode).toBe("0644");
    expect(run.json.tasks.map((task: Json) => task.name)).toContain("selftest");
    expect(run.json.services).toEqual([
      {
        unit: "vera-fixture.service",
        file: null,
        keepRunning: true,
        actuates: false,
        note: "Prints a heartbeat.",
      },
    ]);
    expect(run.json.hardware).toEqual({ actuates: false, note: "The fixture drives no hardware." });
  });

  it.each([
    ["a path leaving the project", (p: Json) => p.files.push("../outside.txt"), "path"],
    ["an absolute path", (p: Json) => p.files.push("/etc/passwd"), "path"],
    ["VERA's state folder", (p: Json) => p.files.push(".vera-pi/x"), "path"],
    ["a backslash", (p: Json) => p.files.push("dir\\x"), "path"],
    ["requirements the project does not deploy", (p: Json) => (p.requirements = "missing.txt"), "manifest"],
    [
      "a unit file the project does not deploy",
      (p: Json) => (p.services["vera-fixture.service"].file = "missing.service"),
      "manifest",
    ],
    ["an unknown field", (p: Json) => (p.deleteRemote = true), "manifest"],
    ["a system-looking unit name", (p: Json) => (p.services["../sshd"] = {}), "manifest"],
  ])("refuses %s in vera-pi.json", async (_name, change, code) => {
    const project = await writeProject(change);
    const run = pi(["inspect-project", "--project", project]);
    expect(run.code).toBe(2);
    expect(run.json.errors[0].code).toBe(code);
  });

  it("takes any program, a default budget, patterns in exclude and a script saved with Windows line ends", async () => {
    await writeFile(join(root, "project", "win.sh"), "#!/bin/sh\r\necho from windows\r\n");
    const project = await writeProject((p) => {
      p.files.push("win.sh");
      p.exclude = ["*.txt"];
      p.tasks.scan = { argv: ["i2cdetect", "-y", "1"] };
      p.tasks.shell = { argv: ["sh", "-c", "id"], budgetS: 5 };
    });
    const run = pi(["inspect-project", "--project", project]);
    expect(run.code, JSON.stringify(run.json.errors)).toBe(0);
    expect(run.json.tasks.find((task: Json) => task.name === "scan")).toMatchObject({ budgetS: 600 });
    expect(run.json.files.map((file: Json) => file.path)).toEqual([
      "app.py",
      "config.json",
      "run.sh",
      "win.sh",
    ]);
    // The board receives the script with Unix line ends, or its #! line would name an interpreter "sh\r".
    const script = run.json.files.find((file: Json) => file.path === "win.sh");
    expect(script).toMatchObject({
      mode: "0755",
      size: 28,
      sha256: createHash("sha256").update("#!/bin/sh\necho from windows\n").digest("hex"),
    });
    expect(run.json.warnings.map((warning: Json) => warning.code)).toEqual(["line-ends"]);
    await rm(join(root, "project", "win.sh"));
    await writeProject();
  });

  it.skipIf(!windows)("names the spelling of a file whose letter case differs on disk", async () => {
    const project = await writeProject((p) => p.files.push("APP.py"));
    const run = pi(["inspect-project", "--project", project]);
    expect(run.json.errors[0]).toMatchObject({ code: "path" });
    expect(run.json.errors[0].message).toContain("'app.py' on disk");
    await writeProject();
  });

  it("refuses an unlisted service, an unknown task and undeclared arguments before connecting", async () => {
    const project = await writeProject();
    // The board's port 1 has no server: a refusal here proves nothing was contacted.
    const service = pi(["service-start", "--board", "pi", "--project", project, "--service", "sshd.service"]);
    expect(service.json.errors[0].code).toBe("service-not-allowed");
    const task = pi(["run-task", "--board", "pi", "--project", project, "--task", "nope"]);
    expect(task.json.errors[0].code).toBe("task-unknown");
    const args = pi(["run-task", "--board", "pi", "--project", project, "--task", "selftest", "--arg", "x"]);
    expect(args.json.errors[0].code).toBe("usage");
    const logs = pi([
      "collect-logs",
      "--board",
      "pi",
      "--project",
      project,
      "--lines",
      "5000",
      "--handle",
      "0123456789abcdef",
    ]);
    expect(logs.json.errors[0].code).toBe("usage");
    for (const run of [service, task, args, logs]) expect(run.code).toBe(2);
  });

  it("refuses an unknown operation or option with usage", () => {
    for (const args of [["frobnicate"], ["identify", "--board", "pi", "--password", "x"], ["identify"]]) {
      const run = pi(args);
      expect(run.code, args.join(" ")).toBe(2);
      expect(run.json.errors[0].code).toBe("usage");
    }
  });

  it("refuses registry entries for root, a relative root and an approved registry that changed", async () => {
    await writeRegistry([{ ...BOARD, user: "root" }]);
    expect(pi(["identify", "--board", "pi"]).json.errors[0].code).toBe("registry");
    await writeRegistry([{ ...BOARD, root: "vera-projects" }]);
    expect(pi(["identify", "--board", "pi"]).json.errors[0].code).toBe("registry");
    await writeRegistry([BOARD]);
    const changed = pi(["identify", "--board", "pi"], { VERA_REGISTRY_SHA256: "0".repeat(64) });
    expect(changed.json.errors[0].code).toBe("registry-changed");
    const other = pi(["identify", "--board", "psu"]);
    expect(other.json.errors[0].code).toBe("board-unknown");
  });
});

// --- over SSH ------------------------------------------------------------------------------------------------------

interface Server {
  child: ChildProcess;
  port: number;
  log: string;
}
function readyLine(child: ChildProcess): Promise<Json> {
  return new Promise((resolve, reject) => {
    let text = "";
    let errors = "";
    child.stderr?.on("data", (chunk) => {
      errors += chunk;
    });
    child.stdout?.on("data", (chunk) => {
      text += chunk;
      const line = text.split("\n")[0];
      if (text.includes("\n") && line) resolve(JSON.parse(line));
    });
    child.on("exit", (code) => reject(new Error(`exited ${code}: ${errors}`)));
  });
}
const events = (log: string): Json[] =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

reportSkip(
  !linux,
  "the SSH tests",
  "no Linux shell with /usr/bin/python3 (WSL on Windows), or VERA_TEST_PI_REMOTE=none",
);
describe.skipIf(!linux)("over SSH with the remote helper on a real Linux shell", { timeout: 240_000 }, () => {
  const remote = linux as NonNullable<typeof linux>;
  let keys = "";
  let fp: Record<string, string> = {};
  let home = "";
  let projects = "";
  let agent: ChildProcess | undefined;
  let main: Server | undefined;
  let twin: Server | undefined;
  let both: Server | undefined;
  let lingered = false;
  const unit = `vera-fixture-${randomBytes(4).toString("hex")}.service`;
  const owned = `vera-owned-${randomBytes(4).toString("hex")}.service`;
  /** The fixture manifest as the SSH tests use it. */
  const base = (p: Json) => {
    p.services = { [unit]: { keepRunning: true, actuates: false, note: "Prints a heartbeat." } };
  };
  /** A folder standing in for ~/.ssh that holds the authorized key as a file. */
  const withKeyFile = () => ({ SSH_AUTH_SOCK: noAgent(), PI_SSH_DIR: join(root, "ssh-key") });
  const warnings = (run: { json: Json }): string[] => run.json.warnings.map((warning: Json) => warning.code);
  const runtime = `/run/user/${remote.uid}`;
  let services = false;

  async function startServer(hostKey: string, port = 0, second?: string): Promise<Server> {
    const log = join(root, `sshd-${hostKey}.log`);
    const child = spawn(python, [
      join(support, "pi-test-sshd.py"),
      "--host-key",
      join(keys, hostKey),
      ...(second ? ["--host-key", join(keys, second)] : []),
      "--authorized",
      join(keys, "user.pub"),
      "--user",
      remote.user,
      "--home",
      home,
      "--remote",
      remote.kind,
      "--runtime-dir",
      runtime,
      "--port",
      String(port),
      "--log",
      log,
    ]);
    const ready = await readyLine(child);
    return { child, port: ready.port as number, log };
  }
  const entry = (fields: Json = {}): Json => ({
    alias: "pi",
    kind: "linux-board",
    host: "127.0.0.1",
    port: main?.port,
    user: remote.user,
    hostKeys: [fp.host],
    identity: { machineId: remote.machineId },
    root: projects,
    ...fields,
  });
  async function registry() {
    await writeRegistry([
      entry(),
      entry({ alias: "twin", port: twin?.port }),
      entry({ alias: "fresh", hostKeys: [] }),
      entry({
        alias: "wrong-id",
        identity: {
          machineId: `${remote.machineId.slice(0, -1)}${remote.machineId.endsWith("0") ? "1" : "0"}`,
        },
      }),
      entry({
        alias: "wrong-model",
        identity: { machineId: remote.machineId, model: "Raspberry Pi 5 Model B Rev 1.0" },
      }),
      entry({ alias: "stranger", user: "vera-nobody" }),
      entry({ alias: "no-root", root: `${home}/missing-root` }),
      entry({ alias: "open-root", root: `${home}/open-root` }),
      entry({ alias: "linked-root", root: `${home}/linked-root` }),
      entry({ alias: "other-key", agentKey: fp.other }),
      // What a user writes: a host and a user (the port only because the test server is not on 22).
      { alias: "mini", kind: "linux-board", host: "127.0.0.1", port: main?.port, user: remote.user },
      { alias: "mini-twin", kind: "linux-board", host: "127.0.0.1", port: twin?.port, user: remote.user },
      entry({ alias: "rsa-pin", port: both?.port, hostKeys: [fp["host-rsa"]] }),
      entry({ alias: "ed-pin", port: both?.port }),
    ]);
  }
  const execs = (server: Server | undefined) =>
    events(server?.log ?? "").filter((event) => event.event === "exec");
  const remoteFile = (path: string) => sh(`cat '${path}'`).out;
  const project = () => "project/vera-pi.json";
  /** The task folders on the board now; taskRunning waits for a running task in a folder not among them. */
  const handles = (): string[] =>
    sh(`ls ${projects}/.vera-pi/tasks 2>/dev/null`).out.split("\n").filter(Boolean);
  const taskRunning = async (before: string[]): Promise<Json> => {
    for (let i = 0; i < 200; i++) {
      const fresh = handles().filter((handle) => !before.includes(handle));
      const listed = fresh.length
        ? sh(fresh.map((handle) => `cat ${projects}/.vera-pi/tasks/${handle}/status.json; echo`).join("; "))
            .out
        : "";
      const running = listed
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Json)
        .find((status) => status.state === "running" && status.supervisor);
      if (running) return running;
      await sleep(250);
    }
    throw new Error("no task started");
  };
  const alive = (pid: number) => sh(`test -d /proc/${pid} && echo yes || echo no`).out === "yes";

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "vera-pi-ssh-")));
    keys = join(root, "keys");
    await mkdir(keys);
    fp = JSON.parse(
      spawnSync(python, [join(support, "pi-test-sshd.py"), "--keygen", keys], { encoding: "utf8" }).stdout,
    );
    home = sh("mktemp -d /tmp/vera-pi-test-XXXXXX").out;
    projects = `${home}/vera-projects`;
    sh(
      `chmod 755 '${home}' && mkdir -m 755 '${projects}' '${home}/open-root' && chmod 777 '${home}/open-root'`,
    );
    agentPath = windows
      ? `\\\\.\\pipe\\vera-pi-test-${process.pid}-${randomBytes(3).toString("hex")}`
      : join(root, "agent.sock");
    agent = spawn(python, [
      join(support, "pi-test-agent.py"),
      "--key",
      join(keys, "user"),
      "--path",
      agentPath,
      "--log",
      join(root, "agent.log"),
    ]);
    await readyLine(agent);
    main = await startServer("host");
    twin = await startServer("host2");
    // A board holds a key of each kind; the server lists its RSA key first.
    both = await startServer("host-rsa", 0, "host");
    await registry();
    await mkdir(join(root, "ssh-key"));
    await copyFile(join(keys, "user"), join(root, "ssh-key", "id_ed25519"));
    await copyFile(join(keys, "user.pub"), join(root, "ssh-key", "id_ed25519.pub"));
    await writeProject(base);
    lingered = sh(`test -e /var/lib/systemd/linger/${remote.user} && echo yes || echo no`).out === "yes";
    services = ["running", "degraded"].includes(sh("systemctl --user is-system-running").out);
    if (services) {
      sh(
        `mkdir -p ${runtime}/systemd/user && printf '[Unit]\\nDescription=VERA raspberry-pi-linux test unit\\n[Service]\\nExecStart=/usr/bin/python3 -u ${projects}/vera-fixture/app.py --serve\\n' > ${runtime}/systemd/user/${unit} && systemctl --user daemon-reload`,
      );
    }
  }, 180_000);

  afterAll(async () => {
    if (services)
      sh(
        `systemctl --user stop ${unit} ${owned}; systemctl --user disable ${owned}; rm -f ${runtime}/systemd/user/${unit} ~/.config/systemd/user/${owned}; systemctl --user daemon-reload`,
      );
    // A service declared keepRunning turns lingering on; the test leaves the account as it found it.
    if (!lingered)
      sh(`loginctl disable-linger 2>/dev/null || sudo -n loginctl disable-linger ${remote.user} 2>/dev/null`);
    for (const child of [main?.child, twin?.child, both?.child, agent]) child?.kill();
    if (home.startsWith("/tmp/vera-pi-test-")) sh(`rm -rf '${home}'`);
    agentPath = "";
    await rm(root, { recursive: true, force: true });
  });

  it("shows the presented host key without logging in", () => {
    const run = pi(["check-host-key", "--board", "pi"]);
    expect(run.code).toBe(0);
    expect(run.json.hostKey).toEqual({
      type: "ssh-ed25519",
      fingerprint: fp.host,
      trusted: true,
      trust: "pinned",
    });
    // A board not seen before is not an error: the first connection will save this key.
    const fresh = pi(["check-host-key", "--board", "fresh"]);
    expect(fresh.code).toBe(0);
    expect(fresh.json.hostKey).toMatchObject({ fingerprint: fp.host, trusted: false, trust: "first-use" });
    expect(warnings(fresh)).toEqual(["host-key-new"]);
    expect(existsSync(join(root, "lab", "linux-board-keys.json"))).toBe(false);
    expect(events(main?.log ?? "").filter((event) => event.event === "public-key")).toEqual([]);
  });

  it("refuses a changed host key before authenticating or sending anything", () => {
    const run = pi(["identify", "--board", "twin"]);
    expect(run.code).toBe(2);
    expect(run.json.errors[0].code).toBe("host-key-changed");
    expect(run.json.hostKey).toMatchObject({ fingerprint: fp.host2, trusted: false, trust: "pinned" });
    // Without any key too, the host-key conflict is what the user is told.
    expect(pi(["identify", "--board", "twin"], { SSH_AUTH_SOCK: noAgent() }).json.errors[0].code).toBe(
      "host-key-changed",
    );
    expect(events(twin?.log ?? "").filter((event) => event.event !== "begin-auth")).toEqual([]);
    expect(events(twin?.log ?? "").filter((event) => event.event === "exec")).toEqual([]);
  });

  it("logs in with an agent key or a key file of ~/.ssh and names what is missing", () => {
    const agentLog = join(root, "agent.log");
    const before = events(agentLog).filter((event) => event.request === "sign").length;
    // The first call finds no helper on the board and installs it by itself.
    const first = pi(["identify", "--board", "pi"]);
    expect(first.code, JSON.stringify(first.json.errors)).toBe(0);
    expect(warnings(first)).toEqual(["helper-installed"]);
    const signs = events(agentLog).filter((event) => event.request === "sign");
    expect(signs.length).toBe(before + 1);
    expect(signs.at(-1)?.fingerprint).toBe(fp.user);
    expect(pi(["identify", "--board", "other-key"]).json.errors[0].code).toBe("agent-key-missing");
    expect(pi(["identify", "--board", "other-key"], { SSH_AUTH_SOCK: noAgent() }).json.errors[0].code).toBe(
      "agent-unavailable",
    );
    // No agent and no key file: the message says how to make a key and authorize it.
    const none = pi(["identify", "--board", "pi"], { SSH_AUTH_SOCK: noAgent() });
    expect(none.json.errors[0].code).toBe("no-key");
    expect(none.json.errors[0].message).toContain("ssh-keygen -t ed25519");
    // No agent, the key as a file: what a Windows user with a stopped ssh-agent service has.
    expect(pi(["identify", "--board", "pi"], withKeyFile()).code).toBe(0);
    const refused = pi(["identify", "--board", "stranger"]);
    expect(refused.json.errors[0].code).toBe("auth-failed");
    expect(refused.json.errors[0].message).toContain("authorized_keys");
    const attempts = events(main?.log ?? "").filter((event) => event.event === "public-key");
    expect(attempts.every((event) => event.fingerprint === fp.user)).toBe(true);
  });

  it("learns the host key of a board declared by host and user, and refuses another one until told", async () => {
    const store = join(root, "lab", "linux-board-keys.json");
    const first = pi(["identify", "--board", "mini"], withKeyFile());
    expect(first.code, JSON.stringify(first.json.errors)).toBe(0);
    expect(warnings(first)).toEqual(["host-key-saved"]);
    expect(first.json.board).toMatchObject({ root: "~/vera-projects", hostKey: fp.host });
    expect(first.json.rootCheck).toEqual({ ok: true, path: projects });
    const address = `127.0.0.1:${main?.port}`;
    expect(JSON.parse(readFileSync(store, "utf8")).hosts[address].fingerprint).toBe(fp.host);
    expect(warnings(pi(["identify", "--board", "mini"]))).toEqual([]);
    // The saved key is another one (as after the board's system was installed again).
    const saved = JSON.parse(readFileSync(store, "utf8"));
    saved.hosts[address].fingerprint = fp.host2;
    await writeFile(store, JSON.stringify(saved));
    const changed = pi(["identify", "--board", "mini"]);
    expect(changed.json.errors[0].code).toBe("host-key-changed");
    expect(changed.json.errors[0].message).toContain("trust-host-key --board mini");
    expect(changed.json.hostKey).toMatchObject({ fingerprint: fp.host, trusted: false, trust: "saved" });
    const trusted = pi(["trust-host-key", "--board", "mini"]);
    expect(trusted.json.hostKey).toMatchObject({ fingerprint: fp.host, trusted: true });
    expect(pi(["identify", "--board", "mini"]).code).toBe(0);
    expect(pi(["trust-host-key", "--board", "pi"]).json.errors[0].code).toBe("host-key-pinned");
    // A line of ~/.ssh/known_hosts counts as ssh counts it.
    const known = join(root, "ssh-known");
    await mkdir(known);
    const line = (key: string) =>
      `[127.0.0.1]:${twin?.port} ${readFileSync(join(keys, `${key}.pub`), "utf8").trim()}\n`;
    await writeFile(join(known, "known_hosts"), line("host"));
    const other = pi(["identify", "--board", "mini-twin"], { PI_SSH_DIR: known });
    expect(other.json.errors[0].code).toBe("host-key-changed");
    expect(other.json.hostKey.trust).toBe("known_hosts");
    await writeFile(join(known, "known_hosts"), line("host2"));
    const same = pi(["identify", "--board", "mini-twin"], { PI_SSH_DIR: known });
    expect(same.code, JSON.stringify(same.json.errors)).toBe(0);
    expect(warnings(same)).toEqual([]);
    expect(JSON.parse(readFileSync(store, "utf8")).hosts[`127.0.0.1:${twin?.port}`]).toBeUndefined();
  });

  it("asks a board with several host keys for the Ed25519 one, and finds a pinned RSA key", () => {
    const ed = pi(["check-host-key", "--board", "ed-pin"]);
    expect(ed.json.hostKey).toMatchObject({ type: "ssh-ed25519", fingerprint: fp.host, trusted: true });
    expect(pi(["identify", "--board", "ed-pin"]).code).toBe(0);
    const rsa = pi(["identify", "--board", "rsa-pin"]);
    expect(rsa.code, JSON.stringify(rsa.json.errors)).toBe(0);
    expect(rsa.json.board.hostKey).toBe(fp["host-rsa"]);
  });

  it("runs only a helper with the bundled hash and replaces one that differs", () => {
    const digest = createHash("sha256")
      .update(readFileSync(join(scripts, "remote", "vera_pi_remote.py")))
      .digest("hex");
    const installed = `${home}/.local/share/vera-pi/0.3.0/vera_pi_remote.py`;
    expect(sh(`sha256sum '${installed}' | cut -d' ' -f1`).out).toBe(digest);
    expect(sh(`stat -c %a '${installed}'`).out).toBe("600");
    const explicit = pi(["install-helper", "--board", "pi"]);
    expect(explicit.json.helper).toMatchObject({ state: "already-installed", sha256: digest });
    sh(`printf '#' >> '${installed}'`);
    const changed = pi(["identify", "--board", "pi"]);
    expect(changed.code).toBe(0);
    expect(warnings(changed)).toEqual(["helper-installed"]);
    expect(sh(`sha256sum '${installed}' | cut -d' ' -f1`).out).toBe(digest);
  });

  it("identifies the board with its health and refuses another identity and an unsafe root", () => {
    const run = pi(["identify", "--board", "pi"]);
    expect(run.code).toBe(0);
    expect(run.json.runFolder).toBeUndefined();
    expect(run.json.health.memoryTotalMB).toBeGreaterThan(0);
    expect(run.json.health.diskFreeMB).toBeGreaterThan(0);
    expect(run.json.health).toMatchObject({ tasksRunning: 0 });
    expect(run.json.identity).toMatchObject({
      machineId: remote.machineId,
      user: remote.user,
      uid: Number(remote.uid),
      helper: "0.3.0",
    });
    expect(run.json.identity.machine).toMatch(/^(x86_64|aarch64)$/);
    expect(run.json.identity.os.ID).toBeTruthy();
    expect(run.json.rootCheck).toEqual({ ok: true, path: projects });
    expect(pi(["identify", "--board", "wrong-id"]).json.errors[0].code).toBe("identity-mismatch");
    expect(pi(["identify", "--board", "wrong-model"]).json.errors[0].code).toBe("identity-mismatch");
    // A projects folder that does not exist yet is created.
    expect(pi(["identify", "--board", "no-root"]).code).toBe(0);
    expect(sh(`stat -c %a '${home}/missing-root'`).out).toBe("755");
    expect(pi(["identify", "--board", "open-root"]).json.errors[0].code).toBe("root-invalid");
    sh(`ln -s '${projects}' '${home}/linked-root'`);
    const viaLink = pi(["deploy-candidate", "--board", "linked-root", "--project", project()]);
    expect(viaLink.json.errors[0].code).toBe("root-invalid");
    // A refusal of the helper comes before it acts: the board's state is reported unchanged, not unknown.
    expect(viaLink.json.lifecycle.physical).toBe("unchanged");
    expect(sh(`ls -A '${projects}'`).out).toBe("");
  });

  it("stages a candidate, applies it and leaves other files and projects alone", () => {
    sh(`mkdir -p '${projects}/other-project' && echo keep > '${projects}/other-project/keep.txt'`);
    const staged = pi(["deploy-candidate", "--board", "pi", "--project", project(), "--run-id", "deploy-1"]);
    expect(staged.code).toBe(0);
    expect(staged.json.candidate.counts).toEqual({ new: 4, changed: 0, unchanged: 0, conflict: 0 });
    expect(sh(`test -e '${projects}/vera-fixture' && echo yes || echo no`).out).toBe("no");
    const applied = pi([
      "apply-candidate",
      "--board",
      "pi",
      "--candidate",
      "raspberry-pi-results/deploy-1/candidate.json",
    ]);
    expect(applied.code).toBe(0);
    expect(applied.json.applied.applied).toEqual([
      "app.py",
      "config.json",
      "dir with space/a b.txt",
      "run.sh",
    ]);
    expect(remoteFile(`${projects}/vera-fixture/dir with space/a b.txt`)).toBe(
      "a file whose path holds spaces",
    );
    expect(sh(`stat -c %a '${projects}/vera-fixture/run.sh'`).out).toBe("755");
    expect(remoteFile(`${projects}/other-project/keep.txt`)).toBe("keep");
    expect(sh(`ls -A '${projects}/.vera-pi/candidates'`).out).toBe("");
  });

  it("finds changed, unchanged, conflicting and remote-only files and applies only what is safe", async () => {
    sh(
      `echo '{"edited": "on the board"}' > '${projects}/vera-fixture/config.json' && echo extra > '${projects}/vera-fixture/notes.txt'`,
    );
    await writeFile(
      join(root, "project", "app.py"),
      `${readFileSync(join(fixture, "app.py"), "utf8")}# v2\n`,
    );
    const staged = pi(["deploy-candidate", "--board", "pi", "--project", project(), "--run-id", "deploy-2"]);
    const actions = Object.fromEntries(
      staged.json.candidate.files.map((file: Json) => [file.path, file.action]),
    );
    expect(actions).toEqual({
      "app.py": "changed",
      "config.json": "conflict",
      "dir with space/a b.txt": "unchanged",
      "run.sh": "unchanged",
    });
    expect(staged.json.candidate.remoteOnly).toEqual(["notes.txt"]);
    expect(staged.json.warnings[0].code).toBe("conflict");
    const applied = pi([
      "apply-candidate",
      "--board",
      "pi",
      "--candidate",
      "raspberry-pi-results/deploy-2/candidate.json",
    ]);
    expect(applied.json.applied.applied).toEqual(["app.py"]);
    expect(remoteFile(`${projects}/vera-fixture/config.json`)).toContain("on the board");
    expect(remoteFile(`${projects}/vera-fixture/notes.txt`)).toBe("extra");
    expect(remoteFile(`${projects}/vera-fixture/app.py`)).toContain("# v2");
    const again = pi(["deploy-candidate", "--board", "pi", "--project", project(), "--run-id", "deploy-3"]);
    const notConflict = pi([
      "apply-candidate",
      "--board",
      "pi",
      "--candidate",
      "raspberry-pi-results/deploy-3/candidate.json",
      "--overwrite",
      "app.py",
    ]);
    expect(notConflict.json.errors[0].code).toBe("candidate-invalid");
    const overwrite = pi([
      "apply-candidate",
      "--board",
      "pi",
      "--candidate",
      "raspberry-pi-results/deploy-3/candidate.json",
      "--overwrite",
      "config.json",
    ]);
    expect(again.code).toBe(0);
    expect(overwrite.json.applied.applied).toEqual(["config.json"]);
    expect(remoteFile(`${projects}/vera-fixture/config.json`)).toBe('{ "greeting": "hello" }');
  });

  it("applies nothing when staged bytes or a target change after staging", async () => {
    await writeFile(
      join(root, "project", "app.py"),
      `${readFileSync(join(fixture, "app.py"), "utf8")}# v3\n`,
    );
    const staged = pi(["deploy-candidate", "--board", "pi", "--project", project(), "--run-id", "deploy-4"]);
    const id = staged.json.candidate.candidateId;
    sh(`printf x >> '${projects}/.vera-pi/candidates/${id}/files/app.py'`);
    const tampered = pi([
      "apply-candidate",
      "--board",
      "pi",
      "--candidate",
      "raspberry-pi-results/deploy-4/candidate.json",
    ]);
    expect(tampered.json.errors[0].code).toBe("candidate-changed");
    const restaged = pi([
      "deploy-candidate",
      "--board",
      "pi",
      "--project",
      project(),
      "--run-id",
      "deploy-5",
    ]);
    // Only the newest candidate of a project stays staged on the board.
    expect(restaged.json.candidate.pruned).toEqual([id]);
    expect(sh(`test -e '${projects}/.vera-pi/candidates/${id}' && echo yes || echo no`).out).toBe("no");
    sh(`echo 'edited meanwhile' >> '${projects}/vera-fixture/app.py'`);
    const raced = pi([
      "apply-candidate",
      "--board",
      "pi",
      "--candidate",
      "raspberry-pi-results/deploy-5/candidate.json",
    ]);
    expect(raced.json.errors[0].code).toBe("conflict");
    expect(remoteFile(`${projects}/vera-fixture/app.py`)).toContain("edited meanwhile");
    expect(remoteFile(`${projects}/vera-fixture/app.py`)).not.toContain("# v3");
    // Restore the fixture's app.py for the task tests.
    await writeFile(join(root, "project", "app.py"), readFileSync(join(fixture, "app.py")));
    pi(["deploy-candidate", "--board", "pi", "--project", project(), "--run-id", "deploy-6"]);
    expect(
      pi([
        "apply-candidate",
        "--board",
        "pi",
        "--candidate",
        "raspberry-pi-results/deploy-6/candidate.json",
        "--overwrite",
        "app.py",
      ]).code,
    ).toBe(0);
  });

  it("applies nothing when a parent folder on the board was replaced by a link", () => {
    const elsewhere = `${home}/elsewhere`;
    sh(
      `mkdir -p '${elsewhere}' && echo outside > '${elsewhere}/a b.txt' && mv '${projects}/vera-fixture/dir with space' '${home}/moved' && ln -s '${elsewhere}' '${projects}/vera-fixture/dir with space'`,
    );
    const staged = pi([
      "deploy-candidate",
      "--board",
      "pi",
      "--project",
      project(),
      "--run-id",
      "deploy-link",
    ]);
    const file = staged.json.candidate.files.find((item: Json) => item.path === "dir with space/a b.txt");
    expect(file.action).toBe("conflict");
    const forced = pi([
      "apply-candidate",
      "--board",
      "pi",
      "--candidate",
      "raspberry-pi-results/deploy-link/candidate.json",
      "--overwrite",
      "dir with space/a b.txt",
    ]);
    expect(forced.json.errors[0].code).toBe("conflict");
    expect(remoteFile(`${elsewhere}/a b.txt`)).toBe("outside");
    sh(
      `rm '${projects}/vera-fixture/dir with space' && mv '${home}/moved' '${projects}/vera-fixture/dir with space'`,
    );
  });

  it("deploys in one call: sends only what changed, repairs a mode, leaves board edits unless told", async () => {
    const same = pi(["compare", "--board", "pi", "--project", project()]);
    expect(same.json.deploy.counts).toEqual({ new: 0, changed: 0, unchanged: 4, conflict: 0 });
    expect(same.json.deploy.remoteOnly).toEqual(["notes.txt"]);
    await writeFile(
      join(root, "project", "app.py"),
      `${readFileSync(join(fixture, "app.py"), "utf8")}# v4\n`,
    );
    sh(`chmod 644 '${projects}/vera-fixture/run.sh' && echo board >> '${projects}/vera-fixture/config.json'`);
    const seen = pi(["compare", "--board", "pi", "--project", project()]);
    expect(seen.json.deploy.counts).toEqual({ new: 0, changed: 1, unchanged: 2, conflict: 1 });
    expect(remoteFile(`${projects}/vera-fixture/app.py`)).not.toContain("# v4");
    const before = execs(main).length;
    const sent = pi(["deploy", "--board", "pi", "--project", project(), "--run-id", "deploy-one"]);
    expect(sent.code, JSON.stringify(sent.json.errors)).toBe(0);
    expect(sent.json.deploy).toMatchObject({
      applied: ["app.py"],
      modeFixed: ["run.sh"],
      conflicts: ["config.json"],
    });
    expect(warnings(sent)).toEqual(["conflict"]);
    // Two calls of the board's helper: compare, then send and apply.
    expect(execs(main).length).toBe(before + 2);
    expect(remoteFile(`${projects}/vera-fixture/app.py`)).toContain("# v4");
    expect(sh(`stat -c %a '${projects}/vera-fixture/run.sh'`).out).toBe("755");
    expect(remoteFile(`${projects}/vera-fixture/config.json`)).toContain("board");
    expect(sh(`ls -A '${projects}/.vera-pi/candidates'`).out).toBe("");
    // fetch brings the board's copy here before it is replaced.
    const fetched = pi([
      "fetch",
      "--board",
      "pi",
      "--project",
      project(),
      "--path",
      "config.json",
      "--run-id",
      "fetch-1",
    ]);
    expect(fetched.json.file).toMatchObject({
      remote: `${projects}/vera-fixture/config.json`,
      path: `${RESULTS}/fetch-1/config.json`,
    });
    expect(fetched.json.file.preview).toContain("board");
    expect(readFileSync(join(root, RESULTS, "fetch-1", "config.json"), "utf8")).toContain("board");
    expect(pi(["fetch", "--board", "pi", "--path", "/no/such/file"]).json.errors[0].code).toBe("path");
    const wrong = pi(["deploy", "--board", "pi", "--project", project(), "--overwrite", "app.py"]);
    expect(wrong.json.errors[0].code).toBe("usage");
    const forced = pi(["deploy", "--board", "pi", "--project", project(), "--overwrite", "config.json"]);
    expect(forced.json.deploy).toMatchObject({ applied: ["config.json"], conflicts: [] });
    expect(remoteFile(`${projects}/vera-fixture/config.json`)).toBe('{ "greeting": "hello" }');
    await writeFile(join(root, "project", "app.py"), readFileSync(join(fixture, "app.py")));
  });

  it("runs an edited project in one call and passes the task's output on while it runs", async () => {
    await writeFile(
      join(root, "project", "app.py"),
      `${readFileSync(join(fixture, "app.py"), "utf8")}print("edited here")\n`,
    );
    const run = pi(["run-task", "--board", "pi", "--project", project(), "--task", "selftest"]);
    expect(run.code, JSON.stringify(run.json.errors)).toBe(0);
    expect(run.json.deploy.applied).toEqual(["app.py"]);
    expect(run.json.task.stdout.text).toBe("fixture app 1.0.0\nselftest ok\nedited here\n");
    // stdout carries the one result document; the task's own output went to stderr as it came.
    expect(run.stderr).toContain("selftest ok\nedited here\n");
    await writeFile(join(root, "project", "app.py"), readFileSync(join(fixture, "app.py")));
    expect(pi(["deploy", "--board", "pi", "--project", project()]).json.deploy.applied).toEqual(["app.py"]);
  });

  it("runs a command line in a shell on the board, in the home folder or in the project", () => {
    const run = pi([
      "exec",
      "--board",
      "pi",
      "--command",
      "echo one; echo two >&2; pwd | wc -l",
      "--run-id",
      "exec-1",
    ]);
    expect(run.code, JSON.stringify(run.json.errors)).toBe(0);
    expect(run.json.task).toMatchObject({ name: "exec", state: "exited", exitCode: 0 });
    expect(run.json.task.stdout.text).toBe("one\n1\n");
    expect(run.json.task.stderr.text).toBe("two\n");
    expect(readFileSync(join(root, RESULTS, "exec-1", "stdout.log"), "utf8")).toBe("one\n1\n");
    const inProject = pi(["exec", "--board", "pi", "--project", project(), "--command", "pwd; exit 4"]);
    expect(inProject.code).toBe(1);
    expect(inProject.json.task).toMatchObject({ exitCode: 4 });
    expect(inProject.json.task.stdout.text).toBe(`${projects}/vera-fixture\n`);
    const slow = pi(["exec", "--board", "pi", "--command", "echo started; sleep 30", "--budget", "2"]);
    expect(slow.json.task.state).toBe("budget-exceeded");
    expect(slow.json.task.stdout.text).toBe("started\n");
    expect(alive(slow.json.task.pid)).toBe(false);
    const missing = pi([
      "run-task",
      "--board",
      "pi",
      "--project",
      project(),
      "--task",
      "selftest",
      "--arg",
      "x",
    ]);
    expect(missing.json.errors[0].code).toBe("usage");
  });

  it("builds the project's virtual environment from its requirements and runs tasks with it", async (ctx) => {
    if (sh("python3 -c 'import ensurepip, venv'").code !== 0) ctx.skip("the Linux shell has no python3-venv");
    await writeFile(join(root, "project", "requirements.txt"), "");
    await writeProject((p) => {
      base(p);
      p.files.push("requirements.txt");
      p.requirements = "requirements.txt";
      p.tasks.prefix = { argv: ["python3", "-c", "import sys; print(sys.prefix)"] };
    });
    const first = pi([
      "run-task",
      "--board",
      "pi",
      "--project",
      project(),
      "--task",
      "prefix",
      "--run-id",
      "venv-1",
    ]);
    expect(first.code, JSON.stringify(first.json.errors)).toBe(0);
    expect(first.json.setup).toMatchObject({ name: "setup", state: "exited", exitCode: 0 });
    expect(first.json.task.stdout.text).toBe(`${projects}/vera-fixture/.venv\n`);
    expect(existsSync(join(root, RESULTS, "venv-1", "setup-stdout.log"))).toBe(true);
    // Unchanged requirements are not installed again, and the environment is not a project file.
    const again = pi(["run-task", "--board", "pi", "--project", project(), "--task", "prefix"]);
    expect(again.json.setup).toBeUndefined();
    expect(again.json.deploy.remoteOnly).toEqual(["notes.txt"]);
    await writeFile(join(root, "project", "requirements.txt"), "this-package-does-not-exist-vera==0\n");
    const failed = pi(["run-task", "--board", "pi", "--project", project(), "--task", "prefix"]);
    expect(failed.code).toBe(1);
    expect(failed.json.errors[0].code).toBe("setup-failed");
    expect(failed.json.task).toBeUndefined();
    sh(`rm -rf '${projects}/vera-fixture/.venv' '${projects}/vera-fixture/requirements.txt'`);
    await rm(join(root, "project", "requirements.txt"));
    await writeProject(base);
  }, 240_000);

  it("runs a declared task with a handle, PID and logs, and passes arguments literally", () => {
    const run = pi([
      "run-task",
      "--board",
      "pi",
      "--project",
      project(),
      "--task",
      "selftest",
      "--run-id",
      "task-1",
    ]);
    expect(run.code).toBe(0);
    expect(run.json.task).toMatchObject({ name: "selftest", state: "exited", exitCode: 0 });
    expect(run.json.task.handle).toMatch(/^[0-9a-f]{16}$/);
    expect(run.json.task.pid).toBeGreaterThan(1);
    expect(readFileSync(join(root, "raspberry-pi-results", "task-1", "stdout.log"), "utf8")).toContain(
      "selftest ok",
    );
    const echo = pi([
      "run-task",
      "--board",
      "pi",
      "--project",
      project(),
      "--task",
      "echo",
      "--arg",
      "x y",
      "--arg",
      "$(id)",
    ]);
    expect(echo.code).toBe(0);
    expect(JSON.parse(echo.json.task.stdout.text.split("\n")[1])).toEqual([
      "two words",
      "; touch pwned-by-argument",
      "x y",
      "$(id)",
    ]);
    expect(sh(`find '${home}' -name 'pwned*' | wc -l`).out).toBe("0");
    const script = pi(["run-task", "--board", "pi", "--project", project(), "--task", "script"]);
    expect(script.json.task.stdout.text).toBe("script ok 1\n");
    // Nothing changed here, so nothing was sent.
    expect(script.json.deploy).toMatchObject({ applied: [], conflicts: [] });
    const commands = new Set(execs(main).map((event) => event.command));
    expect(commands.size).toBe(2);
    for (const command of commands) expect(command).toMatch(/^\/usr\/bin\/python3 -I -c '/);
  });

  it("ends failing, over-budget and over-limit tasks on the board", () => {
    const fail = pi(["run-task", "--board", "pi", "--project", project(), "--task", "fail"]);
    expect(fail.code).toBe(1);
    expect(fail.json.task).toMatchObject({ state: "exited", exitCode: 3 });
    expect(fail.json.task.stderr.text).toContain("failing on purpose");
    const budget = pi(["run-task", "--board", "pi", "--project", project(), "--task", "over-budget"]);
    expect(budget.code).toBe(1);
    expect(budget.json.task.state).toBe("budget-exceeded");
    // What the task wrote before it was ended is kept.
    expect(budget.json.task.stdout.text).toContain("tick");
    expect(budget.json.task.durationS).toBeLessThan(6);
    expect(alive(budget.json.task.pid)).toBe(false);
    const spam = pi(["run-task", "--board", "pi", "--project", project(), "--task", "spam"]);
    expect(spam.json.task.state).toBe("output-limit");
    expect(spam.json.task.stdout.bytes).toBeLessThanOrEqual(4096);
    expect(alive(spam.json.task.pid)).toBe(false);
  });

  it("stops the owned task on VERA's stop request and confirms no process of it runs", async () => {
    const control = join(root, "control-1");
    await mkdir(control);
    const before = handles();
    const started = piAsync(["run-task", "--board", "pi", "--project", project(), "--task", "long"], {
      VERA_RUN_CONTROL: control,
    });
    const status = await taskRunning(before);
    await writeFile(join(control, "stop"), "stopped");
    const run = await started.done;
    expect(run.code).toBe(3);
    expect(run.json.errors[0].code).toBe("stopped");
    expect(run.json.remote.state).toBe("confirmed");
    expect(run.json.lifecycle.physical).toBe("confirmed");
    expect(JSON.parse(readFileSync(join(control, "state.json"), "utf8"))).toMatchObject({
      phase: "released",
      physical: "confirmed",
    });
    expect(alive(status.pid)).toBe(false);
  });

  it("reports a lost connection as unknown, then finds and stops the task on a new connection", async () => {
    const before = handles();
    const started = piAsync(["run-task", "--board", "pi", "--project", project(), "--task", "long"]);
    const status = await taskRunning(before);
    main?.child.kill();
    const run = await started.done;
    expect(run.code).toBe(3);
    expect(run.json.errors[0].code).toBe("connection-lost");
    expect(run.json.remote.state).toBe("unknown");
    expect(run.json.lifecycle.physical).toBe("unknown");
    expect(alive(status.pid)).toBe(true);
    main = await startServer("host", main?.port);
    const handle = run.json.task.handle;
    const seen = pi(["task-status", "--board", "pi", "--handle", handle]);
    expect(seen.json.task).toMatchObject({ state: "running", pid: status.pid });
    const stopped = pi(["stop-owned", "--board", "pi"]);
    expect(stopped.code).toBe(0);
    expect(stopped.json.tasks).toEqual([
      expect.objectContaining({ handle, confirmed: true, state: "stopped" }),
    ]);
    expect(alive(status.pid)).toBe(false);
    expect(pi(["task-status", "--board", "pi", "--handle", handle]).json.task.state).toBe("stopped");
  });

  it("reports a task of an earlier boot as lost by reboot and signals nothing", async () => {
    const before = handles();
    const started = piAsync(["run-task", "--board", "pi", "--project", project(), "--task", "long"]);
    const status = await taskRunning(before);
    const file = sh(`grep -l '"pid": ${status.pid}' ${projects}/.vera-pi/tasks/*/status.json`).out;
    sh(`sed -i 's/"bootId": "[^"]*"/"bootId": "00000000-0000-0000-0000-000000000000"/' '${file}'`);
    const run = await started.done;
    expect(run.json.errors[0].code).toBe("lost-by-reboot");
    expect(run.code).toBe(3);
    const handle = file.split("/").at(-2) as string;
    expect(pi(["task-status", "--board", "pi", "--handle", handle]).json.task.state).toBe("lost-by-reboot");
    const owned = pi(["stop-owned", "--board", "pi"]);
    expect(owned.json.tasks).toEqual([]);
    expect(alive(status.pid)).toBe(true);
    sh(`/bin/kill -TERM -- -${status.pid}`);
    for (let i = 0; i < 40 && alive(status.pid); i++) await sleep(100);
    expect(alive(status.pid)).toBe(false);
  });

  it("finds the task's group members after its supervisor and leader are gone and stops them", async () => {
    const install = pi(["install-helper", "--board", "pi"]);
    expect(install.code, JSON.stringify(install.json.errors)).toBe(0);
    if (sh(`test -f '${projects}/vera-fixture/app.py'`).code !== 0) {
      const staged = pi([
        "deploy-candidate",
        "--board",
        "pi",
        "--project",
        project(),
        "--run-id",
        "deploy-family",
      ]);
      expect(staged.code, JSON.stringify(staged.json.errors)).toBe(0);
      const applied = pi([
        "apply-candidate",
        "--board",
        "pi",
        "--candidate",
        "raspberry-pi-results/deploy-family/candidate.json",
      ]);
      expect(applied.code, JSON.stringify(applied.json.errors)).toBe(0);
    }
    const before = handles();
    const started = piAsync(["run-task", "--board", "pi", "--project", project(), "--task", "family"]);
    const status = await taskRunning(before);
    const liveMembers = () =>
      sh(
        `ps -eo pgid=,stat= | awk -v group=${status.pgid} '$1 == group && $2 !~ /^Z/ { n++ } END { print n+0 }'`,
      ).out;
    await expect.poll(liveMembers, { timeout: 10_000 }).toBe("2");
    const handle = sh(`grep -l '"pid": ${status.pid},' ${projects}/.vera-pi/tasks/*/status.json`)
      .out.split("/")
      .at(-2);
    expect(sh(`kill -KILL ${status.supervisor.pid} ${status.pid}`).code).toBe(0);
    // pi-tool sees the supervisor gone while a member still runs, and ends the owned group itself.
    const run = await started.done;
    expect(run.code).toBe(3);
    expect(run.json.errors[0].code).toBe("supervisor-lost");
    expect(run.json.remote.state).toBe("confirmed");
    expect(liveMembers()).toBe("0");
    expect(pi(["task-status", "--board", "pi", "--handle", handle as string]).json.task.state).toBe(
      "stopped",
    );
    expect(pi(["stop-owned", "--board", "pi"]).json.tasks).toEqual([]);
  });

  it("never signals a recorded PID whose start time no longer matches", async () => {
    const before = handles();
    const started = piAsync(["run-task", "--board", "pi", "--project", project(), "--task", "quiet"]);
    const status = await taskRunning(before);
    const file = sh(`grep -l '"pid": ${status.pid},' ${projects}/.vera-pi/tasks/*/status.json`).out;
    const handle = file.split("/").at(-2) as string;
    // The supervisor is gone and the record names another start time: the PID may belong to another process now.
    sh(`kill -KILL ${status.supervisor.pid}`);
    sh(`sed -i 's/"startTicks": ${status.startTicks},/"startTicks": ${status.startTicks + 1},/' '${file}'`);
    const run = await started.done;
    expect(run.json.errors[0].code).toBe("supervisor-lost");
    expect(pi(["task-status", "--board", "pi", "--handle", handle]).json.task.state).toBe("supervisor-lost");
    expect(pi(["stop-owned", "--board", "pi"]).json.tasks).toEqual([]);
    expect(alive(status.pid)).toBe(true);
    sh(`/bin/kill -TERM -- -${status.pid}`);
    for (let i = 0; i < 40 && alive(status.pid); i++) await sleep(100);
    expect(alive(status.pid)).toBe(false);
  });

  it("starts, reads and stops only a listed user service and collects its journal", async (ctx) => {
    if (!services) ctx.skip("the Linux shell has no running systemd user manager");
    const start = pi(["service-start", "--board", "pi", "--project", project(), "--service", unit]);
    expect(start.code, JSON.stringify(start.json.errors)).toBe(0);
    expect(start.json.service).toMatchObject({ unit, activeState: "active", keepRunning: true });
    expect(start.json.service.mainPid).toBeGreaterThan(1);
    // A service declared keepRunning outlives VERA's SSH session only with lingering, which VERA turns on where
    // the board lets it.
    const linger = start.json.service.linger;
    expect(typeof linger).toBe("boolean");
    expect(start.json.warnings.map((w: Json) => w.code)).toContain(linger ? "keeps-running" : "no-linger");
    await sleep(2500);
    const status = pi(["service-status", "--board", "pi", "--project", project(), "--service", unit]);
    expect(status.json.service.activeState).toBe("active");
    const logs = pi([
      "collect-logs",
      "--board",
      "pi",
      "--project",
      project(),
      "--service",
      unit,
      "--lines",
      "20",
      "--run-id",
      "logs-1",
    ]);
    expect(logs.code).toBe(0);
    expect(logs.json.logs[0]).toMatchObject({ kind: "service", unit });
    expect(logs.json.logs[0].entries).toBeGreaterThan(0);
    const journal = readFileSync(
      join(root, "raspberry-pi-results", "logs-1", `journal-${unit}.jsonl`),
      "utf8",
    );
    expect(journal).toContain("heartbeat");
    const stop = pi(["service-stop", "--board", "pi", "--project", project(), "--service", unit]);
    expect(stop.code).toBe(0);
    expect(stop.json.service.activeState).toMatch(/^(inactive|failed)$/);
    const before = execs(main).length;
    expect(
      pi(["service-status", "--board", "pi", "--project", project(), "--service", "ssh.service"]).json
        .errors[0].code,
    ).toBe("service-not-allowed");
    expect(execs(main).length).toBe(before);
  });

  it("installs the unit file a project deploys, restarts the service on new code and stops it", async (ctx) => {
    if (!services) ctx.skip("the Linux shell has no running systemd user manager");
    const unitFile = (word: string) =>
      `[Unit]\nDescription=VERA raspberry-pi-linux owned test unit\n[Service]\nExecStart=/usr/bin/python3 -u -c "import time\\nwhile True:\\n    print('${word}', flush=True); time.sleep(1)"\n`;
    await writeFile(join(root, "project", owned), unitFile("first"));
    await writeProject((p) => {
      base(p);
      p.files.push(owned);
      p.services[owned] = { file: owned };
    });
    const start = pi(["service-start", "--board", "pi", "--project", project(), "--service", owned]);
    expect(start.code, JSON.stringify(start.json.errors)).toBe(0);
    expect(start.json.deploy.applied).toEqual([owned]);
    expect(start.json.service).toMatchObject({
      unit: owned,
      activeState: "active",
      installed: "installed",
      file: owned,
    });
    const pid = start.json.service.mainPid;
    await writeFile(join(root, "project", owned), unitFile("second"));
    const again = pi(["service-start", "--board", "pi", "--project", project(), "--service", owned]);
    expect(again.json.service).toMatchObject({ activeState: "active", installed: "updated" });
    expect(again.json.service.mainPid).not.toBe(pid);
    const stop = pi(["service-stop", "--board", "pi", "--project", project(), "--service", owned]);
    expect(stop.json.service.activeState).toMatch(/^(inactive|failed)$/);
    // A listed unit that nobody installed names what to add to the manifest.
    await writeProject((p) => {
      base(p);
      p.services["vera-not-installed.service"] = {};
    });
    const absent = pi([
      "service-start",
      "--board",
      "pi",
      "--project",
      project(),
      "--service",
      "vera-not-installed.service",
    ]);
    expect(absent.json.errors[0].code).toBe("service-failed");
    expect(absent.json.errors[0].message).toContain('"file"');
    await rm(join(root, "project", owned));
    await writeProject(base);
    sh(`rm -f '${projects}/vera-fixture/${owned}'`);
  });

  it("collects task logs and reports run folders", () => {
    const task = pi([
      "run-task",
      "--board",
      "pi",
      "--project",
      project(),
      "--task",
      "selftest",
      "--run-id",
      "task-2",
    ]);
    const logs = pi([
      "collect-logs",
      "--board",
      "pi",
      "--project",
      project(),
      "--handle",
      task.json.task.handle,
      "--run-id",
      "logs-2",
    ]);
    expect(logs.json.logs[0]).toMatchObject({ kind: "task", handle: task.json.task.handle });
    expect(
      readFileSync(
        join(root, "raspberry-pi-results", "logs-2", `task-${task.json.task.handle}-stdout.log`),
        "utf8",
      ),
    ).toContain("selftest ok");
    const reported = pi([
      "report",
      "--run",
      "raspberry-pi-results/deploy-1",
      "--run",
      "raspberry-pi-results/task-2",
      "--run-id",
      "report-1",
    ]);
    expect(reported.code).toBe(0);
    expect(reported.json.runs.map((item: Json) => item.operation)).toEqual(["deploy-candidate", "run-task"]);
    expect(reported.json.runs[1]).toMatchObject({
      board: "pi",
      project: "vera-fixture",
      handle: task.json.task.handle,
      remote: "confirmed",
    });
    for (const name of ["result.json", "report.md", "report.html"])
      expect(existsSync(join(root, "raspberry-pi-results", "report-1", name))).toBe(true);
    expect(pi(["report", "--run", "lab"]).json.errors[0].code).toBe("run-invalid");
  });

  describe("VERA's runner reserves and supervises the board", () => {
    const program = () => manifest().programs["pi-tool"] as NonNullable<PluginManifest["programs"][string]>;
    const runner = () =>
      new core.ProgramRunner({
        host: new core.NodeProcessHost(spawn),
        clock: { sleep },
        leases: new core.ResourceLeases({ root: join(root, "leases"), app: "test" }),
      });
    async function request(args: string[], actuates: boolean): Promise<core.RunRequest> {
      const claimed = await core.claimedResources(root, program(), args);
      if (!claimed) throw Error("no claim");
      const { SSH_AUTH_SOCK: _agent, ...env } = environment();
      return {
        sessionId: "s1",
        workbench: root,
        executable: python,
        args: [script, ...args],
        // APPDATA only so this test's Python finds its user site with asyncssh; VERA's own install uses uv.
        env: {
          PI_REGISTRY: env.PI_REGISTRY as string,
          PI_SSH_DIR: env.PI_SSH_DIR as string,
          ...(windows ? { APPDATA: process.env.APPDATA ?? "" } : {}),
        },
        inherit: ["SSH_AUTH_SOCK"],
        background: true,
        lease: {
          claims: claimed.resources.map((resource) => ({ ...resource, actuates })),
          graceMs: 10_000,
          cleanup: { args: [script, "stop-owned", "--board", "pi"], timeoutMs: 60_000 },
        },
      };
    }
    beforeAll(() => {
      process.env.SSH_AUTH_SOCK = agentPath;
    });
    afterAll(() => {
      delete process.env.SSH_AUTH_SOCK;
    });

    it("keys the board by host and port, gives the agent socket and makes a second run BUSY", async () => {
      const claimed = await core.claimedResources(root, program(), ["identify", "--board", "pi"]);
      expect(claimed?.resources[0]).toMatchObject({
        alias: "pi",
        kind: "linux-board",
        keys: [`ssh:127.0.0.1:${main?.port}`],
      });
      const first = runner();
      const run = await first.start(
        await request(["run-task", "--board", "pi", "--project", project(), "--task", "over-budget"], true),
      );
      await expect(runner().start(await request(["identify", "--board", "pi"], false))).rejects.toMatchObject(
        { code: "BUSY" },
      );
      const result = await run.done;
      expect(result.exitCode).toBe(1);
      expect(result).toMatchObject({ physical: "confirmed", cleanup: "none" });
    });

    it("ends with the board confirmed after Stop, and runs stop-owned after a lost connection", async () => {
      const before = handles();
      const stopped = await runner().start(
        await request(["run-task", "--board", "pi", "--project", project(), "--task", "long"], true),
      );
      const status = await taskRunning(before);
      const result = await stopped.stop();
      expect(result).toMatchObject({ stopped: true, physical: "confirmed", cleanup: "none" });
      expect(alive(status.pid)).toBe(false);
      const beforeLost = handles();
      const lost = await runner().start(
        await request(["run-task", "--board", "pi", "--project", project(), "--task", "long"], true),
      );
      const second = await taskRunning(beforeLost);
      const port = main?.port;
      main?.child.kill();
      await sleep(500);
      main = await startServer("host", port);
      const ended = await lost.done;
      // pi-tool ended connection-lost (physical unknown); the runner's cleanup reconnected and stopped the task.
      expect(ended.exitCode, ended.output).toBe(3);
      expect(ended).toMatchObject({ physical: "confirmed", cleanup: "separate" });
      expect(alive(second.pid)).toBe(false);
    });
  });
});
