// The kicad-layout plugin (spec .agentic/specs/REQ-DATA-891d5b5d.md). Default tests check the package, its catalog
// registration, the rules, the shared path module and the helper's refusals on the toolchain's Python, without KiCad.
// With a uv on PATH (or VERA_TEST_UV) the connection failures run on the helper's pinned API client. The PCB editor
// tests open real KiCad 10 windows (no clicks) and run only with VERA_TEST_KICAD_GUI set, KiCad's API enabled and no
// KiCad window holding the API; otherwise they are skipped with that reason.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest, versionInRange } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("kicad-layout/", plugins));
const tool = join(source, "scripts", "kicad_layout_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/kicad-layout/", import.meta.url));
const hooks = join(fixtures, "hooks");
const windows = process.platform === "win32";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("kicad-layout/plugin.yaml", plugins), "utf8"));

const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
const uv = (() => {
  const name = process.env.VERA_TEST_UV ?? "uv";
  return spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0 ? name : undefined;
})();
const kicadCli =
  process.env.VERA_TEST_KICAD_CLI ??
  (windows ? "C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe" : "/usr/bin/kicad-cli");
const apiEnabled = (() => {
  const config = windows
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "kicad", "10.0", "kicad_common.json")
    : join(homedir(), ".config", "kicad", "10.0", "kicad_common.json");
  try {
    return (
      JSON.parse(
        String(spawnSync(python, ["-c", `print(open(r'''${config}''',encoding='utf-8').read())`]).stdout),
      )?.api?.enable_server === true
    );
  } catch {
    return false;
  }
})();
/** Runs the second API client (fixtures/kicad-layout/hooks/nudge.py) through uv. */
const nudge = (...args: string[]) =>
  spawnSync(uv ?? "uv", ["run", "--quiet", "--script", join(hooks, "nudge.py"), ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
const apiAnswers = () => (uv ? nudge("answers").status === 0 : false);
const guiReason = !process.env.VERA_TEST_KICAD_GUI
  ? "set VERA_TEST_KICAD_GUI to open KiCad windows"
  : !uv
    ? "no uv for the helper's API client"
    : !existsSync(kicadCli)
      ? `no KiCad 10 kicad-cli at ${kicadCli}`
      : !apiEnabled
        ? "KiCad's API is off (Preferences > Plugins)"
        : apiAnswers()
          ? "another KiCad window holds the API"
          : "";
const gui = guiReason === "";

interface Problem {
  kind: string;
  where: string;
  message: string;
}
interface LayoutDocument {
  format: number;
  kind: string;
  operation: string;
  status: string;
  runId: string;
  problems: Problem[];
  // biome-ignore lint/suspicious/noExplicitAny: the report sections are checked field by field (spec §8).
  [key: string]: any;
}
const STDOUT_LIMIT = 11_000;
const baseEnv = (extra: NodeJS.ProcessEnv = {}) => ({
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  VERA_PROGRAM_KICAD_CLI: kicadCli,
  ...extra,
});
/** uv's own cache: the runner's environment has no LOCALAPPDATA, where uv would look for it by default. */
const uvCache = (() => {
  const found = uv ? spawnSync(uv, ["cache", "dir"], { encoding: "utf8" }) : undefined;
  return found?.status === 0 ? found.stdout.trim() : undefined;
})();
/** The environment VERA's program runner gives a plugin program (core programEnvironment), plus uv's cache. */
const veraEnv = (extra: Record<string, string> = {}) =>
  core.programEnvironment({ platform: process.platform, env: process.env } as never, [], {
    ...(uvCache ? { UV_CACHE_DIR: uvCache } : {}),
    PYTHONDONTWRITEBYTECODE: "1",
    VERA_PROGRAM_KICAD_CLI: kicadCli,
    ...extra,
  });
/** Running PCB editor processes (a refused open must not start one). */
const editorCount = () =>
  windows
    ? String(
        spawnSync("tasklist", ["/FI", "IMAGENAME eq pcbnew.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" })
          .stdout,
      )
        .split("\n")
        .filter((line) => line.toLowerCase().includes("pcbnew.exe")).length
    : String(spawnSync("pgrep", ["-x", "pcbnew"], { encoding: "utf8" }).stdout)
        .split("\n")
        .filter(Boolean).length;
const absolutePath = /[A-Za-z]:[\\/]|^\/(?:home|tmp|usr)\//m;
const settle = (result: ReturnType<typeof spawnSync>, label: string) => {
  const stdout = String(result.stdout);
  expect([0, 2, 3], `${label}: exit ${result.status}: ${String(result.stderr).slice(-1500)}`).toContain(
    result.status,
  );
  expect(stdout.length, label).toBeLessThanOrEqual(STDOUT_LIMIT);
  return {
    code: result.status,
    stdout,
    stderr: String(result.stderr),
    doc: JSON.parse(stdout) as LayoutDocument,
  };
};
/** The helper on the toolchain's Python: every refusal that comes before the API client is imported. */
const plain = (args: string[], cwd: string, env: NodeJS.ProcessEnv = baseEnv()) =>
  settle(
    spawnSync(python, [tool, ...args], { cwd, encoding: "utf8", env, timeout: 120_000 }),
    args.join(" "),
  );
/** The helper through uv with the pinned PEP 723 dependencies; `offline` as VERA runs it (run --offline). */
const helper = (args: string[], cwd: string, env: NodeJS.ProcessEnv = baseEnv(), offline = false) =>
  settle(
    spawnSync(uv ?? "uv", ["run", "--quiet", ...(offline ? ["--offline"] : []), "--script", tool, ...args], {
      cwd,
      encoding: "utf8",
      env,
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }),
    args.join(" "),
  );
const hashes = async (folder: string) => {
  const out: Record<string, string> = {};
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[path.slice(folder.length + 1).replaceAll("\\", "/")] = sha256(await readFile(path));
  }
  return out;
};
const bench = async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-layout-")));
  await cp(join(fixtures, "board"), join(dir, "boards"), { recursive: true });
  return dir;
};
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const killTree = (pid: number) => {
  if (windows) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
};
const request = (candidate: string, operations: object[]) =>
  JSON.stringify({ format: 1, candidate, units: "mm", operations });

