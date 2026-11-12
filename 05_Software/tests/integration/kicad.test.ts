// The kicad plugin. Default tests check the package, its catalog registration, the rules, the shared path module
// and the kicad-tool script on the toolchain's Python: refusals and the in-process seams of
// tests/fixtures/kicad/internals.py need no KiCad. The cases against the hand-derived fixtures
// (tests/fixtures/kicad/README.md) run the real KiCad 10 the helper finds and are skipped, with that reason, on a
// host without it. VERA_KICAD_UV names a real uv: the opt-in test provisions the plugin and runs it through the
// ProgramRunner.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("kicad/", plugins));
const scripts = join(source, "scripts");
const tool = join(scripts, "kicad_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/kicad/", import.meta.url));
// Unusual characters by code point: the formatter would turn their escapes into invisible raw characters.
const NBSP = String.fromCodePoint(0xa0);
const LONG_S = String.fromCodePoint(0x17f);
const internals = join(fixtures, "internals.py");
const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("kicad/plugin.yaml", plugins), "utf8"));

const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();

interface Problem {
  code: string;
  path: string;
  message: string;
}
interface Artifact {
  path: string;
  kind: string;
  bytes: number;
  sha256: string;
}
interface ToolDocument {
  format: number;
  tool: string;
  version: string;
  operation: string;
  status: string;
  runId: string;
  started: string;
  finished: string;
  kicad: { executable: string; version: string };
  project: {
    folder: string;
    name: string;
    files: Array<{ path: string; role: string; bytes: number; sha256: string; format?: number }>;
  };
  // biome-ignore lint/suspicious/noExplicitAny: each operation has its own summary shape (spec §6).
  summary: any;
  warnings: string[];
  limits: string[];
  artifacts: Artifact[];
  result: string;
  truncated: boolean;
  errors?: Problem[];
}

const STDOUT_LIMIT = 11_000;
const sourceEnv = () => ({ ...process.env, PYTHONDONTWRITEBYTECODE: "1" });
const settle = (result: ReturnType<typeof spawnSync>, label: string) => {
  const stdout = String(result.stdout);
  expect([0, 2, 3], `exit ${result.status}: ${String(result.stderr).slice(-800)}`).toContain(result.status);
  expect(stdout.length, label).toBeLessThanOrEqual(STDOUT_LIMIT);
  let doc: ToolDocument | undefined;
  try {
    doc = JSON.parse(stdout) as ToolDocument;
  } catch {
    doc = undefined;
  }
  return { code: result.status, stdout, stderr: String(result.stderr), doc };
};
/** Runs kicad-tool in `cwd`. */
const kt = (args: string[], cwd: string, env: NodeJS.ProcessEnv = sourceEnv()) =>
  settle(
    spawnSync(python, [tool, ...args], {
      cwd,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
    }),
    args.join(" "),
  );
/** Runs an internals.py seam in `cwd`. */
const seam = (command: string, args: string[], cwd: string) =>
  spawnSync(python, [internals, scripts, command, ...args], {
    cwd,
    encoding: "utf8",
    env: sourceEnv(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
const refusal = (run: ReturnType<typeof kt>, code: string, message: string | RegExp) => {
  expect(run.code, run.stdout).toBe(2);
  expect(run.doc?.status).toBe("refused");
  expect(run.doc?.errors?.map((error) => error.code)).toContain(code);
  const text = (run.doc?.errors ?? []).map((error) => error.message).join("\n");
  if (typeof message === "string") expect(text).toContain(message);
  else expect(text).toMatch(message);
};
/** The references KiCad itself gives the placed symbols: one per component of its netlist. */
async function kicadReferences(dir: string, project: string): Promise<string[]> {
  const run = kt(["netlist", "--project", project], dir);
  expect(run.code, run.stdout).toBe(0);
  const nets = run.doc?.artifacts.find((artifact) => artifact.path.endsWith("nets.json"))?.path as string;
  const data = JSON.parse(await readFile(join(dir, nets), "utf8")) as {
    components: Array<{ reference: string }>;
  };
  return data.components.map((component) => component.reference);
}

/** Every file below `dir` with its SHA-256, by relative path with `/`. */
async function hashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out[relative(dir, path).split(sep).join("/")] = sha256(await readFile(path));
    }
  };
  await walk(dir);
  return out;
}
/** A fresh workbench holding copies of the three fixture projects. */
async function workbench(name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `vera-kicad-${name}-`)));
  for (const project of ["hier", "erc", "board"])
    await cp(join(fixtures, project), join(dir, project), { recursive: true });
  return dir;
}
const results = async (dir: string) => {
  try {
    return await readdir(join(dir, "electronics-results"));
  } catch {
    return [];
  }
};