it("publishes the official kicad-layout package, its pack and skill (REQ-PLAT-3957eafc, REQ-UX-5367fe76)", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "kicad-layout",
    version: "1.0.0",
    ecosystem: "electronics",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(Object.keys(m.programs)).toEqual(["kicad-cli", "kicad-layout-tool"]);
  expect(m.programs["kicad-cli"]?.install).toMatchObject({
    find: {
      windows: ["%PATH%", "%ProgramFiles%/KiCad/*/bin/kicad-cli.exe"],
      linux: ["$PATH", "/usr/bin/kicad-cli"],
    },
  });
  expect(m.programs["kicad-cli"]?.install).not.toHaveProperty("download");
  expect(m.programs["kicad-cli"]?.version).toEqual({
    args: ["version"],
    match: "^(\\d+\\.\\d+\\.\\d+)",
    range: ">=10.0,<11",
  });
  expect(m.programs["kicad-layout-tool"]).toMatchObject({
    install: { script: "scripts/kicad_layout_tool.py" },
    uses: ["kicad-cli"],
    // It starts KiCad's PCB editor: its runs get the desktop's display variables (REQ-PLAT-e0d8f3cf).
    gui: true,
  });
  const script = await readFile(tool, "utf8");
  expect(script).toMatch(
    /# dependencies = \["kicad-python==0\.8\.0", "protobuf==5\.29\.6", "pynng==0\.9\.0"\]/,
  );
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("kicad-layout");
  expect(catalog.metadata["kicad-layout"].activities).toEqual(["design"]);
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs.find((pack: { id: string }) => pack.id === "electronics")?.groups).toContainEqual({
    name: "PCB placement and local routing (KiCad)",
    plugins: ["kicad-layout"],
    default: false,
  });
  expect(await core.checkCatalogSource(fileURLToPath(plugins))).toEqual([]);
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-layout-skills-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("kicad-layout");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const listed = (await skills.list()).filter((skill) => skill.plugin === "kicad-layout");
    expect(listed.map((skill) => skill.name)).toEqual(["kicad-layout"]);
    const text = (await skills.read("plugin", "kicad-layout")).content;
    for (const phrase of [
      "kicad-layout-tool open",
      "kicad-layout-tool edit",
      "kicad-layout-tool close",
      "board.json",
      "objectives",
      "apply_candidate",
      "Preferences > Plugins",
    ])
      expect(text, phrase).toContain(phrase);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(!existsSync(kicadCli))(
  "accepts the version of the installed KiCad 10 kicad-cli (REQ-PLAT-3957eafc)",
  async () => {
    const probe = (await manifest()).programs["kicad-cli"]?.version;
    if (!probe) throw new Error("kicad-cli has no version probe");
    const printed = spawnSync(kicadCli, probe.args, { encoding: "utf8" });
    const version = new RegExp(probe.match).exec(String(printed.stdout).trim())?.[1];
    expect(version, printed.stdout).toMatch(/^10\./);
    expect(versionInRange(version as string, probe.range as string)).toBe(true);
  },
);

it("lets kicad-layout-tool run as a safe host program and blocks direct kicad-cli use (REQ-PLAT-3957eafc)", async () => {
  const rules = (await manifest()).rules ?? [];
  const risk = (program: string, args: string[]) => classifyCommand(rules, program, args).risk;
  expect(risk("kicad-cli", ["pcb", "drc", "x.kicad_pcb"])).toBe("blocked");
  expect(risk("kicad-cli", ["version"])).toBe("safe");
  expect(risk("kicad-layout-tool", ["open", "--board", "b.kicad_pcb"])).toBe("safe");
  expect(risk("kicad-layout-tool", ["edit", "--run", "electronics-results/r1", "--json", "{}"])).toBe("safe");
  expect(risk("kicad-layout-tool", ["close", "--run", "electronics-results/r1"])).toBe("safe");
});

it("keeps the shared path module byte-identical to the kicad plugin's (REQ-REL-19ac705f)", async () => {
  const mine = await readFile(join(source, "scripts/kicad_layout_support/workspace.py"));
  const theirs = await readFile(fileURLToPath(new URL("kicad/scripts/kicad_support/workspace.py", plugins)));
  expect(sha256(mine)).toBe(sha256(theirs));
});

describe("kicad-layout-tool without KiCad", { timeout: 300_000 }, () => {
  let dir: string;
  beforeAll(async () => {
    dir = await bench();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints its version and help (REQ-DATA-891d5b5d)", () => {
    const version = spawnSync(python, [tool, "--version"], { encoding: "utf8", env: baseEnv() });
    expect(version.stdout.trim()).toMatch(/^kicad-layout-tool 1\.0\.0$/);
    const help = spawnSync(python, [tool, "--help"], { encoding: "utf8", env: baseEnv() });
    for (const word of ["open", "edit", "close", "--board", "--run", "--json"])
      expect(help.stdout).toContain(word);
  });

  it("refuses an open of anything but a workbench board before starting KiCad (REQ-REL-19ac705f)", async () => {
    const before = await hashes(dir);
    const outside = await mkdtemp(join(tmpdir(), "vera-kicad-layout-outside-"));
    await writeFile(join(dir, "boards/layout.kicad_sch"), "(kicad_sch (version 20231120))\n");
    try {
      await cp(join(fixtures, "board"), outside, { recursive: true });
      for (const args of [
        ["open", "--board", "../outside.kicad_pcb"],
        ["open", "--board", join(outside, "layout.kicad_pcb")],
        ["open", "--board", "boards/missing.kicad_pcb"],
        ["open", "--board", "boards/layout.kicad_pro"],
        ["open", "--board", "boards/layout.kicad_sch"],
        ["open", "--board", "boards/layout.kicad_pcb", "--run-id", "../x"],
        ["open", "--board", "boards/layout.kicad_pcb", "--results-dir", "../elsewhere"],
      ]) {
        const done = plain(args, dir);
        expect(done.code, args.join(" ")).toBe(2);
        expect(
          done.doc.problems.map((p) => p.kind),
          args.join(" "),
        ).toContain("path");
        if (args.includes("--results-dir")) expect(done.doc.problems[0]?.where).toBe("--results-dir");
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
      await rm(join(dir, "boards/layout.kicad_sch"));
    }
    expect(await hashes(dir)).toEqual(before);
    expect(existsSync(join(dir, "electronics-results"))).toBe(false);
  });

  it("refuses malformed requests and stale candidates before connecting (REQ-REL-2a3f09b8, REQ-REL-e30bf69f)", async () => {
    const run = join(dir, "electronics-results", "offline");
    await mkdir(join(run, "candidate"), { recursive: true });
    const candidate = await readFile(join(fixtures, "board/layout.kicad_pcb"));
    await writeFile(join(run, "candidate/layout.kicad_pcb"), candidate);
    const state = {
      format: 1,
      kind: "kicad-layout-state",
      runId: "offline",
      tool: "kicad-layout-tool",
      toolVersion: "1.0.0",
      kicad: "10.0.8",
      source: { path: "boards/layout.kicad_pcb", sha256: sha256(candidate), bytes: candidate.length },
      candidate: {
        path: "candidate/layout.kicad_pcb",
        sha256: sha256(candidate),
        memorySha256: "0".repeat(64),
      },
      editor: { pid: 999999 },
      edits: 0,
      objectives: { status: "none" },
    };
    await writeFile(join(run, "state.json"), JSON.stringify(state));
    const before = await hashes(run);
    const hash = sha256(candidate);
    const place = { op: "place", footprint: "C1", at: [124, 112] };
    const malformed: [string, string][] = [
      ["not json", "{"],
      ["format 2", JSON.stringify({ format: 2, candidate: hash, units: "mm", operations: [place] })],
      ["inch", JSON.stringify({ format: 1, candidate: hash, units: "inch", operations: [place] })],
      ["replace", request(hash, [{ op: "replace", footprint: "C1", with: "R" }])],
      [
        "65 operations",
        request(
          hash,
          Array.from({ length: 65 }, () => place),
        ),
      ],
      [
        "width 0",
        request(hash, [
          {
            op: "track",
            net: "VIN",
            layer: "F.Cu",
            width: 0,
            points: [
              [1, 1],
              [2, 2],
            ],
          },
        ]),
      ],
      [
        "width 11",
        request(hash, [
          {
            op: "track",
            net: "VIN",
            layer: "F.Cu",
            width: 11,
            points: [
              [1, 1],
              [2, 2],
            ],
          },
        ]),
      ],
      ["via drill", request(hash, [{ op: "via", net: "VIN", at: [1, 1], diameter: 0.4, drill: 0.4 }])],
      [
        "polygon",
        request(hash, [
          {
            op: "keepout",
            layers: ["F.Cu"],
            polygon: [
              [1, 1],
              [2, 2],
            ],
            forbid: ["tracks"],
          },
        ]),
      ],
      ["coordinate", request(hash, [{ op: "place", footprint: "C1", at: [1001, 0] }])],
      ["string number", request(hash, [{ op: "place", footprint: "C1", at: ["124", 112] }])],
      ["align repeat", request(hash, [{ op: "align", footprints: ["R3", "R3"], y: 125 }])],
      ["place twice", request(hash, [place, { op: "place", footprint: "C1", orientation: 90 }])],
      [
        "place and align",
        request(hash, [
          { op: "place", footprint: "R3", at: [110, 120] },
          { op: "align", footprints: ["R4", "R3"], y: 125 },
        ]),
      ],
      ["unknown key", request(hash, [{ ...place, side: "back" }])],
    ];
    for (const [label, text] of malformed) {
      const done = plain(["edit", "--run", "electronics-results/offline", "--json", text], dir);
      expect(done.code, label).toBe(2);
      expect(done.doc.problems[0]?.kind, label).toBe("request");
    }
    const twice = plain(
      [
        "edit",
        "--run",
        "electronics-results/offline",
        "--json",
        malformed.find(([l]) => l === "place twice")?.[1] ?? "",
      ],
      dir,
    );
    expect(twice.doc.problems[0]).toMatchObject({
      where: "operations[1]",
      message: expect.stringContaining("operations[0]"),
    });
    // A request from a file in the workbench (for requests beyond the 4096-character argument limit).
    await writeFile(join(dir, "big-request.json"), request("0".repeat(64), [place]));
    const fromFile = plain(
      ["edit", "--run", "electronics-results/offline", "--request", "big-request.json"],
      dir,
    );
    expect(fromFile.doc.problems[0]?.kind, fromFile.stdout).toBe("changed");
    const outsideFile = plain(
      ["edit", "--run", "electronics-results/offline", "--request", "../x.json"],
      dir,
    );
    expect(outsideFile.doc.problems[0]).toMatchObject({ kind: "request", where: "--request" });
    await rm(join(dir, "big-request.json"));
    const longRun = plain(["edit", "--run", "r".repeat(20_000), "--json", request(hash, [place])], dir);
    expect(longRun.code).toBe(2);
    expect(longRun.doc.runId.length).toBeLessThanOrEqual(64);
    const stale = plain(
      ["edit", "--run", "electronics-results/offline", "--json", request("0".repeat(64), [place])],
      dir,
    );
    expect(stale.code).toBe(2);
    expect(stale.doc.problems[0]?.kind).toBe("changed");
    await writeFile(join(run, "candidate/layout.kicad_pcb"), Buffer.concat([candidate, Buffer.from(" ")]));
    const edited = plain(
      ["edit", "--run", "electronics-results/offline", "--json", request(hash, [place])],
      dir,
    );
    expect(edited.code).toBe(2);
    expect(edited.doc.problems[0]?.kind).toBe("changed");
    await writeFile(join(run, "candidate/layout.kicad_pcb"), candidate);
    const notRun = plain(["edit", "--run", "boards", "--json", request(hash, [place])], dir);
    expect(notRun.code).toBe(2);
    expect(notRun.doc.problems[0]?.kind).toBe("run");
    expect(await hashes(run)).toEqual(before);
  });

  it.skipIf(!uv || apiAnswers())(
    "reports an editor that never answers and a valid edit with no KiCad as connection failures (REQ-REL-d2fd6d58, REQ-REL-233d6e0f)",
    async () => {
      const pidFile = join(dir, "stub.pid");
      // The stub editor stands in for KiCad's; any existing file passes the kicad-cli check, which comes first.
      const env = baseEnv({
        KICAD_LAYOUT_TEST_EDITOR: join(hooks, "editor_stub.py"),
        KICAD_LAYOUT_WAIT_SECONDS: "4",
        STUB_PID_FILE: pidFile,
        VERA_PROGRAM_KICAD_CLI: python,
      });
      const opened = helper(["open", "--board", "boards/layout.kicad_pcb", "--run-id", "stub"], dir, env);
      expect(opened.code, opened.stdout).toBe(3);
      expect(opened.doc.problems[0]?.kind).toBe("connection");
      expect(opened.doc.problems[0]?.message).toContain("Preferences > Plugins");
      expect(existsSync(join(dir, "electronics-results", "stub"))).toBe(false);
      const pid = Number(await readFile(pidFile, "utf8"));
      await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
      const candidate = await readFile(join(dir, "electronics-results/offline/candidate/layout.kicad_pcb"));
      const done = helper(
        [
          "edit",
          "--run",
          "electronics-results/offline",
          "--json",
          request(sha256(candidate), [{ op: "place", footprint: "C1", at: [124, 112] }]),
        ],
        dir,
        baseEnv({ KICAD_LAYOUT_WAIT_SECONDS: "3", VERA_PROGRAM_KICAD_CLI: python }),
      );
      expect(done.code, done.stdout).toBe(3);
      expect(done.doc.problems[0]?.kind).toBe("connection");
      // Without kicad-cli an edit fails before it connects: nothing is touched.
      const noCli = helper(
        [
          "edit",
          "--run",
          "electronics-results/offline",
          "--json",
          request(sha256(candidate), [{ op: "place", footprint: "C1", at: [124, 112] }]),
        ],
        dir,
        baseEnv({ VERA_PROGRAM_KICAD_CLI: join(dir, "no-kicad-cli.exe") }),
      );
      expect(noCli.code, noCli.stdout).toBe(3);
      expect(noCli.doc.problems[0]).toMatchObject({ kind: "kicad", where: "kicad-cli" });
    },
  );
});

describe.skipIf(!gui)(
  `kicad-layout-tool with KiCad's PCB editor${gui ? "" : ` (skipped: ${guiReason})`}`,
  { timeout: 900_000 },
  () => {
    let dir: string;
    const editors: number[] = [];
    // Every helper run gets the environment and the uv arguments of VERA's program runner.
    const run = (args: string[], env: NodeJS.ProcessEnv = veraEnv()) => helper(args, dir, env, true);
    const open = (runId: string, board = "boards/layout.kicad_pcb") =>
      run(["open", "--board", board, "--run-id", runId]);
    const state = (runId: string) => json(join(dir, "electronics-results", runId, "state.json"));
    const board = (runId: string) => json(join(dir, "electronics-results", runId, "board.json"));
    const edit = async (runId: string, operations: object[], env?: NodeJS.ProcessEnv) =>
      run(
        [
          "edit",
          "--run",
          `electronics-results/${runId}`,
          "--json",
          request((await state(runId)).candidate.sha256, operations),
        ],
        env,
      );
    /** result.json's inputs and artifacts name files of the run folder (or the workbench) with their SHA-256. */
    const checkFiles = async (runId: string, doc: LayoutDocument) => {
      const folder = join(dir, "electronics-results", runId);
      expect(doc.artifacts.length).toBeGreaterThan(2);
      for (const artifact of doc.artifacts)
        expect(sha256(await readFile(join(folder, artifact.path))), artifact.path).toBe(artifact.sha256);
      for (const name of ["state.json", "result.json", "board.json", "report.md"]) {
        const text = await readFile(join(folder, name), "utf8");
        expect(text, name).not.toMatch(/token/i);
        expect(text, name).not.toMatch(absolutePath);
        expect(text, name).not.toContain(dir);
      }
    };
    const footprint = async (runId: string, ref: string) =>
      (await board(runId)).footprints.find((f: { reference: string }) => f.reference === ref);
    const pad = async (runId: string, ref: string, net: string) =>
      (await footprint(runId, ref)).pads.find((p: { net: string }) => p.net === net).at as [number, number];
    const unchangedFiles = async (runId: string) => {
      const s = await state(runId);
      return [s.candidate.sha256, s.candidate.memorySha256, s.edits];
    };

    beforeAll(async () => {
      dir = await bench();
      await mkdir(join(dir, ".vera"));
    });
    /** The helper started by VERA's own ProgramRunner (closed stdin, allowlisted environment, display opt-in). */
    const viaRunner = async (args: string[]) => {
      const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
      const started = await runner.start({
        sessionId: "s1",
        workbench: dir,
        executable: uv ?? "uv",
        args: ["run", "--quiet", "--offline", "--script", tool, ...args],
        env: {
          ...(uvCache ? { UV_CACHE_DIR: uvCache } : {}),
          PYTHONDONTWRITEBYTECODE: "1",
          VERA_PROGRAM_KICAD_CLI: kicadCli,
        },
        display: true,
        timeoutMs: 300_000,
      });
      const result = await started.done;
      expect(result.truncated, result.output.slice(-500)).toBe(false);
      return { code: result.exitCode, doc: JSON.parse(result.output.trim()) as LayoutDocument };
    };
    afterAll(async () => {
      const runs = join(dir, "electronics-results");
      for (const run of existsSync(runs) ? await readdir(runs) : []) {
        const file = join(runs, run, "state.json");
        if (existsSync(file)) editors.push((await json(file)).editor?.pid ?? 0);
      }
      for (const pid of editors) if (pid && alive(pid)) killTree(pid);
      await sleep(1000);
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    });

    it("opens a candidate copy in the PCB editor and leaves the source unchanged (REQ-FUNC-32022bcd, REQ-DATA-891d5b5d)", async () => {
      const before = await hashes(join(dir, "boards"));
      // This open runs through VERA's ProgramRunner and process host, as run_program starts it.
      const done = await viaRunner(["open", "--board", "boards/layout.kicad_pcb", "--run-id", "a"]);
      expect(done.code, JSON.stringify(done.doc)).toBe(0);
      expect(done.doc).toMatchObject({
        format: 1,
        kind: "kicad-layout-result",
        operation: "open",
        status: "completed",
      });
      const s = await state("a");
      expect(s).toMatchObject({
        format: 1,
        kind: "kicad-layout-state",
        source: { path: "boards/layout.kicad_pcb", sha256: before["layout.kicad_pcb"] },
        candidate: { path: "candidate/layout.kicad_pcb" },
        edits: 0,
        objectives: { status: "none" },
      });
      expect(s.kicad).toMatch(/^10\./);
      expect(sha256(await readFile(join(dir, "electronics-results/a/candidate/layout.kicad_pcb")))).toBe(
        s.candidate.sha256,
      );
      expect(alive(s.editor.pid)).toBe(true);
      const b = await board("a");
      expect(b.footprints.map((f: { reference: string }) => f.reference).sort()).toEqual([
        "C1",
        "H1",
        "J1",
        "R1",
        "R2",
        "R3",
        "R4",
        "U1",
      ]);
      expect(b.footprints.find((f: { reference: string }) => f.reference === "H1").locked).toBe(true);
      expect(b.nets).toEqual(expect.arrayContaining(["VIN", "VOUT", "GND", "FB", "SENSE"]));
      expect(b.copperLayers).toEqual(["F.Cu", "B.Cu"]);
      expect(b.outline).toEqual([100, 100, 150, 130]);
      expect(existsSync(join(dir, "electronics-results/a/drc-before.json"))).toBe(true);
      for (const layer of ["F_Cu", "B_Cu"]) {
        const svg = await readFile(join(dir, `electronics-results/a/previews/before-${layer}.svg`), "utf8");
        expect(svg, layer).toContain("<svg");
      }
      expect(done.doc.inputs[0]).toMatchObject({
        path: "boards/layout.kicad_pcb",
        role: "board",
        sha256: before["layout.kicad_pcb"],
      });
      expect(done.doc.warnings).toEqual(expect.any(Array));
      await checkFiles("a", done.doc);
      expect(await hashes(join(dir, "boards"))).toEqual(before);
      expect((await readdir(join(dir, "boards"))).filter((name) => name.endsWith(".lck"))).toEqual([]);
      const text = await readFile(join(dir, "electronics-results/a/state.json"), "utf8");
      expect(text).not.toMatch(/token/i);
      expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    });

    it("refuses a second open while the candidate window holds the API (REQ-SEC-6bb41c34)", async () => {
      await cp(join(dir, "boards/layout.kicad_pcb"), join(dir, "boards/other.kicad_pcb"));
      const docs = JSON.parse(nudge("docs").stdout);
      const editors = editorCount();
      const done = open("blocked", "boards/other.kicad_pcb");
      expect(done.code, done.stdout).toBe(2);
      expect(done.doc.problems[0]?.kind).toBe("binding");
      expect(done.doc.problems[0]?.message).toContain("layout.kicad_pcb");
      expect(done.doc.problems[0]?.message).not.toContain("other.kicad_pcb");
      expect(editorCount()).toBe(editors);
      expect(existsSync(join(dir, "electronics-results/blocked"))).toBe(false);
      expect(JSON.parse(nudge("docs").stdout)).toEqual(docs);
      await rm(join(dir, "boards/other.kicad_pcb"));
    });

    it("places the decoupling capacitor, routes it and aligns two resistors in checked commits (REQ-FUNC-f92446a1, REQ-FUNC-cd7d1b3f, REQ-FUNC-9c4d809c, REQ-FUNC-350e262a)", async () => {
      const placed = await edit("a", [{ op: "place", footprint: "C1", at: [124, 112], orientation: 90 }]);
      expect(placed.code, placed.stdout).toBe(0);
      const c1 = await footprint("a", "C1");
      expect(c1.at).toEqual([124, 112]);
      expect(c1.orientation).toBe(90);
      const vin = await pad("a", "C1", "VIN");
      const gnd = await pad("a", "C1", "GND");
      const routing = [
        { op: "track", net: "VIN", layer: "F.Cu", width: 0.25, points: [[121, 112], vin] },
        { op: "track", net: "GND", layer: "F.Cu", width: 0.25, points: [gnd, [126, gnd[1]], [126, 115.5]] },
        { op: "via", net: "GND", at: [126, 115.5], diameter: 0.8, drill: 0.4 },
      ];
      const sent = request((await state("a")).candidate.sha256, routing);
      const routed = await edit("a", routing);
      expect(routed.code, routed.stdout).toBe(0);
      expect(
        JSON.parse(await readFile(join(dir, "electronics-results/a/requests/002.json"), "utf8")),
      ).toEqual(JSON.parse(sent));
      expect(routed.doc.inputs).toEqual([
        { path: "requests/002.json", role: "request", sha256: expect.any(String) },
        {
          path: "candidate/layout.kicad_pcb",
          role: "candidate before the edit",
          sha256: JSON.parse(sent).candidate,
        },
      ]);
      await checkFiles("a", routed.doc);
      expect(routed.doc.inputs[0].sha256).toBe(
        sha256(await readFile(join(dir, "electronics-results/a/requests/002.json"))),
      );
      // The fixture's untouched items: 8 footprints, 6 track segments, 1 via, no zone.
      expect(routed.doc.unchanged).toEqual({ footprints: 8, tracks: 6, vias: 1, zones: 0 });
      expect(routed.doc.drc.before).toEqual({ error: expect.any(Number), warning: expect.any(Number) });
      expect(routed.doc.drc.after).toEqual({ error: expect.any(Number), warning: expect.any(Number) });
      expect(routed.doc.previews).toEqual(
        expect.arrayContaining(["previews/before-F_Cu.svg", "previews/after-F_Cu.svg"]),
      );
      const vinTrack = routed.doc.changes.created.find(
        (c: { type: string; net: string }) => c.type === "track" && c.net === "VIN",
      );
      expect(vinTrack.length).toBeCloseTo(Math.hypot(vin[0] - 121, vin[1] - 112), 6);
      expect(routed.doc.objectives.status).toBe("pass");
      expect(routed.doc.unconnected.after).toBeLessThan(routed.doc.unconnected.before);
      const moved = routed.doc.changes.footprints.find((f: { reference: string }) => f.reference === "C1");
      expect(moved).toMatchObject({
        before: { at: [140, 125], orientation: 0 },
        after: { at: [124, 112], orientation: 90 },
      });
      expect(routed.doc.changes.created.map((c: { type: string }) => c.type).sort()).toEqual([
        "track",
        "track",
        "track",
        "via",
      ]);
      const gndNet = routed.doc.nets.find((n: { name: string }) => n.name === "GND");
      expect(gndNet.after.vias).toBe(gndNet.before.vias + 1);
      expect(routed.doc.unchanged.footprints).toBe(8);
      expect(
        existsSync(
          join(
            dir,
            "electronics-results/a",
            routed.doc.previews.find((p: string) => p.includes("after-F_Cu")),
          ),
        ),
      ).toBe(true);
      const report = await readFile(join(dir, "electronics-results/a/report.md"), "utf8");
      expect(report).toContain("| C1 | (140, 125) 0 deg | (124, 112) 90 deg |");
      // report.md prints lengths with Python's general format: six significant digits.
      expect(report).toContain(`0.25 mm x ${Number(vinTrack.length.toPrecision(6))} mm`);
      expect(report).toMatch(/\| GND \| [\d.]+ mm \| [\d.]+ mm \| \d+ \| \d+ \|/);
      expect(report).toContain(
        `unconnected items ${routed.doc.unconnected.before} -> ${routed.doc.unconnected.after}`,
      );
      expect(report).toContain("previews/after-F_Cu.svg");
      expect(report).toContain(
        `DRC errors ${routed.doc.drc.before.error} -> ${routed.doc.drc.after.error}, warnings ${routed.doc.drc.before.warning} -> ${routed.doc.drc.after.warning}`,
      );
      const aligned = await edit("a", [
        { op: "align", footprints: ["R3", "R4"], y: 125, pitch: 4 },
        {
          op: "keepout",
          layers: ["F.Cu"],
          polygon: [
            [102, 102],
            [110, 102],
            [110, 106],
            [102, 106],
          ],
          forbid: ["tracks", "vias"],
        },
      ]);
      expect(aligned.code, aligned.stdout).toBe(0);
      expect(aligned.doc.objectives.status).toBe("pass");
      expect((await footprint("a", "R3")).at).toEqual([110, 125]);
      expect((await footprint("a", "R4")).at).toEqual([114, 125]);
      expect((await board("a")).zones).toBe(1);
      const s = await state("a");
      expect(s.edits).toBe(3);
      expect(s.objectives.status).toBe("pass");
      expect(sha256(await readFile(join(dir, "electronics-results/a/candidate/layout.kicad_pcb")))).toBe(
        s.candidate.sha256,
      );
      for (const n of ["001", "002", "003"])
        expect(existsSync(join(dir, "electronics-results/a/requests", `${n}.json`))).toBe(true);
      // The report matches the saved candidate read again through the API (E06-G).
      const docs = JSON.parse(nudge("docs").stdout);
      expect(docs.memory).toBe(s.candidate.memorySha256);
    });

    it("closes the candidate's editor and removes KiCad's lock files (REQ-FUNC-b0cbbb04)", async () => {
      const s = await state("a");
      const before = await hashes(join(dir, "electronics-results/a"));
      const done = run(["close", "--run", "electronics-results/a"]);
      expect(done.code, done.stdout).toBe(0);
      await expect.poll(() => alive(s.editor.pid), { timeout: 15_000 }).toBe(false);
      expect(
        (await readdir(join(dir, "electronics-results/a/candidate"))).filter((n) => n.endsWith(".lck")),
      ).toEqual([]);
      const after = await hashes(join(dir, "electronics-results/a"));
      for (const name of ["state.json", "result.json", "candidate/layout.kicad_pcb"])
        expect(after[name]).toBe(before[name]);
    });

    it("refuses unknown, locked and outside items and keeps the candidate (REQ-SEC-a6a6482e, REQ-SEC-f986d80d, REQ-SEC-f7a0b1fe)", async () => {
      expect(open("b").code).toBe(0);
      const c1 = await footprint("b", "C1");
      const r1 = await footprint("b", "R1");
      const cases: [string, object[], string][] = [
        ["R99", [{ op: "place", footprint: "R99", at: [120, 120] }], "footprint"],
        ["uuid", [{ op: "place", footprint: "R1", uuid: c1.uuid, at: [120, 120] }], "footprint"],
        [
          "net",
          [
            {
              op: "track",
              net: "NO_SUCH_NET",
              layer: "F.Cu",
              width: 0.25,
              points: [
                [102, 128],
                [104, 128],
              ],
            },
          ],
          "net",
        ],
        [
          "layer",
          [
            {
              op: "track",
              net: "VIN",
              layer: "In5.Cu",
              width: 0.25,
              points: [
                [102, 128],
                [104, 128],
              ],
            },
          ],
          "layer",
        ],
        ["locked place", [{ op: "place", footprint: "H1", at: [140, 105] }], "locked"],
        ["locked align", [{ op: "align", footprints: ["R3", "H1"], y: 120 }], "locked"],
        ["outside place", [{ op: "place", footprint: "R4", at: [155, 120] }], "outline"],
        [
          "outside track",
          [
            {
              op: "track",
              net: "SENSE",
              layer: "F.Cu",
              width: 0.25,
              points: [
                [114, 127],
                [114, 135],
              ],
            },
          ],
          "outline",
        ],
      ];
      for (const [label, operations, kind] of cases) {
        const before = await unchangedFiles("b");
        const done = await edit("b", operations);
        expect(done.code, `${label}: ${done.stdout}`).toBe(2);
        expect(done.doc.problems[0]?.kind, label).toBe(kind);
        expect(await unchangedFiles("b"), label).toEqual(before);
        expect(JSON.parse(nudge("docs").stdout).memory, label).toBe(
          (await state("b")).candidate.memorySha256,
        );
      }
      expect((await footprint("b", "R4")).at).toEqual([114, 127]);
      expect((await footprint("b", "R1")).at).toEqual(r1.at);
      const near = await edit("b", [
        {
          op: "track",
          net: "SENSE",
          layer: "F.Cu",
          width: 0.25,
          points: [
            [138, 105],
            [141, 105],
          ],
        },
      ]);
      expect(near.code, near.stdout).toBe(0);
      expect((await footprint("b", "H1")).at).toEqual([145, 105]);
    });

    it("refuses a track across another net's copper, which KiCad would move to that net (REQ-SEC-a6a6482e)", async () => {
      const before = await unchangedFiles("b");
      // GND across the VOUT track: KiCad connects new copper to what it touches and saves it as VOUT.
      const crossing = await edit("b", [
        {
          op: "track",
          net: "GND",
          layer: "F.Cu",
          width: 0.25,
          points: [
            [117, 108],
            [121, 108],
          ],
        },
      ]);
      expect(crossing.code, crossing.stdout).toBe(2);
      expect(crossing.doc.problems[0]).toMatchObject({
        kind: "net",
        where: "operations[0]",
        message: expect.stringContaining("VOUT"),
      });
      expect(crossing.doc.problems[0]?.message).toContain("(117, 108) to (121, 108)");
      // A VIN via on the locked GND track of B.Cu: KiCad would make it a GND via.
      const via = await edit("b", [
        { op: "place", footprint: "R3", at: [110, 124] },
        { op: "via", net: "VIN", at: [120, 115.5], diameter: 0.8, drill: 0.4 },
      ]);
      expect(via.code, via.stdout).toBe(2);
      expect(via.doc.problems[0]).toMatchObject({
        kind: "net",
        where: "operations[1]",
        message: expect.stringContaining("GND"),
      });
      expect(await unchangedFiles("b")).toEqual(before);
      expect((await footprint("b", "R3")).at).toEqual([110, 125]);
      expect(JSON.parse(nudge("docs").stdout).memory).toBe((await state("b")).candidate.memorySha256);
    });

    it("fails the objectives of a short, a clearance violation and a broken connection (REQ-FUNC-9c4d809c)", async () => {
      // R4's SENSE pad placed on the VIN track: a short between a pad and a track.
      const short = await edit("b", [{ op: "place", footprint: "R4", at: [110, 112] }]);
      expect(short.code, short.stdout).toBe(0);
      expect(short.doc.objectives.status).toBe("fail");
      expect(short.doc.drc.new.map((v: { type: string }) => v.type)).toContain("shorting_items");
      expect((await state("b")).objectives.status).toBe("fail");
      // A SENSE track 0.125 mm from the 0.5 mm VIN track: closer than the 0.2 mm clearance, without touching it.
      const near = await edit("b", [
        {
          op: "track",
          net: "SENSE",
          layer: "F.Cu",
          width: 0.25,
          points: [
            [108, 111.5],
            [112, 111.5],
          ],
        },
      ]);
      expect(near.code, near.stdout).toBe(0);
      expect(near.doc.objectives.status).toBe("fail");
      expect(near.doc.drc.new.map((v: { type: string }) => v.type)).toContain("clearance");
      // The regulator moved away from its tracks: its pads lose their connections.
      const pulled = await edit("b", [{ op: "place", footprint: "U1", at: [120, 120] }]);
      expect(pulled.code, pulled.stdout).toBe(0);
      expect(pulled.doc.unconnected.after).toBeGreaterThan(pulled.doc.unconnected.before);
      expect(pulled.doc.objectives.reasons.join(" ")).toMatch(/unconnected items rose/);
    });

    it("records an edit that KiCad saved when its checks fail afterwards (REQ-REL-233d6e0f)", async () => {
      const before = await state("b");
      // A kicad-cli that cannot run DRC: the save has happened when its failure shows.
      const failed = await edit(
        "b",
        [{ op: "place", footprint: "R1", at: [130, 106] }],
        veraEnv({ VERA_PROGRAM_KICAD_CLI: python }),
      );
      expect(failed.code, failed.stdout).toBe(3);
      expect(failed.doc.problems[0]).toMatchObject({
        kind: "kicad",
        where: "kicad-cli",
        message: expect.stringContaining("was saved to the candidate"),
      });
      const after = await state("b");
      expect(after.edits).toBe(before.edits + 1);
      expect(after.objectives.status).toBe("none");
      expect(after.candidate.sha256).not.toBe(before.candidate.sha256);
      expect(sha256(await readFile(join(dir, "electronics-results/b/candidate/layout.kicad_pcb")))).toBe(
        after.candidate.sha256,
      );
      expect(JSON.parse(nudge("docs").stdout).memory).toBe(after.candidate.memorySha256);
      expect((await footprint("b", "R1")).at).toEqual([130, 106]);
      const requestFile = `requests/${String(after.edits).padStart(3, "0")}.json`;
      expect(
        JSON.parse(await readFile(join(dir, "electronics-results/b", requestFile), "utf8")).operations,
      ).toEqual([{ op: "place", footprint: "R1", at: [130, 106] }]);
      // result.json describes this failure, not the previous edit.
      const result = await json(join(dir, "electronics-results/b/result.json"));
      expect(result).toMatchObject({
        status: "failed",
        request: requestFile,
        candidate: { sha256: after.candidate.sha256 },
      });
      expect(await readFile(join(dir, "electronics-results/b/report.md"), "utf8")).toContain(
        "was saved to the candidate",
      );
      // The run continues: the next edit checks the candidate again, with the saved move in its report.
      const next = await edit("b", [{ op: "place", footprint: "R2", at: [133, 111] }]);
      expect(next.code, next.stdout).toBe(0);
      expect(["pass", "fail"]).toContain((await state("b")).objectives.status);
      const moved = (next.doc.changes.footprints as { reference: string; after: { at: number[] } }[]).map(
        (f) => [f.reference, f.after.at],
      );
      expect(moved).toEqual(
        expect.arrayContaining([
          ["R1", [130, 106]],
          ["R2", [133, 111]],
        ]),
      );
      // Its previews still start with open's before previews (REQ-FUNC-350e262a).
      expect(next.doc.previews).toEqual(
        expect.arrayContaining(["previews/before-F_Cu.svg", "previews/after-F_Cu.svg"]),
      );
    });

    it("checks the run-folder files before the commit and reports any failure after the save as saved (REQ-REL-233d6e0f)", async () => {
      const runDir = join(dir, "electronics-results/b");
      // A corrupt drc-before.json: nothing is saved.
      const drcBefore = await readFile(join(runDir, "drc-before.json"), "utf8");
      await writeFile(join(runDir, "drc-before.json"), "{");
      const unchanged = await unchangedFiles("b");
      const corrupt = await edit("b", [{ op: "place", footprint: "R1", at: [131, 106] }]);
      expect(corrupt.code, corrupt.stdout).toBe(3);
      expect(corrupt.doc.problems[0]).toMatchObject({
        kind: "output",
        where: "run",
        message: expect.stringContaining("Nothing was saved"),
      });
      expect(await unchangedFiles("b")).toEqual(unchanged);
      await writeFile(join(runDir, "drc-before.json"), drcBefore);
      // result.json is not an input of the edit: a foreign one does not matter.
      await writeFile(join(runDir, "result.json"), "[1]\n");

      // board.json cannot be written after the save: the checks did not finish, the run continues.
      const before = await state("b");
      await rm(join(runDir, "board.json"));
      await mkdir(join(runDir, "board.json", "blocked"), { recursive: true });
      const blocked = await edit("b", [{ op: "place", footprint: "R1", at: [131, 106] }]);
      expect(blocked.code, blocked.stdout).toBe(3);
      expect(blocked.doc.problems[0]).toMatchObject({
        kind: "output",
        message: expect.stringMatching(/was saved to the candidate, but its checks did not finish/),
      });
      const after = await state("b");
      expect(after).toMatchObject({ edits: before.edits + 1, objectives: { status: "none" } });
      const requestFile = `requests/${String(after.edits).padStart(3, "0")}.json`;
      expect(await json(join(runDir, "result.json"))).toMatchObject({
        status: "failed",
        kicad: before.kicad,
        request: requestFile,
        candidate: { sha256: after.candidate.sha256 },
      });
      expect((await readdir(runDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
      await rm(join(runDir, "board.json"), { recursive: true });

      // The request cannot be recorded after the save: the problem says so; the failed report has no request.
      await rename(join(runDir, "requests"), join(runDir, "requests-kept"));
      await writeFile(join(runDir, "requests"), "not a folder\n");
      const unrecorded = await edit("b", [{ op: "place", footprint: "R1", at: [130, 106] }]);
      expect(unrecorded.code, unrecorded.stdout).toBe(3);
      expect(unrecorded.doc.problems[0]).toMatchObject({
        kind: "output",
        message: expect.stringMatching(/was saved to the candidate, but the run folder could not record it/),
      });
      const recorded = await json(join(runDir, "result.json"));
      expect(recorded).toMatchObject({
        status: "failed",
        candidate: { sha256: (await state("b")).candidate.sha256 },
      });
      expect(recorded).not.toHaveProperty("request");
      await rm(join(runDir, "requests"));
      await rename(join(runDir, "requests-kept"), join(runDir, "requests"));

      // The run folder is whole again: the next edit checks the candidate.
      const next = await edit("b", [{ op: "place", footprint: "R1", at: [130, 106] }]);
      expect(next.code, next.stdout).toBe(0);
      expect(next.doc.previews).toEqual(expect.arrayContaining(["previews/before-F_Cu.svg"]));
    });

    it("refuses an edit and a close while the candidate window has unsaved edits (REQ-REL-e30bf69f, REQ-REL-1dd5113a)", async () => {
      expect(nudge("move", "R4", "0.5").status).toBe(0);
      const before = await unchangedFiles("b");
      const done = await edit("b", [{ op: "place", footprint: "R3", at: [110, 124] }]);
      expect(done.code, done.stdout).toBe(2);
      expect(done.doc.problems[0]?.kind).toBe("changed");
      const closed = run(["close", "--run", "electronics-results/b"]);
      expect(closed.code, closed.stdout).toBe(2);
      expect(closed.doc.problems[0]?.kind).toBe("changed");
      expect(alive((await state("b")).editor.pid)).toBe(true);
      expect(await unchangedFiles("b")).toEqual(before);
      expect(nudge("revert").status).toBe(0);
      await sleep(1500);
      expect(JSON.parse(nudge("docs").stdout).memory).toBe((await state("b")).candidate.memorySha256);
    });

    it("reverts an edit that changed an item it did not name (REQ-FUNC-cd7d1b3f)", async () => {
      const before = await unchangedFiles("b");
      const done = await edit(
        "b",
        [{ op: "place", footprint: "R4", at: [114, 126] }],
        veraEnv({
          KICAD_LAYOUT_TEST_HOOK: join(hooks, "hook.py"),
          HOOK_POINT: "before-unchanged",
          HOOK_ACTION: "move-other",
        }),
      );
      expect(done.code, done.stdout).toBe(3);
      expect(done.doc.problems[0]?.kind).toBe("kicad");
      expect(await unchangedFiles("b")).toEqual(before);
      expect(JSON.parse(nudge("docs").stdout).memory).toBe((await state("b")).candidate.memorySha256);
    });

    it("fails an edit after which a footprint exists twice (REQ-FUNC-cd7d1b3f)", async () => {
      const before = await unchangedFiles("b");
      // A second client updates the placed footprint twice in one commit: KiCad then holds two copies with its
      // UUID, which only the counts reveal (the UUID comparison skips placed footprints).
      const done = await edit(
        "b",
        [{ op: "place", footprint: "R4", at: [114, 126] }],
        veraEnv({
          KICAD_LAYOUT_TEST_HOOK: join(hooks, "hook.py"),
          HOOK_POINT: "before-unchanged",
          HOOK_ACTION: "duplicate-placed",
          HOOK_REF: "R4",
        }),
      );
      expect(done.code, done.stdout).toBe(3);
      expect(done.doc.problems[0]).toMatchObject({
        kind: "kicad",
        message: expect.stringContaining("duplicated footprint"),
      });
      expect(await unchangedFiles("b")).toEqual(before);
      expect(JSON.parse(nudge("docs").stdout).memory).toBe((await state("b")).candidate.memorySha256);
    });

    it("keeps the candidate when an edit is stopped inside its commit after a move (REQ-REL-ea280836)", async () => {
      const before = await unchangedFiles("b");
      const marker = join(dir, "inside.txt");
      const child = spawn(
        uv ?? "uv",
        [
          "run",
          "--quiet",
          "--offline",
          "--script",
          tool,
          "edit",
          "--run",
          "electronics-results/b",
          "--json",
          request((await state("b")).candidate.sha256, [{ op: "place", footprint: "R3", at: [108, 122] }]),
        ],
        {
          cwd: dir,
          env: veraEnv({
            KICAD_LAYOUT_TEST_HOOK: join(hooks, "hook.py"),
            // After the first operation: the footprint has moved inside the open commit.
            HOOK_POINT: "after-operation",
            HOOK_ACTION: "sleep",
            HOOK_MARKER: marker,
          }),
        },
      );
      await expect.poll(() => existsSync(marker), { timeout: 120_000, interval: 500 }).toBe(true);
      killTree(child.pid ?? 0);
      await sleep(2000);
      expect(await unchangedFiles("b")).toEqual(before);
      const saved = await readFile(join(dir, "electronics-results/b/candidate/layout.kicad_pcb"), "utf8");
      const next = await edit("b", [{ op: "place", footprint: "R4", at: [114, 126] }]);
      expect([0, 2], next.stdout).toContain(next.code);
      if (next.code === 2) {
        expect(["changed", "binding"]).toContain(next.doc.problems[0]?.kind);
        expect(await readFile(join(dir, "electronics-results/b/candidate/layout.kicad_pcb"), "utf8")).toBe(
          saved,
        );
        // The window keeps KiCad's own state of the killed commit: revert it to the last save for the next tests.
        expect(nudge("revert").status).toBe(0);
        await sleep(1500);
      }
      expect((await footprint("b", "R3")).at).not.toEqual([108, 122]);
    });

    it("reports a lost connection without saving (REQ-REL-233d6e0f)", async () => {
      const before = await unchangedFiles("b");
      const done = await edit(
        "b",
        [{ op: "place", footprint: "R4", at: [114, 128] }],
        veraEnv({
          KICAD_LAYOUT_TEST_HOOK: join(hooks, "hook.py"),
          HOOK_POINT: "after-bind",
          HOOK_ACTION: "kill-editor",
        }),
      );
      expect(done.code, done.stdout).toBe(3);
      expect(done.doc.problems[0]?.kind).toBe("connection");
      expect(await unchangedFiles("b")).toEqual(before);
      const closed = run(["close", "--run", "electronics-results/b"]);
      expect(closed.code, closed.stdout).toBe(0);
    });

    it("refuses an edit or close of a run whose candidate is not the API's open board (REQ-SEC-438b7bbf)", async () => {
      expect(open("c").code).toBe(0);
      const docs = JSON.parse(nudge("docs").stdout);
      const done = await edit("a", [{ op: "place", footprint: "R4", at: [114, 126] }]);
      expect(done.code, done.stdout).toBe(2);
      expect(done.doc.problems[0]?.kind).toBe("binding");
      expect(JSON.parse(nudge("docs").stdout)).toEqual(docs);
      // a's editor is gone: close only removes its lock files and leaves c's window alone.
      const closedA = run(["close", "--run", "electronics-results/a"]);
      expect(closedA.code, closedA.stdout).toBe(0);
      expect(closedA.doc.note).toContain("already closed");
      expect(alive((await state("c")).editor.pid)).toBe(true);
      expect(JSON.parse(nudge("docs").stdout)).toEqual(docs);
      // A run whose recorded editor is c's window (a stale or tampered state.json): close connects and refuses.
      await cp(join(dir, "electronics-results/a"), join(dir, "electronics-results/a2"), { recursive: true });
      const a2 = await state("a2");
      await writeFile(
        join(dir, "electronics-results/a2/state.json"),
        JSON.stringify({ ...a2, editor: { pid: (await state("c")).editor.pid } }),
      );
      const closedA2 = run(["close", "--run", "electronics-results/a2"]);
      expect(closedA2.code, closedA2.stdout).toBe(2);
      expect(closedA2.doc.problems[0]?.kind).toBe("binding");
      expect(alive((await state("c")).editor.pid)).toBe(true);
      expect(JSON.parse(nudge("docs").stdout)).toEqual(docs);
      expect(run(["close", "--run", "electronics-results/c"]).code).toBe(0);
    });

    it("reopens an applied candidate with the reported board, and KiCad locks an open source (REQ-FUNC-73b4e5d0, REQ-SEC-e27836d3)", async () => {
      await mkdir(join(dir, "applied"));
      await cp(join(dir, "boards"), join(dir, "applied"), { recursive: true });
      await writeFile(
        join(dir, "applied/layout.kicad_pcb"),
        await readFile(join(dir, "electronics-results/a/candidate/layout.kicad_pcb")),
      );
      const done = open("g", "applied/layout.kicad_pcb");
      expect(done.code, done.stdout).toBe(0);
      const reopened = await board("g");
      const reported = await board("a");
      expect(reopened.footprints).toEqual(reported.footprints);
      expect(reopened.tracks).toBe(reported.tracks);
      expect(reopened.vias).toBe(reported.vias);
      const drcA = await json(join(dir, "electronics-results/a/drc-after.json"));
      const drcG = await json(join(dir, "electronics-results/g/drc-before.json"));
      expect(drcG.unconnected_items.length).toBe(drcA.unconnected_items.length);
      expect(drcG.violations.length).toBe(drcA.violations.length);
      expect(run(["close", "--run", "electronics-results/g"]).code).toBe(0);
      const editor = spawn(
        join(kicadCli, "..", windows ? "pcbnew.exe" : "pcbnew"),
        [join(dir, "applied/layout.kicad_pcb")],
        { stdio: "ignore" },
      );
      editors.push(editor.pid ?? 0);
      await expect
        .poll(() => existsSync(join(dir, "applied/~layout.kicad_pcb.lck")), {
          timeout: 60_000,
          interval: 500,
        })
        .toBe(true);
      killTree(editor.pid ?? 0);
    });
  },
);