it("publishes the official kicad package, its pack and two installed skills", async () => {
  // REQ-FUNC-1ae67789, REQ-DATA-ece2d69c, REQ-UX-f366d2db
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "kicad",
    version: "1.0.0",
    ecosystem: "electronics",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(Object.keys(m.programs)).toEqual(["kicad-cli", "kicad-tool"]);
  expect(m.programs["kicad-cli"]?.install).toMatchObject({
    find: {
      windows: ["%PATH%", "%ProgramFiles%/KiCad/*/bin/kicad-cli.exe"],
      linux: ["$PATH", "/usr/bin/kicad-cli"],
    },
  });
  expect(m.programs["kicad-cli"]?.version).toEqual({
    args: ["version"],
    match: "^(\\d+\\.\\d+\\.\\d+)",
    range: ">=10.0,<11",
  });
  expect(m.programs["kicad-tool"]?.install).toEqual({ script: "scripts/kicad_tool.py" });
  expect(m.programs["kicad-tool"]?.version).toEqual({
    args: ["--version"],
    match: "^kicad-tool (\\d+\\.\\d+\\.\\d+)",
  });
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("kicad");
  expect(catalog.metadata.kicad.activities).toEqual(["design"]);
  expect(catalog.metadata.kicad.keywords).toEqual(
    expect.arrayContaining(["KiCad", "ERC", "DRC", "BOM", "Gerber"]),
  );
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs.find((pack: { id: string }) => pack.id === "electronics")?.groups).toContainEqual({
    name: "Schematic and PCB (KiCad)",
    plugins: ["kicad"],
    default: true,
  });
  expect(await core.checkCatalogSource(fileURLToPath(plugins))).toEqual([]);
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-skills-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("kicad");
    expect((await readdir(installed.folder)).sort()).toEqual([
      "README.md",
      "install.json",
      "plugin.yaml",
      "scripts",
      "skills",
    ]);
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const listed = (await skills.list()).filter((skill) => skill.plugin === "kicad");
    expect(listed.map((skill) => skill.name)).toEqual(["pcb-review", "schematic-review"]);
    const help = kt(["--help"], root).stdout;
    for (const name of ["schematic-review", "pcb-review"]) {
      const text = (await skills.read("plugin", name)).content;
      for (const phrase of ["kicad-tool", "--project", "fact", "hypothesis", "ERC", "result.json"])
        expect(text, `${name}: ${phrase}`).toContain(phrase);
      for (const operation of text.match(/kicad-tool ([a-z-]+)/g) ?? [])
        expect(help).toContain(operation.split(" ")[1]);
    }
    const schematic = (await skills.read("plugin", "schematic-review")).content;
    expect(schematic).toMatch(/electrical requirements/);
    const pcb = (await skills.read("plugin", "pcb-review")).content;
    expect(pcb).toMatch(/zero (DRC )?violations/i);
    expect(pcb).toMatch(/decoupling/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("lets kicad-tool run as a safe host program and blocks direct kicad-cli use (REQ-SEC-17f1e8d5)", async () => {
  const m = await manifest();
  const risk = (program: string, args: string[]) => classifyCommand(m.rules, program, args);
  for (const args of [
    ["--version"],
    ["--help"],
    ["inspect", "--project", "hier/hier.kicad_pro"],
    ["erc", "--project", "hier/hier.kicad_sch", "--run-id", "r1"],
    ["drc", "--project", "board/defects.kicad_pcb", "--refill-zones"],
    ["bom", "--project", "hier/hier.kicad_pro", "--results-dir", "out"],
    ["netlist", "--project", "hier/hier.kicad_pro"],
    ["export", "--project", "board/defects.kicad_pcb", "--kind", "gerbers", "--layers", "F.Cu,B.Cu"],
    ["review-report", "--project", "hier/hier.kicad_pro"],
  ])
    expect(risk("kicad-tool", args).risk, args.join(" ")).toBe("safe");
  expect(risk("kicad-tool", ["erc", "--project", "x.kicad_sch"]).notes.join(" ")).toMatch(/run folder/);
  for (const args of [["version"], ["--version"], ["--help"], ["version", "--format", "about"]])
    expect(risk("kicad-cli", args).risk, args.join(" ")).toBe("safe");
  for (const args of [
    ["pcb", "drc", "x.kicad_pcb", "--refill-zones", "--save-board"],
    ["jobset", "run", "x.kicad_jobset"],
    ["sch", "upgrade", "x.kicad_sch"],
    ["sch", "erc", "x.kicad_sch"],
  ]) {
    const verdict = risk("kicad-cli", args);
    expect(verdict.risk, args.join(" ")).toBe("blocked");
    expect(verdict.notes.join(" ")).toContain("kicad-tool");
  }
});

it("keeps the shared path module byte-identical in both electronics plugins (REQ-SEC-85467169)", async () => {
  const kicadCopy = await readFile(join(scripts, "kicad_support", "workspace.py"));
  const elecCopy = await readFile(
    fileURLToPath(new URL("electronics-calc/scripts/elec_support/workspace.py", plugins)),
  );
  expect(sha256(kicadCopy)).toBe(sha256(elecCopy));
});

describe("kicad-tool without KiCad", { timeout: 300_000 }, () => {
  let dir: string;
  beforeAll(async () => {
    dir = await workbench("plain");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints its version and refuses unusable command lines (REQ-DATA-c32834e3)", () => {
    const version = kt(["--version"], dir);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe("kicad-tool 1.0.0");
    for (const help of [["--help"], ["erc", "--help"], ["export", "--help"]]) {
      const shown = kt(help, dir);
      expect(shown.code, help.join(" ")).toBe(0);
      expect(shown.stdout).toContain("--project");
    }
    expect(kt(["export", "--help"], dir).stdout).toMatch(/gerbers[\s\S]*drill[\s\S]*pos/);
    refusal(kt(["simulate", "--project", "hier/hier.kicad_pro"], dir), "usage", "simulate");
    refusal(kt(["erc", "--proj", "hier/hier.kicad_sch"], dir), "usage", "--proj");
    refusal(
      kt(["erc", "--project", "hier/hier.kicad_sch", "--project", "erc/erc.kicad_sch"], dir),
      "usage",
      "--project",
    );
    refusal(kt(["erc"], dir), "usage", "--project");
    refusal(kt(["erc", "--project", "hier/hier.kicad_sch", "--run-id", "../x"], dir), "usage", "--run-id");
    refusal(kt(["erc", "--project", "hier/notes.txt"], dir), "path", ".kicad_pro");
  });

  it("confines --project and --results-dir to the working directory (REQ-SEC-85467169)", async () => {
    const outside = join(tmpdir(), "elsewhere.kicad_pro");
    for (const raw of [
      "../hier.kicad_pro",
      outside,
      "\\\\host\\share\\x.kicad_pro",
      "//host/share/x.kicad_pro",
      "hier/\u0001.kicad_pro",
    ])
      refusal(kt(["inspect", "--project", raw], dir), "path", /--project/);
    if (windows) {
      refusal(kt(["inspect", "--project", "NUL"], dir), "path", /--project/);
      const other = dir.toUpperCase().startsWith("C:") ? "D:\\x.kicad_pro" : "C:\\x.kicad_pro";
      refusal(kt(["inspect", "--project", other], dir), "path", /--project/);
    }
    for (const raw of ["../out", ".vera/results", ".VERA/x", "hier/hier.kicad_pro/x"])
      refusal(
        kt(["inspect", "--project", "hier/hier.kicad_pro", "--results-dir", raw], dir),
        "path",
        /--results-dir/,
      );
    refusal(kt(["inspect", "--project", "hier/missing.kicad_pro"], dir), "project", "missing.kicad_pro");
    expect(await results(dir)).toEqual([]);
  });

  it("refuses a project with a missing or malformed file before running KiCad (REQ-REL-c4b14f26)", async () => {
    const work = await workbench("broken");
    try {
      const before = await hashes(work);
      await rm(join(work, "hier", "channel.kicad_sch"));
      refusal(kt(["erc", "--project", "hier/hier.kicad_pro"], work), "project", "channel.kicad_sch");
      // A parenthesis that never closes: the file and the position of the open list are named.
      await writeFile(
        join(work, "erc", "block.kicad_sch"),
        '(kicad_sch\n\t(version 20260306)\n\t(uuid "x"\n',
      );
      refusal(
        kt(["erc", "--project", "erc/erc.kicad_pro"], work),
        "project",
        /block\.kicad_sch.*line 3, column 2/,
      );
      await writeFile(join(work, "erc", "block.kicad_sch"), '(kicad_sch (version 20260306) (uuid "x"))\n)\n');
      refusal(
        kt(["erc", "--project", "erc/erc.kicad_pro"], work),
        "project",
        /block\.kicad_sch.*line 2, column 1/,
      );
      const root = await readFile(join(fixtures, "erc", "erc.kicad_sch"), "utf8");
      await writeFile(
        join(work, "erc", "erc.kicad_sch"),
        root.replace('"block.kicad_sch"', '"../outside.kicad_sch"'),
      );
      await writeFile(join(work, "outside.kicad_sch"), '(kicad_sch (version 20260306) (uuid "o"))\n');
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", "outside the project folder");
      await writeFile(join(work, "board", "defects.kicad_pro"), "{ not json");
      refusal(kt(["drc", "--project", "board/defects.kicad_pro"], work), "project", "defects.kicad_pro");
      refusal(kt(["drc", "--project", "hier/hier.kicad_pro"], work), "project", /board/);
      refusal(kt(["erc", "--project", "board/clean.kicad_pcb"], work), "project", /schematic/);
      expect(await results(work)).toEqual([]);
      for (const name of ["hier/hier.kicad_sch", "hier/sub/monitor.kicad_sch", "board/defects.kicad_pcb"])
        expect((await hashes(work))[name], name).toBe(before[name]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("refuses KiCad 5 and newer-format files without converting them (REQ-REL-426ec335)", async () => {
    const work = await workbench("formats");
    try {
      await writeFile(
        join(work, "hier", "channel.kicad_sch"),
        "EESchema Schematic File Version 4\nEELAYER 30 0\n",
      );
      refusal(
        kt(["erc", "--project", "hier/hier.kicad_pro"], work),
        "project",
        /channel\.kicad_sch.*KiCad 5/,
      );
      const board = await readFile(join(fixtures, "board", "defects.kicad_pcb"), "utf8");
      await writeFile(
        join(work, "board", "defects.kicad_pcb"),
        board.replace("(version 20260206)", "(version 29991231)"),
      );
      const newer = await readFile(join(work, "board", "defects.kicad_pcb"));
      refusal(kt(["drc", "--project", "board/defects.kicad_pcb"], work), "project", /29991231.*newer KiCad/);
      expect(sha256(await readFile(join(work, "board", "defects.kicad_pcb")))).toBe(sha256(newer));
      // kicad-tool reads files from KiCad 8 on: KiCad 7's formats are refused.
      await writeFile(
        join(work, "board", "defects.kicad_pcb"),
        board.replace("(version 20260206)", "(version 20221018)"),
      );
      refusal(
        kt(["drc", "--project", "board/defects.kicad_pcb"], work),
        "project",
        /20221018.*older than KiCad 8.*save it/,
      );
      await cp(join(fixtures, "hier"), join(work, "hier"), { recursive: true });
      const sheet = await readFile(join(fixtures, "hier", "channel.kicad_sch"), "utf8");
      await writeFile(
        join(work, "hier", "channel.kicad_sch"),
        sheet.replace("(version 20260306)", "(version 20230121)"),
      );
      refusal(
        kt(["erc", "--project", "hier/hier.kicad_pro"], work),
        "project",
        /channel\.kicad_sch.*20230121.*older than KiCad 8/,
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("refuses unknown or misplaced export layers before plotting (REQ-REL-3fe4718a)", async () => {
    refusal(
      kt(
        [
          "export",
          "--project",
          "board/defects.kicad_pcb",
          "--kind",
          "gerbers",
          "--layers",
          "F.Cu,Nope.Layer",
        ],
        dir,
      ),
      "layer",
      "Nope.Layer",
    );
    refusal(
      kt(["export", "--project", "board/defects.kicad_pcb", "--kind", "gerbers"], dir),
      "usage",
      "--layers",
    );
    refusal(
      kt(["export", "--project", "board/defects.kicad_pcb", "--kind", "drill", "--layers", "F.Cu"], dir),
      "usage",
      "--layers",
    );
    refusal(kt(["export", "--project", "board/defects.kicad_pcb", "--kind", "step"], dir), "usage", "--kind");
    refusal(
      kt(["export", "--project", "hier/hier.kicad_pro", "--kind", "pcb-pdf", "--layers", "F.Cu"], dir),
      "project",
      /board/,
    );
    expect(await results(dir)).toEqual([]);
  });

  it("refuses when kicad-cli is missing or not KiCad 10 (REQ-REL-24dba971)", async () => {
    const missing = settle(
      seam("version", ["none", "erc", "--project", "hier/hier.kicad_pro"], dir),
      "missing",
    );
    refusal(
      missing as ReturnType<typeof kt>,
      "kicad",
      /not found[\s\S]*PATH[\s\S]*https:\/\/www\.kicad\.org\/download/,
    );
    const old = settle(seam("version", ["9.0.2", "erc", "--project", "hier/hier.kicad_pro"], dir), "old");
    refusal(old as ReturnType<typeof kt>, "kicad", /9\.0\.2[\s\S]*KiCad 10/);
    expect(await results(dir)).toEqual([]);
  });

  it("searches PATH first, then the newest KiCad install folder (REQ-FUNC-9383047c)", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-discover-")));
    try {
      const run = seam("discover", [root], root);
      expect(run.status, run.stderr).toBe(0);
      const found = JSON.parse(run.stdout) as {
        withPath: string;
        withoutPath: string;
        relativeEntry: string;
      };
      expect(found.relativeEntry).toBe(
        join(root, "Program Files", "KiCad", "10.0", "bin", windows ? "kicad-cli.exe" : "kicad-cli"),
      );
      const exe = windows ? "kicad-cli.exe" : "kicad-cli";
      expect(found.withPath).toBe(join(root, "path-entry", exe));
      expect(found.withoutPath).toBe(join(root, "Program Files", "KiCad", "10.0", "bin", exe));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a kicad-cli failure apart from violations and keeps nothing (REQ-REL-05743834)", async () => {
    const start = settle(
      seam("fail", ["missingexe", "drc", "--project", "board/defects.kicad_pcb"], dir),
      "missingexe",
    );
    expect(start.code, start.stdout).toBe(3);
    expect(start.doc?.errors?.[0]).toMatchObject({
      code: "run",
      message: expect.stringContaining("could not start"),
    });
    for (const mode of ["exit", "nooutput"]) {
      const run = settle(seam("fail", [mode, "drc", "--project", "board/defects.kicad_pcb"], dir), mode);
      expect(run.code, run.stdout).toBe(3);
      expect(run.doc?.status).toBe("failed");
      expect(run.doc?.errors?.[0]?.code).toBe("run");
      if (mode === "exit") expect(run.doc?.errors?.[0]?.message).toContain("Failed to load board");
    }
    expect(await results(dir)).toEqual([]);
  });

  it("fits every printed document into 11 000 UTF-16 units (REQ-REL-1ab91569)", () => {
    const run = seam("fit", [], dir);
    expect(run.status, run.stderr).toBe(0);
    const fit = JSON.parse(run.stdout);
    expect(fit.big.units).toBeLessThanOrEqual(STDOUT_LIMIT);
    expect(fit.big.truncated).toBe(true);
    expect(fit.big.violations).toBeLessThan(5000);
    expect(fit.big.counts).toEqual({ error: 5000 });
    expect(fit.small).toMatchObject({ truncated: false, violations: 1, counts: { error: 1 } });
    expect(fit.review.units).toBeLessThanOrEqual(STDOUT_LIMIT);
    expect(fit.review.truncated).toBe(true);
    expect(fit.review.erc).toEqual({ error: 3, warning: 1, exclusion: 0 });
    expect(fit.review.drc).toEqual({
      violations: { error: 2, warning: 0, exclusion: 0 },
      unconnected: 1,
      parity: 0,
    });
    expect(fit.review.counts).toEqual({ sheets: 1, instances: 400, nets: 400, footprints: 0 });
    expect(fit.review.duplicateCount).toBe(300);
  });

  it("refuses a project file that resolves outside the project folder (REQ-SEC-85467169)", async () => {
    const work = await workbench("linkout");
    const outside = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-outside-")));
    try {
      await cp(join(work, "board", "defects.kicad_pcb"), join(outside, "defects.kicad_pcb"));
      const before = await hashes(outside);
      const seamed = seam(
        "linkout",
        [
          "board/defects.kicad_pcb",
          join(outside, "defects.kicad_pcb"),
          "drc",
          "--project",
          "board/defects.kicad_pro",
        ],
        work,
      );
      refusal(settle(seamed, "linkout") as ReturnType<typeof kt>, "project", "outside the project folder");
      let linked = false;
      try {
        await rm(join(work, "board", "defects.kicad_pcb"));
        await symlink(join(outside, "defects.kicad_pcb"), join(work, "board", "defects.kicad_pcb"), "file");
        linked = true;
      } catch {
        console.warn("kicad.test.ts: this account cannot create file links; the real-link case is skipped.");
      }
      if (linked)
        refusal(
          kt(["drc", "--project", "board/defects.kicad_pro"], work),
          "project",
          "outside the project folder",
        );
      expect(await hashes(outside)).toEqual(before);
      expect(await results(work)).toEqual([]);
    } finally {
      await rm(work, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("answers oversized and malformed input with a bounded refusal, never a traceback (REQ-REL-1ab91569, REQ-REL-c4b14f26)", async () => {
    const work = await workbench("bounds");
    try {
      refusal(
        kt(
          [
            "inspect",
            "--project",
            "hier/hier.kicad_pro",
            ...Array.from({ length: 4 }, () => "y".repeat(4000)),
          ],
          work,
        ),
        "usage",
        /unrecognized/,
      );
      refusal(
        kt(["drc", "--project", "board/defects.kicad_pro", "--refill-zones", "--refill-zones"], work),
        "usage",
        "--refill-zones",
      );
      const root = await readFile(join(fixtures, "erc", "erc.kicad_sch"), "utf8");
      await writeFile(
        join(work, "erc", "erc.kicad_sch"),
        root
          .replace('(property "Sheetname" "blk1"', `(property "Sheetname" "${"S".repeat(12_000)}"`)
          .replaceAll('"block.kicad_sch"', '"gone.kicad_sch"'),
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", "gone.kicad_sch");
      await writeFile(join(work, "erc", "erc.kicad_sch"), `(kicad_sch${"X".repeat(12_000)})\n`);
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /not a KiCad schematic/);
      await writeFile(
        join(work, "board", "defects.kicad_pro"),
        `${"[".repeat(100_000)}${"]".repeat(100_000)}`,
      );
      refusal(kt(["drc", "--project", "board/defects.kicad_pro"], work), "project", "defects.kicad_pro");
      await writeFile(join(work, "board", "defects.kicad_pro"), `{"x": ${"9".repeat(5000)}}`);
      refusal(kt(["drc", "--project", "board/defects.kicad_pro"], work), "project", "defects.kicad_pro");
      await cp(join(fixtures, "board", "defects.kicad_pro"), join(work, "board", "defects.kicad_pro"));
      const board = await readFile(join(fixtures, "board", "defects.kicad_pcb"), "utf8");
      await writeFile(
        join(work, "board", "defects.kicad_pcb"),
        board.replace('(0 "F.Cu" signal)', '(inf "F.Cu" signal)'),
      );
      refusal(
        kt(
          ["export", "--project", "board/defects.kicad_pcb", "--kind", "gerbers", "--layers", "Nope.Layer"],
          work,
        ),
        "layer",
        "Nope.Layer",
      );
      // 13 levels of two sheets each: 8191 sheet instances.
      await mkdir(join(work, "deep"));
      for (let level = 0; level <= 12; level += 1) {
        const sheets =
          level === 12
            ? ""
            : ["a", "b"]
                .map(
                  (name) =>
                    `(sheet (uuid "${name}${level}") (property "Sheetname" "${name}") (property "Sheetfile" "l${level + 1}.kicad_sch"))`,
                )
                .join(" ");
        await writeFile(
          join(work, "deep", `l${level}.kicad_sch`),
          `(kicad_sch (version 20260306) (uuid "u${level}") ${sheets})\n`,
        );
      }
      refusal(kt(["erc", "--project", "deep/l0.kicad_sch"], work), "project", /4096 sheet instances/);
      const absolute = await readFile(join(fixtures, "erc", "erc.kicad_sch"), "utf8");
      await writeFile(
        join(work, "erc", "erc.kicad_sch"),
        absolute.replaceAll('"block.kicad_sch"', JSON.stringify(join(work, "erc", "block.kicad_sch"))),
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /absolute path/);
      await writeFile(
        join(work, "erc", "erc.kicad_sch"),
        absolute.replaceAll('"block.kicad_sch"', '"../erc/block.kicad_sch"'),
      );
      refusal(
        kt(["erc", "--project", "erc/erc.kicad_pro"], work),
        "project",
        /climbs above the project folder/,
      );
      await writeFile(
        join(work, "erc", "erc.kicad_sch"),
        absolute.replaceAll('"block.kicad_sch"', '"~/block.kicad_sch"'),
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /home folder/);
      await writeFile(join(work, "erc", "erc.kicad_sch"), absolute);
      await writeFile(
        join(work, "erc", "sym-lib-table"),
        '(sym_lib_table (version 7) (lib (name "net") (type "KiCad") (uri "//host/share/x.kicad_sym") (options "") (descr "")))\n',
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /network or device path/);
      const ercProject = JSON.parse(await readFile(join(fixtures, "erc", "erc.kicad_pro"), "utf8"));
      for (const [variables, uri] of [
        [{ MYLIB: "//host/share" }, "${MYLIB}/x.kicad_sym"],
        [{ MYLIB: "\\\\host\\share" }, "$(MYLIB)/x.kicad_sym"],
        [{ A: "/", B: "/host/share" }, "${A}${B}/x.kicad_sym"],
        [{ OUTER: "${INNER}/x", INNER: "//host/share" }, "${OUTER}.kicad_sym"],
      ] as const) {
        await writeFile(
          join(work, "erc", "erc.kicad_pro"),
          JSON.stringify({ ...ercProject, text_variables: variables }),
        );
        await writeFile(
          join(work, "erc", "sym-lib-table"),
          `(sym_lib_table (version 7) (lib (name "net") (type "KiCad") (uri "${uri.replaceAll("\\", "\\\\")}") (options "") (descr "")))\n`,
        );
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /network or device path/);
      }
      await cp(join(fixtures, "erc", "sym-lib-table"), join(work, "erc", "sym-lib-table"));
      await writeFile(
        join(work, "erc", "erc.kicad_pro"),
        JSON.stringify({
          ...ercProject,
          text_variables: { WKS: "//host/share" },
          schematic: { page_layout_descr_file: "${WKS}/frame.kicad_wks" },
        }),
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /network or device path/);
      await cp(join(fixtures, "erc", "erc.kicad_pro"), join(work, "erc", "erc.kicad_pro"));
      for (const [variables, message] of [
        [{ KIPRJMOD: "elsewhere" }, /redefines.*KIPRJMOD/],
        [{ KICAD10_SYMBOL_DIR: "lib" }, /redefines.*KICAD10_SYMBOL_DIR/],
        [{ kisys3d: "x" }, /redefines.*kisys3d/],
        [{ DEV: "\\\\?\\D:\\x" }, /DEV.*network or device path/],
        [{ SHARE: "//host/share" }, /SHARE.*network or device path/],
        // A global table's `${V}/x` gives `//x` for V = "/", and KiCad expands variables inside values.
        [{ S: "/" }, /'S'.*network or device path/],
        [{ S: " \\ " }, /'S'.*network or device path/],
        [{ MYLIBS: "${S}/./pipe/x" }, /MYLIBS.*network or device path/],
        [{ MYLIBS: "/%S" }, /MYLIBS.*network or device path/],
        [{ MYLIBS: "%S%/x" }, /MYLIBS.*network or device path/],
        // KiCad reads a name or value only up to a NUL: these are KIPRJMOD = "/" and V = "/" to it.
        [{ "KIPRJMOD\u0000x": "/\u0000x" }, /NUL character/],
        [{ V: "/\u0000x" }, /NUL character/],
      ] as const) {
        await writeFile(
          join(work, "erc", "erc.kicad_pro"),
          JSON.stringify({ ...ercProject, text_variables: variables }),
        );
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", message);
      }
      for (const uri of [
        "${MYLIB}/x.kicad_sym",
        "$(MYLIB)/x.kicad_sym",
        "$MYLIB/x.kicad_sym",
        "%MYLIB%/x.kicad_sym",
        "%mylib%/x.kicad_sym",
      ]) {
        await writeFile(
          join(work, "erc", "erc.kicad_pro"),
          JSON.stringify({ ...ercProject, text_variables: { MYLIB: "libs" } }),
        );
        await writeFile(
          join(work, "erc", "sym-lib-table"),
          `(sym_lib_table (version 7) (lib (name "var") (type "KiCad") (uri "${uri}") (options "") (descr "")))\n`,
        );
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /through a variable/);
      }
      // Spellings a variable scanner would miss: non-ASCII names, nested and unclosed references, empty values.
      for (const uri of [
        "/$Xé/./D:/x.kicad_sym",
        "${E$X}/x.kicad_sym",
        "%E//?/D:/x.kicad_sym",
        "${E//?/D:/x.kicad_sym",
        "$(E//?/D:/x.kicad_sym",
        "$Eé//?/D:/x.kicad_sym",
        "${KIPRJMOD}/$E/x.kicad_sym",
      ]) {
        await writeFile(
          join(work, "erc", "erc.kicad_pro"),
          JSON.stringify({ ...ercProject, text_variables: { E: "", Xé: "", X: "" } }),
        );
        await writeFile(
          join(work, "erc", "sym-lib-table"),
          `(sym_lib_table (version 7) (lib (name "var") (type "KiCad") (uri "${uri}") (options "") (descr "")))\n`,
        );
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /through a variable/);
      }
      await writeFile(
        join(work, "erc", "sym-lib-table"),
        '(sym_lib_table (version 7) (lib (name "web") (type "HTTP") (uri "${KIPRJMOD}/parts.kicad_httplib") (options "") (descr "")))\n',
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /type 'HTTP'/);
      // Only KiCad's own library files; KiCad uses an entry's last type and uri, so every one is checked; a library
      // table is read without escapes, as KiCad 10 reads it.
      const fixtureTable = await readFile(join(fixtures, "erc", "sym-lib-table"), "utf8");
      for (const [lib, message] of [
        ['(type "Table") (uri "${KIPRJMOD}/nested-table")', /type 'Table'/],
        ['(type "Legacy") (uri "${KIPRJMOD}/old.lib")', /type 'Legacy'/],
        ['(uri "${KIPRJMOD}/fixture.kicad_sym")', /type ''/],
        ['(type "KiCad") (type "HTTP") (uri "${KIPRJMOD}/fixture.kicad_sym")', /type 'HTTP'/],
        [
          '(type "KiCad") (uri "${KIPRJMOD}/fixture.kicad_sym") (uri "//host/share/x.kicad_sym")',
          /network or device path/,
        ],
        ['(type "KiCad") (uri "\\\\?\\D:\\x.kicad_sym")', /network or device path/],
        // KiCad keeps a quote inside an unquoted word, so this entry is no string to it but a second library.
        [
          '(type "KiCad") (uri "${KIPRJMOD}/fixture.kicad_sym") (descr x"))\n\t(lib (name "f2") (type "KiCad") (uri "//host/share/x.kicad_sym") (descr y")',
          /network or device path/,
        ],
        ['(type "KiCad") (uri\u00a0"${KIPRJMOD}/fixture.kicad_sym")', /U\+00A0 outside a quoted string/],
      ] as const) {
        await writeFile(
          join(work, "erc", "sym-lib-table"),
          fixtureTable.replace(/\(type "KiCad"\) \(uri "[^"]*"\)/, lib),
        );
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", message);
      }
      await cp(join(fixtures, "erc", "sym-lib-table"), join(work, "erc", "sym-lib-table"));
      // Windows' NT prefix \??\ (any slashes) opens a device or, through \??\UNC\, a host.
      for (const sheet of ["\\??\\pipe\\x.kicad_wks", "/??/UNC/host/share/x.kicad_wks"]) {
        await writeFile(
          join(work, "erc", "erc.kicad_pro"),
          JSON.stringify({ ...ercProject, pcbnew: { page_layout_descr_file: sheet } }),
        );
        refusal(
          kt(["erc", "--project", "erc/erc.kicad_pro"], work),
          "project",
          /drawing sheet on a network or device path/,
        );
      }
      await writeFile(
        join(work, "erc", "erc.kicad_pro"),
        JSON.stringify({ ...ercProject, text_variables: { NT: "\\??\\UNC\\host\\share" } }),
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /'NT'.*network or device path/);
      for (const sheet of ["${WKS}/frame.kicad_wks", "%E//?/D:/frame.kicad_wks"]) {
        await writeFile(
          join(work, "erc", "erc.kicad_pro"),
          JSON.stringify({
            ...ercProject,
            text_variables: { WKS: "frames", E: "" },
            schematic: { page_layout_descr_file: sheet },
          }),
        );
        refusal(
          kt(["erc", "--project", "erc/erc.kicad_pro"], work),
          "project",
          /drawing sheet.*through a variable/,
        );
      }
      // ERC's simulation model check opens every model file (and what it includes) unless it is exactly "ignore";
      // JSON with a repeated key could read differently in KiCad, so it is refused.
      for (const severity of ["error", "Ignore"]) {
        await writeFile(
          join(work, "erc", "erc.kicad_pro"),
          JSON.stringify({ ...ercProject, erc: { rule_severities: { simulation_model_issue: severity } } }),
        );
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /simulation model check/);
        refusal(
          kt(["review-report", "--project", "erc/erc.kicad_pro"], work),
          "project",
          /simulation model check/,
        );
      }
      await writeFile(
        join(work, "erc", "erc.kicad_pro"),
        '{"erc": {"rule_severities": {"simulation_model_issue": "error", "simulation_model_issue": "ignore"}}}',
      );
      refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /repeated key/);
      await cp(join(fixtures, "erc", "erc.kicad_pro"), join(work, "erc", "erc.kicad_pro"));
      // KiCad takes a sheet's first file property under any case of Sheetfile or "Sheet file", undoes hex and octal
      // escapes, and skips lines starting with '#' (all observed with KiCad 10.0.8).
      const sheetFile = '(property "Sheetfile" "block.kicad_sch"';
      for (const [variant, message] of [
        [
          absolute.replace(sheetFile, `(property "Sheet file" "//host/share/x.kicad_sch")\n\t\t${sheetFile}`),
          /\/\/host\/share\/x\.kicad_sch.*absolute path/,
        ],
        [
          absolute.replace(sheetFile, `(property "SHEETFILE" "missing.kicad_sch")\n\t\t${sheetFile}`),
          /missing\.kicad_sch.*does not exist/,
        ],
        [
          absolute.replace('"block.kicad_sch"', '"\\x2f\\x2fhost/share/x.kicad_sch"'),
          /\/\/host\/share\/x\.kicad_sch.*absolute path/,
        ],
        [
          absolute.replace('"block.kicad_sch"', '"\\057\\057host/share/x.kicad_sch"'),
          /\/\/host\/share\/x\.kicad_sch.*absolute path/,
        ],
        [
          absolute.replace(
            "\n\t(sheet\n",
            '\n# "\n\t(sheet (uuid "00000000-0000-0000-0000-0000000000bb") (property "Sheetname" "hidden") (property "Sheetfile" "//host/share/x.kicad_sch"))\n# "\n\t(sheet\n',
          ),
          /\/\/host\/share\/x\.kicad_sch.*absolute path/,
        ],
        // KiCad's token rules: a quote inside an unquoted word stays in it, NUL is a blank (also before '#'),
        // other control and Unicode space characters outside strings are refused.
        [
          absolute.replace(
            "\n\t(sheet\n",
            '\n\t(text x" (at 0 0 0))\n\t(sheet (uuid "00000000-0000-0000-0000-0000000000bb") (property "Sheetname" "hidden") (property "Sheetfile" "//host/share/x.kicad_sch"))\n\t(text y" (at 0 0 0))\n\t(sheet\n',
          ),
          /\/\/host\/share\/x\.kicad_sch.*absolute path/,
        ],
        [
          absolute.replace(
            sheetFile,
            `\u0000# (property "Sheetfile" "block.kicad_sch")\n\t\t(property "Sheetfile" "//host/share/x.kicad_sch"`,
          ),
          /\/\/host\/share\/x\.kicad_sch.*absolute path/,
        ],
        [
          absolute.replace("\n\t(sheet\n", `\n\t(text x${NBSP}" (at 0 0 0))\n\t(sheet\n`),
          /U\+00A0 outside a quoted string/,
        ],
        [
          absolute.replace("\n\t(sheet\n", '\n\t(text x\u000b" (at 0 0 0))\n\t(sheet\n'),
          /U\+000B outside a quoted string/,
        ],
        // Only ASCII letter case: KiCad ignores a look-alike name such as U+017F.
        [
          absolute.replace(
            sheetFile,
            `(property "${LONG_S}heetfile" "block.kicad_sch")\n\t\t(property "Sheetfile" "//host/share/x.kicad_sch"`,
          ),
          /\/\/host\/share\/x\.kicad_sch.*absolute path/,
        ],
        [absolute.replace('"block.kicad_sch"', '"b\\xC3\\xA9.kicad_sch"'), /escapes a byte above 0x7F/],
        [absolute.replace('"block.kicad_sch"', '"block\n.kicad_sch"'), /never ends on its line/],
      ] as const) {
        await writeFile(join(work, "erc", "erc.kicad_sch"), variant);
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", message);
      }
      await cp(join(fixtures, "erc", "sym-lib-table"), join(work, "erc", "sym-lib-table"));
      await cp(join(fixtures, "erc", "erc.kicad_pro"), join(work, "erc", "erc.kicad_pro"));
      for (const sheet of [
        "${X}/block.kicad_sch",
        "$(X)/block.kicad_sch",
        "$X/block.kicad_sch",
        "%X%/block.kicad_sch",
        "${A{B}}/block.kicad_sch",
        "a$b/block.kicad_sch",
      ]) {
        await writeFile(
          join(work, "erc", "erc.kicad_sch"),
          absolute.replaceAll('"block.kicad_sch"', JSON.stringify(sheet)),
        );
        refusal(kt(["erc", "--project", "erc/erc.kicad_pro"], work), "project", /through a variable/);
      }
      await writeFile(join(work, "erc", "erc.kicad_sch"), absolute);
      await writeFile(
        join(work, "board", "defects.kicad_pro"),
        '{"net_settings": {"classes": [{"name": "Default", "clearance": NaN}]}}',
      );
      refusal(kt(["drc", "--project", "board/defects.kicad_pro"], work), "project", /NaN or Infinity/);
      await writeFile(
        join(work, "board", "defects.kicad_pro"),
        '{"net_settings": {"classes": [{"name": "Default", "clearance": 1e999}]}}',
      );
      refusal(kt(["drc", "--project", "board/defects.kicad_pro"], work), "project", /NaN or Infinity/);
      await cp(join(fixtures, "board", "defects.kicad_pro"), join(work, "board", "defects.kicad_pro"));
      await writeFile(
        join(work, "board", "fp-lib-table"),
        `(fp_lib_table (version 7)${" ".repeat(2 * 1024 * 1024)})\n`,
      );
      const limited = settle(
        seam("limit", [String(1024 * 1024), "drc", "--project", "board/clean.kicad_pcb"], work),
        "limit",
      );
      refusal(limited as ReturnType<typeof kt>, "project", /fp-lib-table.*larger than 1 MiB/);
      expect(await results(work)).toEqual([]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});

const located = (() => {
  const run = spawnSync(python, [internals, scripts, "locate"], { encoding: "utf8", env: sourceEnv() });
  try {
    return JSON.parse(run.stdout) as { executable: string; version: string } | null;
  } catch {
    return null;
  }
})();
const kicad10 = located?.version.startsWith("10.") === true;
if (!kicad10) console.warn("kicad.test.ts: no KiCad 10 kicad-cli found; the real-KiCad cases are skipped.");

describe.skipIf(!kicad10)("kicad-tool with the real KiCad 10", { timeout: 600_000 }, () => {
  let dir: string;
  let pristine: Record<string, string>;
  beforeAll(async () => {
    dir = await workbench("real");
    pristine = await hashes(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const sources = async () => {
    const now = await hashes(dir);
    for (const key of Object.keys(now)) if (key.startsWith("electronics-results/")) delete now[key];
    return now;
  };
  const ok = (args: string[]) => {
    const run = kt(args, dir);
    expect(run.code, `${run.stdout.slice(0, 2000)}\n${run.stderr.slice(-1000)}`).toBe(0);
    expect(run.doc?.status).toBe("completed");
    return run.doc as ToolDocument;
  };
  const full = async (doc: ToolDocument): Promise<ToolDocument> =>
    JSON.parse(await readFile(join(dir, doc.result), "utf8"));

  it("returns one format-1 document per operation with the project files and KiCad (REQ-DATA-c32834e3)", async () => {
    const doc = ok(["erc", "--project", "hier/hier.kicad_pro", "--run-id", "doc-1"]);
    expect(Object.keys(doc).sort()).toEqual(
      [
        "artifacts",
        "finished",
        "format",
        "kicad",
        "limits",
        "operation",
        "project",
        "result",
        "runId",
        "started",
        "status",
        "summary",
        "tool",
        "truncated",
        "version",
        "warnings",
      ].sort(),
    );
    expect(doc).toMatchObject({
      format: 1,
      tool: "kicad-tool",
      version: "1.0.0",
      operation: "erc",
      runId: "doc-1",
      truncated: false,
    });
    expect(doc.kicad.version).toBe(located?.version);
    expect(doc.kicad.executable).toBe(located?.executable);
    expect(doc.result).toBe("electronics-results/doc-1/result.json");
    expect(doc.project).toMatchObject({ folder: "hier", name: "hier" });
    const roles = Object.fromEntries(doc.project.files.map((file) => [file.path, file.role]));
    expect(roles).toEqual({
      "hier/hier.kicad_pro": "project",
      "hier/hier.kicad_sch": "schematic",
      "hier/channel.kicad_sch": "sheet",
      "hier/sub/monitor.kicad_sch": "sheet",
      "hier/sub/probe.kicad_sch": "sheet",
      "hier/sym-lib-table": "library-table",
      "hier/fp-lib-table": "library-table",
      "hier/fixture.kicad_sym": "library",
      ...Object.fromEntries(
        [
          "C_0805",
          "Conn_2_THT",
          "LED_0603",
          "MountingHole_3.2mm",
          "R_0603",
          "R_0805",
          "SOT-23",
          "TestPoint",
        ].map((fp) => [`hier/fixture.pretty/${fp}.kicad_mod`, "library"]),
      ),
    });
    for (const file of doc.project.files) expect(file.sha256, file.path).toBe(pristine[file.path]);
    expect(doc.project.files.find((file) => file.path === "hier/hier.kicad_sch")?.format).toBe(20260306);
    const stored = await full(doc);
    expect(stored.summary).toEqual(doc.summary);
    expect((await readdir(join(dir, "electronics-results", "doc-1"))).sort()).toEqual([
      "erc.json",
      "report.md",
      "result.json",
    ]);
  });

  it("reads the hierarchy, symbol instances and nets of a project (REQ-FUNC-57feb0b5, REQ-DATA-5ff34212)", async () => {
    const doc = await full(ok(["inspect", "--project", "hier/hier.kicad_pro"]));
    expect(
      doc.summary.hierarchy.map((sheet: { path: string; file: string }) => [sheet.path, sheet.file]),
    ).toEqual([
      ["/", "hier/hier.kicad_sch"],
      ["/ch1/", "hier/channel.kicad_sch"],
      ["/ch2/", "hier/channel.kicad_sch"],
      ["/monitor/", "hier/sub/monitor.kicad_sch"],
      ["/monitor/probe/", "hier/sub/probe.kicad_sch"],
    ]);
    const instances = doc.summary.instances as Array<
      Record<string, unknown> & { reference: string; uuidPath: string }
    >;
    expect(instances).toHaveLength(17);
    expect(instances.map((instance) => instance.reference).sort()).toEqual(
      [
        "C1",
        "C10",
        "C2",
        "C3",
        "D101",
        "D201",
        "H1",
        "J1",
        "J2",
        "R101",
        "R102",
        "R201",
        "R202",
        "R401",
        "R402",
        "TP501",
        "U1",
      ].sort(),
    );
    const byRef = Object.fromEntries(instances.map((instance) => [instance.reference, instance]));
    // The repeated channel sheet: one symbol UUID, two sheet paths, two references.
    const [r101, r201] = [byRef.R101, byRef.R201] as unknown as Array<{
      uuidPath: string;
      sheetPath: string;
    }>;
    expect(r101?.uuidPath.split("/").at(-1)).toBe(r201?.uuidPath.split("/").at(-1));
    expect(r101?.uuidPath).not.toBe(r201?.uuidPath);
    expect([r101?.sheetPath, r201?.sheetPath]).toEqual(["/ch1/", "/ch2/"]);
    expect(byRef.R101).toMatchObject({
      value: "1k",
      footprint: "fixture:R_0603",
      libId: "fixture:R",
      mpn: "FX-R0603-1K",
      dnp: false,
    });
    expect(byRef.J1).toMatchObject({ mpn: null });
    expect(byRef.C3).toMatchObject({ dnp: true, excludeFromBom: false });
    expect(byRef.H1).toMatchObject({ excludeFromBom: true, dnp: false });
    expect(byRef.TP501).toMatchObject({ sheetPath: "/monitor/probe/" });
    const nets = Object.fromEntries(
      (doc.summary.nets as Array<{ name: string; nodes: Array<{ reference: string; pin: string }> }>).map(
        (net) => [net.name, net.nodes.map((node) => `${node.reference}.${node.pin}`).sort()],
      ),
    );
    expect(nets).toEqual({
      "+3V3": ["C10.1", "C2.1", "C3.1", "R401.1", "U1.2"],
      "+5V": ["C1.1", "J1.1", "U1.3"],
      GND: [
        "C1.2",
        "C10.2",
        "C2.2",
        "C3.2",
        "D101.1",
        "D201.1",
        "J1.2",
        "R102.2",
        "R202.2",
        "R402.2",
        "U1.1",
      ],
      "/EN_A": ["J2.1", "R101.1", "R102.1"],
      "/EN_B": ["J2.2", "R201.1", "R202.1"],
      "/ch1/LED": ["D101.2", "R101.2"],
      "/ch2/LED": ["D201.2", "R201.2"],
      "/monitor/MID": ["R401.2", "R402.1", "TP501.1"],
    });
    expect(doc.summary.board).toBeNull();
  });

  it("writes the KiCad netlist and normalized nets (REQ-FUNC-c2f97c86)", async () => {
    const doc = ok(["netlist", "--project", "hier/hier.kicad_pro", "--run-id", "net-1"]);
    expect(doc.artifacts.map((artifact) => artifact.path).sort()).toEqual([
      "electronics-results/net-1/netlist.net",
      "electronics-results/net-1/nets.json",
      "electronics-results/net-1/report.md",
      "electronics-results/net-1/result.json",
    ]);
    const netlist = await readFile(join(dir, "electronics-results/net-1/netlist.net"), "utf8");
    expect(netlist.trimStart().startsWith("(export")).toBe(true);
    const nets = JSON.parse(await readFile(join(dir, "electronics-results/net-1/nets.json"), "utf8"));
    expect(nets.nets.map((net: { name: string }) => net.name).sort()).toEqual(
      ["+3V3", "+5V", "/EN_A", "/EN_B", "/ch1/LED", "/ch2/LED", "/monitor/MID", "GND"].sort(),
    );
    const en = nets.nets.find((net: { name: string }) => net.name === "/EN_A");
    expect(en.nodes).toContainEqual({ reference: "R101", pin: "1", pinFunction: "~_1", pinType: "passive" });
    expect(
      nets.components.find((component: { reference: string }) => component.reference === "R201").instances,
    ).toHaveLength(1);
  });

  it("writes a normalized BOM grouped by value, footprint, MPN and DNP (REQ-DATA-1adc8a2b)", async () => {
    const doc = ok(["bom", "--project", "hier/hier.kicad_pro", "--run-id", "bom-1"]);
    const csv = (await readFile(join(dir, "electronics-results/bom-1/bom.csv"), "utf8"))
      .trim()
      .split(/\r?\n/);
    expect(csv).toEqual([
      "Quantity,References,Value,Footprint,MPN,DNP",
      '3,"C1,C2,C10",10uF,fixture:C_0805,FX-C0805-10U,',
      "1,C3,10uF,fixture:C_0805,FX-C0805-10U,yes",
      '2,"D101,D201",LED_G,fixture:LED_0603,FX-LED-G,',
      "1,J1,PWR_IN,fixture:Conn_2_THT,,",
      "1,J2,EN_IN,fixture:Conn_2_THT,,",
      '2,"R101,R201",1k,fixture:R_0603,FX-R0603-1K,',
      '2,"R102,R202",100k,fixture:R_0603,FX-R0603-100K,',
      '2,"R401,R402",10k,fixture:R_0603,FX-R0603-10K,',
      "1,TP501,TP,fixture:TestPoint,,",
      "1,U1,LDO_3V3,fixture:SOT-23,FX-LDO33,",
    ]);
    const bom = JSON.parse(await readFile(join(dir, "electronics-results/bom-1/bom.json"), "utf8"));
    expect(bom.excluded.map((instance: { reference: string }) => instance.reference)).toEqual(["H1"]);
    expect(bom.instances).toHaveLength(17);
    expect(doc.summary.counts).toEqual({ rows: 10, instances: 16, excluded: 1 });
  });

  it("reports planted ERC defects with their sheets, objects and severities (REQ-FUNC-25b51df0, REQ-FUNC-0bf83952)", async () => {
    const clean = ok(["erc", "--project", "hier/hier.kicad_pro"]);
    expect(clean.summary.counts).toEqual({ error: 0, warning: 0, exclusion: 0 });
    const doc = ok(["erc", "--project", "erc/erc.kicad_pro", "--run-id", "erc-1"]);
    expect(doc.summary.counts).toEqual({ error: 6, warning: 2, exclusion: 0 });
    expect(doc.summary.types).toEqual({
      power_pin_not_driven: 1,
      wire_dangling: 1,
      unconnected_wire_endpoint: 2,
      pin_not_connected: 1,
      pin_not_driven: 2,
      pin_to_pin: 1,
    });
    const found = (
      doc.summary.violations as Array<{
        type: string;
        severity: string;
        sheet: { path: string };
        items: Array<{ reference?: string; x: number; y: number }>;
      }>
    ).map((violation) =>
      [
        violation.sheet.path,
        violation.type,
        violation.severity,
        violation.items.map((item) => item.reference ?? "-").join("+"),
      ].join(" "),
    );
    expect(found.sort()).toEqual(
      [
        "/ power_pin_not_driven error #PWR105",
        "/ wire_dangling error -",
        "/ unconnected_wire_endpoint warning -",
        "/ unconnected_wire_endpoint warning -",
        "/blk1/ pin_not_connected error U101",
        "/blk1/ pin_not_driven error U101",
        "/blk2/ pin_not_driven error U201",
        "/blk1/ pin_to_pin error U101+U201",
      ].sort(),
    );
    const wire = doc.summary.violations.find(
      (violation: { type: string }) => violation.type === "wire_dangling",
    );
    expect(wire.items[0]).toMatchObject({ x: 127, y: 76.2 });
    expect(doc.summary.ignoredChecks).toContain("simulation_model_issue");
    expect(doc.summary.duplicateReferences).toMatchObject([
      { reference: "R1", unit: 1, count: 2, sheets: ["/", "/"] },
    ]);
    expect(clean.summary.duplicateReferences).toEqual([]);
    expect(doc.summary.duplicateCount).toBe(1);
    const [duplicate] = doc.summary.duplicateReferences as Array<{ uuidPaths: string[] }>;
    expect(duplicate?.uuidPaths).toHaveLength(2);
    expect(new Set(duplicate?.uuidPaths).size).toBe(2);
    for (const path of duplicate?.uuidPaths ?? []) expect(path).toMatch(/^\/[0-9a-f-]{36}$/);
    expect(await readFile(join(dir, "electronics-results/erc-1/report.md"), "utf8")).toContain(
      "Duplicate references (kicad-tool's check, not KiCad's): R1 (unit 1) x2",
    );
    // A symbol without an instance entry for its path (an edited file): KiCad picks one of its other entries, so
    // kicad-tool leaves it out of its check and says so.
    const layouts = await workbench("layouts");
    try {
      const modern = await readFile(join(layouts, "erc", "erc.kicad_sch"), "utf8");
      const rootPath = /\(path "(\/[0-9a-f-]+)"\s*\(reference "R1"\)/.exec(modern)?.[1] as string;
      // The second resistor's entry: the path just before the last `(reference "R1")`.
      const second = modern.lastIndexOf(`(path "${rootPath}"`, modern.lastIndexOf('(reference "R1")'));
      await writeFile(
        join(layouts, "erc", "erc.kicad_sch"),
        `${modern.slice(0, second)}(path "/11111111-1111-1111-1111-111111111111"${modern.slice(second + rootPath.length + 8)}`,
      );
      const fallback = kt(["erc", "--project", "erc/erc.kicad_pro"], layouts);
      expect(fallback.code, fallback.stdout).toBe(0);
      expect(fallback.doc?.summary.duplicateReferences).toEqual([]);
      expect(fallback.doc?.warnings.join(" ")).toMatch(
        /1 placed symbol instance\(s\) have no reference entry/,
      );
    } finally {
      await rm(layouts, { recursive: true, force: true });
    }
    const accepted = await workbench("accepted");
    try {
      const project = JSON.parse(await readFile(join(accepted, "erc", "erc.kicad_pro"), "utf8"));
      await writeFile(
        join(accepted, "erc", "erc.kicad_pro"),
        JSON.stringify({
          ...project,
          text_variables: {
            WEBSITE: "https://example.org/hw",
            NOTE: "/ see notes",
            KiCadRevision: "3",
            EMPTY: "",
            TOLERANCE: "1%",
            SPLIT: "5% / 10 %",
          },
        }),
      );
      const table = await readFile(join(accepted, "erc", "sym-lib-table"), "utf8");
      await writeFile(
        join(accepted, "erc", "sym-lib-table"),
        table.replace(
          ")\n",
          ')\n\t(lib (name "Device") (type "KiCad") (uri "${KICAD10_SYMBOL_DIR}/Device.kicad_sym") (options "") (descr ""))\n',
        ),
      );
      await writeFile(
        join(accepted, "erc", "erc.kicad_pcb"),
        `(kicad_pcb (version 20260206)${" ".repeat(2 * 1024 * 1024)})\n`,
      );
      const run = settle(
        seam("limit", [String(1024 * 1024), "erc", "--project", "erc/erc.kicad_pro"], accepted),
        "accepted",
      );
      expect(run.code, run.stdout).toBe(0);
      const board = settle(
        seam("limit", [String(1024 * 1024), "drc", "--project", "erc/erc.kicad_pro"], accepted),
        "board",
      );
      refusal(board as ReturnType<typeof kt>, "project", /erc\.kicad_pcb.*larger than 1 MiB/);
      // Only ERC opens simulation models: a BOM runs with the model check turned on.
      await writeFile(
        join(accepted, "erc", "erc.kicad_pro"),
        JSON.stringify({ ...project, erc: { rule_severities: { simulation_model_issue: "error" } } }),
      );
      const bom = kt(["bom", "--project", "erc/erc.kicad_pro"], accepted);
      expect(bom.code, bom.stdout).toBe(0);
    } finally {
      await rm(accepted, { recursive: true, force: true });
    }
    const edges = await workbench("edges");
    try {
      // An empty instance reference is unannotated: KiCad's netlist shows R?, so R1 is no duplicate.
      const modern = await readFile(join(edges, "erc", "erc.kicad_sch"), "utf8");
      const at = modern.lastIndexOf('(reference "R1")');
      await writeFile(
        join(edges, "erc", "erc.kicad_sch"),
        `${modern.slice(0, at)}(reference "")${modern.slice(at + 16)}`,
      );
      const empty = kt(["erc", "--project", "erc/erc.kicad_pro"], edges);
      expect(empty.code, empty.stdout).toBe(0);
      expect(empty.doc?.summary.duplicateReferences).toEqual([]);
      const shown = await kicadReferences(edges, "erc/erc.kicad_pro");
      expect(shown.filter((reference) => reference === "R1")).toHaveLength(1);
      expect(shown).toContain("R?");
      // Repeated items: KiCad takes the last `reference` of an entry and the last entry for a path, as kicad-tool does.
      const lastReference = `${modern.slice(0, at)}(reference "R2") (reference "R1")${modern.slice(at + 16)}`;
      await writeFile(join(edges, "erc", "erc.kicad_sch"), lastReference);
      const repeated = kt(["erc", "--project", "erc/erc.kicad_pro"], edges);
      expect(repeated.code, repeated.stdout).toBe(0);
      expect(repeated.doc?.summary.duplicateReferences).toMatchObject([{ reference: "R1", count: 2 }]);
      expect(await kicadReferences(edges, "erc/erc.kicad_pro")).not.toContain("R2");
      // A later entry for the same path, after the entry's `(unit 1)` and its own closing parenthesis.
      const entry = modern.lastIndexOf("(path ", at);
      const end = modern.indexOf(")", modern.indexOf("(unit ", at) + 6) + 1;
      expect(modern.slice(end).trimStart().startsWith(")")).toBe(true);
      const close = modern.indexOf(")", end) + 1;
      const path = /\(path "([^"]+)"/.exec(modern.slice(entry))?.[1] as string;
      await writeFile(
        join(edges, "erc", "erc.kicad_sch"),
        `${modern.slice(0, close)}\n\t\t\t\t(path "${path}" (reference "R2") (unit 1))${modern.slice(close)}`,
      );
      const later = kt(["erc", "--project", "erc/erc.kicad_pro"], edges);
      expect(later.code, later.stdout).toBe(0);
      expect(later.doc?.summary.duplicateReferences).toEqual([]);
      expect(await kicadReferences(edges, "erc/erc.kicad_pro")).toContain("R2");
    } finally {
      await rm(edges, { recursive: true, force: true });
    }
    // Unannotated symbols (R?) are KiCad's own ERC check, not duplicates.
    const work = await workbench("unannotated");
    try {
      const text = await readFile(join(work, "erc", "erc.kicad_sch"), "utf8");
      await writeFile(join(work, "erc", "erc.kicad_sch"), text.replaceAll('"R1"', '"R?"'));
      const run = kt(["erc", "--project", "erc/erc.kicad_pro"], work);
      expect(run.code, run.stdout).toBe(0);
      expect(run.doc?.summary.duplicateReferences).toEqual([]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    expect(doc.summary.libraryIssues).toEqual([]);
    expect(
      JSON.parse(await readFile(join(dir, "electronics-results/erc-1/erc.json"), "utf8")).$schema,
    ).toContain("erc");
  });

  it("reads a project as KiCad 10 does: a quote inside a word, a symbol folder (REQ-REL-c4b14f26)", async () => {
    const work = await workbench("agree");
    try {
      // KiCad keeps a quote inside an unquoted word, so the sheet between the two text items is a third block for
      // KiCad's netlist and for kicad-tool alike.
      const root = await readFile(join(work, "erc", "erc.kicad_sch"), "utf8");
      await writeFile(
        join(work, "erc", "erc.kicad_sch"),
        root.replace(
          "\n\t(sheet\n",
          '\n\t(text x" (at 0 0 0))\n\t(sheet (at 76.2 136.84) (size 20.32 7.62) (uuid "00000000-0000-0000-0000-0000000000bb") (property "Sheetname" "blk3" (at 76.2 136.14 0)) (property "Sheetfile" "block.kicad_sch" (at 76.2 145.06 0)))\n\t(text y" (at 0 0 0))\n\t(sheet\n',
        ),
      );
      const inspected = kt(["inspect", "--project", "erc/erc.kicad_pro"], work);
      expect(inspected.code, inspected.stdout).toBe(0);
      const stored = JSON.parse(
        await readFile(join(work, inspected.doc?.result as string), "utf8"),
      ) as ToolDocument;
      expect(stored.summary.hierarchy.map((sheet: { path: string }) => sheet.path)).toContain("/blk3/");
      const netlist = kt(["netlist", "--project", "erc/erc.kicad_pro"], work);
      expect(netlist.code, netlist.stdout).toBe(0);
      const net = netlist.doc?.artifacts.find((artifact) => artifact.path.endsWith("netlist.net"))
        ?.path as string;
      expect(await readFile(join(work, net), "utf8")).toContain('(name "/blk3/")');
      // KiCad 10 reads a symbol library given as a folder of .kicad_sym files; kicad-tool copies them.
      await writeFile(join(work, "erc", "erc.kicad_sch"), root);
      await mkdir(join(work, "erc", "symbols"));
      await cp(join(work, "erc", "fixture.kicad_sym"), join(work, "erc", "symbols", "fixture.kicad_sym"));
      await rm(join(work, "erc", "fixture.kicad_sym"));
      const table = await readFile(join(work, "erc", "sym-lib-table"), "utf8");
      await writeFile(
        join(work, "erc", "sym-lib-table"),
        table.replace("${KIPRJMOD}/fixture.kicad_sym", "${KIPRJMOD}/symbols"),
      );
      const run = kt(["erc", "--project", "erc/erc.kicad_pro"], work);
      expect(run.code, run.stdout).toBe(0);
      expect(run.doc?.project.files.map((file) => file.path)).toContain("erc/symbols/fixture.kicad_sym");
      const doc = JSON.parse(await readFile(join(work, run.doc?.result as string), "utf8")) as ToolDocument;
      expect(doc.summary.libraryIssues).toEqual([]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("lists missing symbol libraries as ERC library issues (REQ-REL-421726b7)", async () => {
    const work = await workbench("libs");
    try {
      await rm(join(work, "hier", "sym-lib-table"));
      const run = kt(["erc", "--project", "hier/hier.kicad_pro"], work);
      expect(run.code, run.stdout).toBe(0);
      const doc = JSON.parse(await readFile(join(work, run.doc?.result as string), "utf8")) as ToolDocument;
      expect(doc.summary.libraryIssues.length).toBeGreaterThan(0);
      const spelled = await workbench("spelled");
      try {
        const table = await readFile(join(spelled, "erc", "sym-lib-table"), "utf8");
        await writeFile(
          join(spelled, "erc", "sym-lib-table"),
          table.replace("${KIPRJMOD}/fixture.kicad_sym", "$(KIPRJMOD)/fixture.kicad_sym"),
        );
        const fpTable = await readFile(join(spelled, "erc", "fp-lib-table"), "utf8");
        await writeFile(
          join(spelled, "erc", "fp-lib-table"),
          fpTable.replace("${KIPRJMOD}/fixture.pretty", "%KIPRJMOD%//fixture.pretty"),
        );
        const other = kt(["erc", "--project", "erc/erc.kicad_pro"], spelled);
        expect(other.code, other.stdout).toBe(0);
        expect(other.doc?.warnings.join(" ")).not.toMatch(/outside the project folder/);
        expect(other.doc?.project.files.map((file) => file.path)).toContain("erc/fixture.kicad_sym");
        expect(other.doc?.project.files.map((file) => file.path)).toContain(
          "erc/fixture.pretty/R_0603.kicad_mod",
        );
        const stored = JSON.parse(
          await readFile(join(spelled, other.doc?.result as string), "utf8"),
        ) as ToolDocument;
        expect(stored.summary.libraryIssues).toEqual([]);
      } finally {
        await rm(spelled, { recursive: true, force: true });
      }
      for (const issue of doc.summary.libraryIssues) {
        expect(issue.type).toBe("lib_symbol_issues");
        expect(issue.severity).toBe("warning");
        expect(issue.description).toContain("fixture");
        expect(issue.items).toHaveLength(1);
        expect(issue.items[0].description).toMatch(/^Symbol /);
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("reads board layers, stackup, dimensions, tracks, vias and net classes (REQ-FUNC-fa7fc405)", async () => {
    const doc = await full(ok(["inspect", "--project", "board/defects.kicad_pro"]));
    const board = doc.summary.board;
    expect(doc.summary.hierarchy).toEqual([]);
    expect(
      board.layers.slice(0, 2).map((layer: { name: string; type: string }) => [layer.name, layer.type]),
    ).toEqual([
      ["F.Cu", "signal"],
      ["B.Cu", "signal"],
    ]);
    expect(board.layers).toHaveLength(20);
    expect(board.stackup.available).toBe(true);
    expect(
      board.stackup.layers.find((layer: { name: string }) => layer.name === "dielectric 1"),
    ).toMatchObject({
      type: "core",
      thickness: 1.51,
      material: "FR4",
      epsilonR: 4.5,
      lossTangent: 0.02,
    });
    expect(board.dimensions).toMatchObject({ width: 50, height: 30, thickness: 1.6 });
    expect(board.footprints.map((footprint: { reference: string }) => footprint.reference)).toEqual([
      "J1",
      "R1",
      "R2",
      "R3",
      "R4",
      "H1",
    ]);
    expect(
      board.footprints.find((footprint: { reference: string }) => footprint.reference === "H1"),
    ).toMatchObject({
      x: 145,
      y: 125,
      excludeFromPos: true,
    });
    const tracks = Object.fromEntries(
      board.tracks.map((track: { net: string; segments: number; length: number }) => [
        track.net,
        [track.segments, track.length],
      ]),
    );
    expect(tracks).toEqual({ VIN: [1, 9.05], OUT: [1, 8.1], GND: [2, 24.45], SIG: [2, 19.1] });
    expect(board.vias).toEqual([{ net: "GND", size: 0.8, drill: 0.4, count: 1 }]);
    expect(board.zones).toEqual([{ net: "GND", layers: ["B.Cu"] }]);
    expect(
      board.netClasses.map((netClass: { name: string; clearance: number }) => [
        netClass.name,
        netClass.clearance,
      ]),
    ).toEqual([
      ["Default", 0.2],
      ["Power", 1],
    ]);
    expect(board.netClassPatterns).toEqual([{ netclass: "Power", pattern: "VIN" }]);
    expect(board.unconnected).toBe("not-evaluated");
    const plain = await full(ok(["inspect", "--project", "board/clean.kicad_pcb"]));
    expect(plain.summary.board.netClasses).toEqual([]);
    const work = await workbench("nostackup");
    try {
      const text = await readFile(join(fixtures, "board", "clean.kicad_pcb"), "utf8");
      const start = text.indexOf("\t\t(stackup");
      const end = text.indexOf("\n\t\t)", start) + 4;
      await writeFile(join(work, "board", "clean.kicad_pcb"), text.slice(0, start) + text.slice(end));
      const run = kt(["inspect", "--project", "board/clean.kicad_pcb"], work);
      expect(run.code, run.stdout).toBe(0);
      const stored = JSON.parse(
        await readFile(join(work, run.doc?.result as string), "utf8"),
      ) as ToolDocument;
      expect(stored.summary.board.stackup).toEqual({ available: false, layers: [] });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("reports the short, the clearance and the unrouted pad, and the DRC limit (REQ-FUNC-3c1c35b7)", async () => {
    const doc = ok(["drc", "--project", "board/defects.kicad_pro", "--run-id", "drc-1"]);
    expect(doc.summary.counts).toEqual({
      violations: { error: 2, warning: 0, exclusion: 0 },
      unconnected: 1,
      parity: 0,
    });
    expect(doc.summary.types).toEqual({ tracks_crossing: 1, clearance: 1, unconnected_items: 1 });
    const clearance = doc.summary.violations.find(
      (violation: { type: string }) => violation.type === "clearance",
    );
    expect(clearance.description).toContain("1.0000 mm");
    expect(clearance.items.map((item: { x: number; y: number }) => [item.x, item.y])).toEqual([
      [114.05, 110],
      [115.95, 110],
    ]);
    const crossing = doc.summary.violations.find(
      (violation: { type: string }) => violation.type === "tracks_crossing",
    );
    expect(
      crossing.items.map((item: { x: number; y: number; description: string }) => [
        item.x,
        item.y,
        item.description.includes("[SIG]") ? "SIG" : "OUT",
      ]),
    ).toEqual([
      [120.05, 120, "SIG"],
      [115.95, 110, "OUT"],
    ]);
    expect(
      doc.summary.unconnected[0].items.map((item: { x: number; y: number }) => [item.x, item.y]),
    ).toEqual([
      [105, 113.5],
      [114.05, 120],
    ]);
    expect(
      doc.summary.unconnected[0].items.map((item: { description: string }) => item.description).join(" "),
    ).toContain("R3");
    expect(doc.summary.zonesRefilled).toBe(false);
    expect(doc.summary.parityChecked).toBe(false);
    expect(doc.limits.join(" ")).toMatch(
      /zero violations does not validate function, current capacity, impedance or return paths/,
    );
    const clean = ok(["drc", "--project", "board/clean.kicad_pcb"]);
    expect(clean.summary.counts).toEqual({
      violations: { error: 0, warning: 0, exclusion: 0 },
      unconnected: 0,
      parity: 0,
    });
    expect(clean.limits.join(" ")).toMatch(/zero violations does not validate/);
    // A board next to a schematic: DRC also compares the two (the fixture board holds none of hier's parts).
    const work = await workbench("parity");
    try {
      await cp(join(work, "board", "defects.kicad_pcb"), join(work, "hier", "hier.kicad_pcb"));
      const run = kt(["drc", "--project", "hier/hier.kicad_pro"], work);
      expect(run.code, run.stdout).toBe(0);
      expect(run.doc?.summary.parityChecked).toBe(true);
      expect(run.doc?.summary.counts.parity).toBeGreaterThan(0);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("refills zones only on the work copy and says so (REQ-FUNC-fdd959d4)", async () => {
    const before = (await hashes(dir))["board/defects.kicad_pcb"];
    const record = join(dir, "calls-refill.json");
    const run = settle(
      seam("calls", [record, "drc", "--project", "board/defects.kicad_pro", "--refill-zones"], dir),
      "refill",
    );
    expect(run.code, run.stdout).toBe(0);
    expect(run.doc?.summary.zonesRefilled).toBe(true);
    expect(run.doc?.summary.counts.unconnected).toBe(1);
    const calls = JSON.parse(await readFile(record, "utf8")) as Array<{ args: string[] }>;
    const drc = calls.find((call) => call.args[0] === "pcb" && call.args[1] === "drc");
    expect(drc?.args).toContain("--refill-zones");
    expect(calls.flatMap((call) => call.args)).not.toContain("--save-board");
    expect((await hashes(dir))["board/defects.kicad_pcb"]).toBe(before);
    await rm(record);
  });

  it("exports schematic and board PDF and SVG files with their checks (REQ-FUNC-bad2229c)", async () => {
    const sch = ok([
      "export",
      "--project",
      "hier/hier.kicad_pro",
      "--kind",
      "sch-pdf",
      "--run-id",
      "x-sch-pdf",
    ]);
    expect(sch.summary.files).toEqual([
      { path: "electronics-results/x-sch-pdf/exports/hier.pdf", check: "pass" },
    ]);
    const svg = ok([
      "export",
      "--project",
      "hier/hier.kicad_pro",
      "--kind",
      "sch-svg",
      "--run-id",
      "x-sch-svg",
    ]);
    expect(svg.summary.files).toHaveLength(5);
    expect(svg.summary.checks).toEqual([
      { id: "files", status: "pass", detail: "5 SVG files for 5 sheet instances" },
    ]);
    const pcb = ok([
      "export",
      "--project",
      "board/defects.kicad_pro",
      "--kind",
      "pcb-pdf",
      "--layers",
      "F.Cu,B.Cu,Edge.Cuts",
      "--run-id",
      "x-pcb-pdf",
    ]);
    expect(pcb.summary.files).toEqual([
      { path: "electronics-results/x-pcb-pdf/exports/defects-pcb.pdf", check: "pass" },
    ]);
    const pcbSvg = ok([
      "export",
      "--project",
      "board/defects.kicad_pro",
      "--kind",
      "pcb-svg",
      "--layers",
      "F.Cu,Edge.Cuts",
      "--run-id",
      "x-pcb-svg",
    ]);
    expect(pcbSvg.summary.files).toHaveLength(2);
    expect(pcbSvg.summary.checks).toEqual([
      { id: "files", status: "pass", detail: "2 SVG files for 2 layers" },
    ]);
    for (const doc of [sch, svg, pcb, pcbSvg]) {
      for (const file of doc.summary.files) expect(file.check, file.path).toBe("pass");
      expect(doc.summary.options).toBeDefined();
    }
    const pdf = await readFile(join(dir, "electronics-results/x-sch-pdf/exports/hier.pdf"), "latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
  });

  it("exports Gerber, drill and position files with explicit layers and a verification (REQ-FUNC-9cb44e40)", async () => {
    const layers = "F.Cu,B.Cu,F.Mask,B.Mask,Edge.Cuts";
    const gerbers = ok([
      "export",
      "--project",
      "board/defects.kicad_pro",
      "--kind",
      "gerbers",
      "--layers",
      layers,
      "--run-id",
      "x-gerbers",
    ]);
    expect(gerbers.summary.layers).toEqual(layers.split(","));
    const files = gerbers.summary.files as Array<{
      path: string;
      check: string;
      layer?: string;
      fileFunction?: string;
    }>;
    expect(files).toHaveLength(6);
    expect(
      Object.fromEntries(files.filter((file) => file.layer).map((file) => [file.layer, file.fileFunction])),
    ).toEqual({
      "F.Cu": "Copper,L1,Top",
      "B.Cu": "Copper,L2,Bot",
      "F.Mask": "Soldermask,Top",
      "B.Mask": "Soldermask,Bot",
      "Edge.Cuts": "Profile,NP",
    });
    for (const file of files) expect(file.check, file.path).toBe("pass");
    expect(gerbers.summary.options).toMatchObject({ x2: true, netlistAttributes: true, precision: 6 });
    const drill = ok([
      "export",
      "--project",
      "board/defects.kicad_pro",
      "--kind",
      "drill",
      "--run-id",
      "x-drill",
    ]);
    expect(drill.summary.counts).toEqual({ plated: 3, nonPlated: 1, boardPlated: 3, boardNonPlated: 1 });
    expect(drill.summary.checks.find((check: { id: string }) => check.id === "holes").status).toBe("pass");
    const pos = ok(["export", "--project", "board/defects.kicad_pro", "--kind", "pos", "--run-id", "x-pos"]);
    expect(pos.summary.counts).toEqual({ rows: 5, footprints: 5 });
    expect(pos.summary.checks.find((check: { id: string }) => check.id === "rows").status).toBe("pass");
    const cut = settle(
      seam(
        "fail",
        [
          "truncate",
          "export",
          "--project",
          "board/defects.kicad_pro",
          "--kind",
          "gerbers",
          "--layers",
          layers,
          "--run-id",
          "x-cut",
        ],
        dir,
      ),
      "truncate",
    );
    expect(cut.code, cut.stdout).toBe(0);
    expect(
      ((cut.doc?.summary.files ?? []) as Array<{ check: string }>).filter((file) => file.check === "fail"),
    ).toHaveLength(1);
    const nojob = settle(
      seam(
        "fail",
        [
          "nojob",
          "export",
          "--project",
          "board/defects.kicad_pro",
          "--kind",
          "gerbers",
          "--layers",
          "F.Cu",
          "--run-id",
          "x-nojob",
        ],
        dir,
      ),
      "nojob",
    );
    expect(nojob.code, nojob.stdout).toBe(0);
    expect(nojob.doc?.summary.files).toContainEqual({
      path: "exports/gerbers/<job>",
      check: "fail",
      reason: "kicad-cli wrote no Gerber job file",
    });
    const work = await workbench("function");
    try {
      const board = await readFile(join(fixtures, "board", "defects.kicad_pcb"), "utf8");
      await writeFile(
        join(work, "board", "defects.kicad_pcb"),
        board.replace('(17 "Dwgs.User" user "User.Drawings")', '(17 "Dwgs.User" user "B.Cu")'),
      );
      const run = kt(
        ["export", "--project", "board/defects.kicad_pro", "--kind", "gerbers", "--layers", "F.Cu,B.Cu"],
        work,
      );
      expect(run.code, run.stdout).toBe(0);
      const back = (
        (run.doc?.summary.files ?? []) as Array<{ layer?: string; check: string; reason?: string }>
      ).find((file) => file.layer === "B.Cu");
      expect(back?.check).toBe("fail");
      expect(back?.reason).toMatch(/Copper.*Bot/);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("writes a review report that keeps KiCad checks apart from facts (REQ-FUNC-bb443178)", async () => {
    const doc = ok(["review-report", "--project", "hier/hier.kicad_pro", "--run-id", "review-1"]);
    const report = await readFile(join(dir, "electronics-results/review-1/report.md"), "utf8");
    const headings = report.match(/^## .+$/gm) ?? [];
    expect(headings).toEqual(["## Project", "## KiCad checks", "## Facts for review", "## Limits"]);
    expect(doc.summary.erc.counts).toEqual({ error: 0, warning: 0, exclusion: 0 });
    expect(doc.summary.drc).toBeNull();
    expect(doc.summary.facts.powerNets).toEqual(["+3V3", "+5V", "GND"]);
    expect(report).toMatch(/not sized without its electrical requirements/);
    expect(report).toContain("ERC: 0 errors, 0 warnings, 0 exclusions.");
    expect(report).toContain("- Nets with a single node: none");
    const erc = ok(["review-report", "--project", "erc/erc.kicad_pro", "--run-id", "review-3"]);
    expect(erc.summary.erc.counts).toEqual({ error: 6, warning: 2, exclusion: 0 });
    expect(erc.summary.erc.duplicateCount).toBe(1);
    expect(await readFile(join(dir, "electronics-results/review-3/report.md"), "utf8")).toContain(
      "Duplicate references (kicad-tool's check, not KiCad's): R1 (unit 1) x2",
    );
    expect((await full(erc)).summary.erc.violations).toHaveLength(8);
    expect((await full(erc)).summary.instances.length).toBeGreaterThan(0);
    const board = ok(["review-report", "--project", "board/defects.kicad_pro", "--run-id", "review-2"]);
    expect(board.summary.erc).toBeNull();
    expect(board.summary.drc.counts.unconnected).toBe(1);
    expect(await readFile(join(dir, "electronics-results/review-2/report.md"), "utf8")).toMatch(
      /zero violations does not validate/,
    );
  });

  it("builds every kicad-cli call itself, inside the work copy and the run (REQ-SEC-40a76c91)", async () => {
    const record = join(dir, "calls.json");
    const all: Array<{ args: string[]; cwd: string }> = [];
    const runs: string[][] = [
      ["inspect", "--project", "hier/hier.kicad_pro"],
      ["inspect", "--project", "board/defects.kicad_pro"],
      ["erc", "--project", "hier/hier.kicad_pro"],
      ["drc", "--project", "board/defects.kicad_pro"],
      ["bom", "--project", "hier/hier.kicad_pro"],
      ["netlist", "--project", "hier/hier.kicad_pro"],
      ...["sch-pdf", "sch-svg"].map((kind) => ["export", "--project", "hier/hier.kicad_pro", "--kind", kind]),
      ...["pcb-pdf", "pcb-svg", "gerbers"].map((kind) => [
        "export",
        "--project",
        "board/defects.kicad_pro",
        "--kind",
        kind,
        "--layers",
        "F.Cu",
      ]),
      ...["drill", "pos"].map((kind) => ["export", "--project", "board/defects.kicad_pro", "--kind", kind]),
      ["review-report", "--project", "hier/hier.kicad_pro"],
    ];
    for (const args of runs) {
      const run = settle(seam("calls", [record, ...args], dir), args.join(" "));
      expect(run.code, args.join(" ")).toBe(0);
      all.push(...(JSON.parse(await readFile(record, "utf8")) as Array<{ args: string[]; cwd: string }>));
    }
    await rm(record);
    const known = [
      "sch erc",
      "pcb drc",
      "sch export netlist",
      "pcb export stats",
      "sch export pdf",
      "sch export svg",
      "pcb export pdf",
      "pcb export svg",
      "pcb export gerbers",
      "pcb export drill",
      "pcb export pos",
    ];
    for (const call of all) {
      const head = call.args.slice(0, call.args[1] === "export" ? 3 : 2).join(" ");
      expect(known, call.args.join(" ")).toContain(head);
      for (const forbidden of [
        "--save-board",
        "upgrade",
        "jobset",
        "--define-var",
        "-D",
        "--variant",
        "--drawing-sheet",
        "--exit-code-violations",
      ])
        expect(call.args, call.args.join(" ")).not.toContain(forbidden);
      for (const value of call.args.filter((arg) => arg.includes(sep) || arg.includes("/")))
        expect(value.startsWith(dir), `${value} lies in the workbench`).toBe(false);
      expect(call.cwd.startsWith(dir)).toBe(false);
    }
    refusal(kt(["erc", "--project", "--help"], dir), "usage", "--project");
  });

  it("leaves every project file unchanged and adds no .kicad_prl (REQ-REL-09628127)", async () => {
    const work = await workbench("unchanged");
    try {
      const before = await hashes(work);
      for (const args of [
        ["inspect", "--project", "hier/hier.kicad_pro"],
        ["erc", "--project", "erc/erc.kicad_pro"],
        ["drc", "--project", "board/defects.kicad_pro", "--refill-zones"],
        ["bom", "--project", "hier/hier.kicad_pro"],
        ["export", "--project", "board/defects.kicad_pro", "--kind", "gerbers", "--layers", "F.Cu,B.Cu"],
        ["export", "--project", "board/defects.kicad_pro", "--kind", "gerbers", "--layers", "Nope.Layer"],
      ])
        expect([0, 2], args.join(" ")).toContain(kt(args, work).code);
      expect(
        settle(seam("fail", ["exit", "drc", "--project", "board/defects.kicad_pro"], work), "fail").code,
      ).toBe(3);
      const after = await hashes(work);
      for (const key of Object.keys(after)) if (key.startsWith("electronics-results/")) delete after[key];
      expect(after).toEqual(before);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    // The runs of the other cases in this workbench left it unchanged as well.
    expect(await sources()).toEqual(pristine);
  });

  it("leaves the sources unchanged when the run is stopped mid-way (REQ-REL-09628127)", async () => {
    const leftovers = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("kicad-tool-"));
    const earlier = new Set(await leftovers());
    const child = spawn(
      python,
      [internals, scripts, "slow", "drc", "--project", "board/defects.kicad_pro", "--run-id", "stopped"],
      {
        cwd: dir,
        env: sourceEnv(),
        detached: !windows,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await new Promise<void>((done) => {
      child.stderr.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("kicad-cli started")) done();
      });
    });
    if (windows)
      spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), [
        "/T",
        "/F",
        "/PID",
        String(child.pid),
      ]);
    else process.kill(-(child.pid as number), "SIGKILL");
    await new Promise((done) => child.on("exit", done));
    expect(await sources()).toEqual(pristine);
    expect(await results(dir)).not.toContain("stopped");
    // A killed process cannot remove its work copy: the one it left holds the copy KiCad wrote into.
    const left = (await leftovers()).filter((name) => !earlier.has(name));
    expect(left).toHaveLength(1);
    expect(await readdir(join(tmpdir(), left[0] as string, "project"))).toContain("defects.kicad_prl");
    await rm(join(tmpdir(), left[0] as string), { recursive: true, force: true });
  });

  it("discards a run whose source changes while KiCad runs (REQ-REL-da746e30)", async () => {
    const work = await workbench("change");
    try {
      const run = settle(
        seam("change", ["drc", "--project", "board/defects.kicad_pcb", "--run-id", "changed"], work),
        "change",
      );
      expect(run.code, run.stdout).toBe(3);
      expect(run.doc?.errors).toEqual([
        { code: "source", path: "", message: expect.stringContaining("board/defects.kicad_pcb") },
      ]);
      expect(await results(work)).toEqual([]);
      expect(kt(["drc", "--project", "board/defects.kicad_pcb", "--run-id", "changed"], work).code).toBe(0);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("copies a project at the paths it names, also through links inside its folder (REQ-REL-09628127)", async () => {
    const work = await workbench("innerlinks");
    const outside = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-shared-")));
    try {
      // A sheet reached through a folder link inside the project folder.
      await mkdir(join(work, "erc", "real"));
      await cp(join(work, "erc", "block.kicad_sch"), join(work, "erc", "real", "block.kicad_sch"));
      await rm(join(work, "erc", "block.kicad_sch"));
      await symlink(join(work, "erc", "real"), join(work, "erc", "blk"), "junction");
      const root = await readFile(join(fixtures, "erc", "erc.kicad_sch"), "utf8");
      await writeFile(
        join(work, "erc", "erc.kicad_sch"),
        root.replaceAll('"block.kicad_sch"', '"blk/block.kicad_sch"'),
      );
      const erc = kt(["erc", "--project", "erc/erc.kicad_pro"], work);
      expect(erc.code, erc.stdout).toBe(0);
      expect(erc.doc?.summary.counts).toEqual({ error: 6, warning: 2, exclusion: 0 });
      expect(erc.doc?.project.files.map((file) => file.path)).toContain("erc/blk/block.kicad_sch");
      // A whole sheet folder that is a link inside the project folder.
      await cp(join(work, "hier", "sub"), join(work, "hier", "real_sub"), { recursive: true });
      await rm(join(work, "hier", "sub"), { recursive: true });
      await symlink(join(work, "hier", "real_sub"), join(work, "hier", "sub"), "junction");
      const inspect = kt(["inspect", "--project", "hier/hier.kicad_pro"], work);
      expect(inspect.code, inspect.stdout).toBe(0);
      expect(inspect.doc?.summary.counts).toMatchObject({ sheets: 5, instances: 17, nets: 8 });
      // A footprint library folder and a drawing sheet outside the project folder: read nowhere, with a warning.
      await cp(join(work, "board", "fixture.pretty"), join(outside, "fixture.pretty"), { recursive: true });
      await rm(join(work, "board", "fixture.pretty"), { recursive: true });
      await symlink(join(outside, "fixture.pretty"), join(work, "board", "fixture.pretty"), "junction");
      await writeFile(
        join(outside, "frame.kicad_wks"),
        "(kicad_wks (version 20231118) (generator pl_editor))\n",
      );
      const project = JSON.parse(await readFile(join(work, "board", "defects.kicad_pro"), "utf8"));
      project.pcbnew = { page_layout_descr_file: "../outside.kicad_wks" };
      await cp(join(outside, "frame.kicad_wks"), join(work, "outside.kicad_wks"));
      await writeFile(join(work, "board", "defects.kicad_pro"), JSON.stringify(project));
      const table = await readFile(join(work, "erc", "sym-lib-table"), "utf8");
      await writeFile(
        join(work, "erc", "sym-lib-table"),
        table.replace("${KIPRJMOD}/fixture.kicad_sym", "${KIPRJMOD}/../erc/fixture.kicad_sym"),
      );
      const climbing = kt(["erc", "--project", "erc/erc.kicad_pro"], work);
      expect(climbing.code, climbing.stdout).toBe(0);
      expect((climbing.doc?.warnings ?? []).join(" ")).toMatch(/sym-lib-table.*outside the project folder/);
      const drc = kt(["drc", "--project", "board/defects.kicad_pro"], work);
      expect(drc.code, drc.stdout).toBe(0);
      const warnings = (drc.doc?.warnings ?? []).join(" ");
      expect(warnings).toMatch(/fp-lib-table.*outside the project folder/);
      expect(warnings).toMatch(/drawing sheet.*outside the project folder/);
    } finally {
      await rm(work, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("accepts project paths with spaces and characters beyond ASCII (REQ-REL-f1bcbb19)", async () => {
    const work = await workbench("unicode");
    try {
      const folder = "Proiect ü 电";
      await cp(join(work, "erc"), join(work, folder), { recursive: true });
      const run = kt(["erc", "--project", `${folder}/erc.kicad_pro`], work);
      expect(run.code, run.stdout).toBe(0);
      expect(run.doc?.summary.counts).toEqual({ error: 6, warning: 2, exclusion: 0 });
      expect(run.doc?.project.folder).toBe(folder);
      expect(run.doc?.project.files.map((file) => file.path)).toContain(`${folder}/block.kicad_sch`);
      await cp(join(work, "board"), join(work, `${folder} board`), { recursive: true });
      const drc = kt(["drc", "--project", `${folder} board/defects.kicad_pro`], work);
      expect(drc.code, drc.stdout).toBe(0);
      expect(drc.doc?.summary.counts).toEqual({
        violations: { error: 2, warning: 0, exclusion: 0 },
        unconnected: 1,
        parity: 0,
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("runs an older KiCad format with a warning and keeps the file (REQ-REL-426ec335)", async () => {
    const work = await workbench("older");
    try {
      const file = join(work, "hier", "sub", "probe.kicad_sch");
      await writeFile(
        file,
        (await readFile(file, "utf8")).replace("(version 20260306)", "(version 20250114)"),
      );
      const before = sha256(await readFile(file));
      const run = kt(["erc", "--project", "hier/hier.kicad_pro"], work);
      expect(run.code, run.stdout).toBe(0);
      expect(run.doc?.warnings.join(" ")).toMatch(/probe\.kicad_sch.*20250114.*in memory/);
      expect(sha256(await readFile(file))).toBe(before);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it("resolves kicad-cli through VERA's provisioner (REQ-FUNC-1ae67789)", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-find-")));
    const provisioner = new core.Provisioner({
      store: new core.PluginStore({ root: join(root, "plugins") }),
      root: join(root, "runtime"),
      uv: { executable: python, prefix: ["-c", "import sys; sys.exit(1)"] },
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      platform: core.pluginPlatform(process.platform, process.arch),
      fetch: async () => new Response("offline", { status: 404 }),
      settings: () => undefined,
    });
    try {
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(source);
      // The uv stand-in fails, so only the find program becomes ready.
      const statuses = await provisioner.install("kicad");
      expect(statuses.find((status) => status.name === "kicad-cli")).toMatchObject({
        kind: "find",
        state: "ready",
        version: located?.version,
      });
      const plugin = await store.load("kicad");
      const resolved = await provisioner.resolve(plugin, "kicad-cli");
      expect(resolved?.version).toBe(located?.version);
      expect((await stat(resolved?.executable as string)).isFile()).toBe(true);
    } finally {
      provisioner.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("leaves the installed package unchanged by a run (REQ-REL-20ece322)", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-installed-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("kicad");
    const bench = await workbench("installed");
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.PYTHONDONTWRITEBYTECODE;
    delete env.PYTHONPYCACHEPREFIX;
    const file = join(installed.folder, "scripts", "kicad_tool.py");
    const run = settle(
      spawnSync(python, [file, "erc", "--project", "hier/missing.kicad_pro"], {
        cwd: bench,
        encoding: "utf8",
        env,
      }),
      "installed",
    );
    expect(run.code).toBe(2);
    if (kicad10)
      expect(
        settle(
          spawnSync(python, [file, "erc", "--project", "erc/erc.kicad_pro"], {
            cwd: bench,
            encoding: "utf8",
            env,
          }),
          "erc",
        ).code,
      ).toBe(0);
    await expect(store.load("kicad")).resolves.toMatchObject({ manifest: { id: "kicad" } });
    const listing = await readdir(join(installed.folder, "scripts"), { recursive: true });
    expect(
      listing.some((name) => String(name).includes("__pycache__") || String(name).endsWith(".pyc")),
    ).toBe(false);
    await rm(bench, { recursive: true, force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

const uv = process.env.VERA_KICAD_UV;
// Explicit real acceptance: VERA_KICAD_UV names a uv executable; provisioning may download uv's managed CPython.
it.skipIf(!uv || !kicad10)(
  "runs through VERA's provisioner and ProgramRunner with the real KiCad (REQ-PLAT-c30fa145)",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-kicad-real-")));
    const host = new core.NodeProcessHost(spawn);
    const runner = new core.ProgramRunner({ host, clock: { sleep } });
    let provisioner: core.Provisioner | undefined;
    try {
      const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
      expect(release.issues).toEqual([]);
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(join(root, "release/kicad-1.0.0.zip"));
      provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        uv: { executable: uv as string },
        host,
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("No download program in this package");
        },
      });
      const statuses = await provisioner.install("kicad");
      expect(statuses).toMatchObject([
        { name: "kicad-cli", kind: "find", state: "ready", version: located?.version },
        { name: "kicad-tool", kind: "script", state: "ready", version: "1.0.0" },
      ]);
      const plugin = await store.load("kicad");
      const resolved = await provisioner.resolve(plugin, "kicad-tool");
      if (!resolved) throw Error("kicad-tool did not resolve");
      const bench = await workbench("vera");
      const pristine = await hashes(bench);
      await mkdir(join(bench, ".vera"));
      const documents: Record<string, ToolDocument> = {};
      for (const args of [
        ["inspect", "--project", "hier/hier.kicad_pro", "--run-id", "v-inspect"],
        ["erc", "--project", "erc/erc.kicad_pro", "--run-id", "v-erc"],
        ["drc", "--project", "board/defects.kicad_pro", "--run-id", "v-drc"],
        [
          "export",
          "--project",
          "board/defects.kicad_pro",
          "--kind",
          "gerbers",
          "--layers",
          "F.Cu,B.Cu,Edge.Cuts",
          "--run-id",
          "v-gerbers",
        ],
      ]) {
        const done = await runner.run({
          sessionId: "kicad-real",
          workbench: bench,
          executable: resolved.executable,
          args: [...(resolved.prefix ?? []), ...args],
          env: resolved.env ?? {},
          timeoutMs: 600_000,
        });
        expect(done.exitCode, done.output.slice(-2000)).toBe(0);
        documents[args[0] as string] = JSON.parse(done.output) as ToolDocument;
      }
      expect(documents.erc?.summary.counts).toEqual({ error: 6, warning: 2, exclusion: 0 });
      expect(documents.drc?.summary.counts.unconnected).toBe(1);
      expect(documents.inspect?.summary.counts.instances).toBe(17);
      const after = await hashes(bench);
      for (const key of Object.keys(after))
        if (key.startsWith("electronics-results/") || key.startsWith(".vera/")) delete after[key];
      expect(after).toEqual(pristine);
      const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(
          join(evidence, `kicad-${process.platform}.json`),
          JSON.stringify({ platform: process.platform, kicad: located, documents }),
        );
      }
      await rm(bench, { recursive: true, force: true });
    } finally {
      await runner.stopAll();
      provisioner?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  900_000,
);
