/**
 * freerouting plugin (spec REQ-FUNC-2a80da7f): freerouting-tool routes a kicad-layout candidate with the real
 * Freerouting 2.5.0 jar on a Java 25 runtime (VERA_TEST_FREEROUTING_JAR, VERA_TEST_JAVA) and KiCad 10's Python;
 * the golden path applies the request with kicad-layout-tool in KiCad's PCB editor (VERA_TEST_KICAD_GUI).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const tool = fileURLToPath(new URL("freerouting/scripts/freerouting_tool.py", plugins));
const layoutTool = fileURLToPath(new URL("kicad-layout/scripts/kicad_layout_tool.py", plugins));
const board = fileURLToPath(new URL("../fixtures/kicad-layout/board/", import.meta.url));
const windows = process.platform === "win32";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const uv = process.env.VERA_TEST_UV ?? "uv";
const kicadCli =
  process.env.VERA_TEST_KICAD_CLI ??
  (windows ? "C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe" : "/usr/bin/kicad-cli");
const jar = process.env.VERA_TEST_FREEROUTING_JAR ?? "";
const java = process.env.VERA_TEST_JAVA ?? "";
const routerReason =
  !jar || !existsSync(jar)
    ? "set VERA_TEST_FREEROUTING_JAR to freerouting-2.5.0.jar"
    : !java || !existsSync(java)
      ? "set VERA_TEST_JAVA to a Java 25 java executable"
      : !existsSync(kicadCli)
        ? `no KiCad 10 kicad-cli at ${kicadCli}`
        : "";
const router = routerReason === "";
const gui = router && Boolean(process.env.VERA_TEST_KICAD_GUI);

/** The environment VERA's runner gives freerouting-tool (allowlist plus the used programs' paths). */
const uvCache = (() => {
  const found = spawnSync(uv, ["cache", "dir"], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : undefined;
})();
const env = (extra: Record<string, string> = {}, display = false) =>
  core.programEnvironment(
    { platform: process.platform, env: process.env } as never,
    [],
    {
      ...(uvCache ? { UV_CACHE_DIR: uvCache } : {}),
      PYTHONDONTWRITEBYTECODE: "1",
      VERA_PROGRAM_KICAD_CLI: kicadCli,
      VERA_PROGRAM_JAVA: java,
      VERA_PROGRAM_FREEROUTING: jar,
      ...extra,
    },
    display,
  );
// biome-ignore lint/suspicious/noExplicitAny: result documents are checked field by field.
type Doc = Record<string, any>;
const runScript = (
  script: string,
  args: string[],
  cwd: string,
  extra: Record<string, string> = {},
  display = false,
) => {
  const done = spawnSync(uv, ["run", "--quiet", "--script", script, ...args], {
    cwd,
    encoding: "utf8",
    env: env(extra, display),
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  expect([0, 2, 3], `${args.join(" ")}: exit ${done.status}: ${String(done.stderr).slice(-1500)}`).toContain(
    done.status,
  );
  return { code: done.status, stdout: done.stdout, doc: JSON.parse(done.stdout) as Doc };
};
const route = (args: string[], cwd: string, extra: Record<string, string> = {}) =>
  runScript(tool, ["route", ...args], cwd, extra);
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

/** A kicad-layout run folder made by hand (route needs no PCB editor): the fixture board as a saved candidate. */
const handRun = async (dir: string, id: string) => {
  const run = join(dir, "electronics-results", id);
  await mkdir(join(run, "candidate"), { recursive: true });
  for (const name of ["layout.kicad_pcb", "layout.kicad_pro"])
    await cp(join(board, name), join(run, "candidate", name));
  const candidate = await readFile(join(run, "candidate/layout.kicad_pcb"));
  await writeFile(
    join(run, "state.json"),
    JSON.stringify({
      format: 1,
      kind: "kicad-layout-state",
      runId: id,
      candidate: { path: "candidate/layout.kicad_pcb", sha256: sha256(candidate) },
    }),
  );
  return { run, sha: sha256(candidate) };
};

let dir = "";
beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "vera-freerouting-")));
  await cp(board, join(dir, "boards"), { recursive: true });
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("freerouting plugin package", () => {
  // REQ-PLAT-e093fdbd: the jar is a file program; the helper uses java, the jar and kicad-cli.
  it("declares the pinned jar as a file program used by freerouting-tool", async () => {
    const manifest = parse(
      await readFile(new URL("freerouting/plugin.yaml", plugins), "utf8"),
    ) as PluginManifest;
    const checked = validatePluginManifest(manifest);
    expect(checked.issues).toEqual([]);
    expect(manifest.programs.freerouting).toMatchObject({ file: true });
    expect(manifest.programs["freerouting-tool"]?.uses).toEqual(["java", "freerouting", "kicad-cli"]);
    expect(manifest.requires).toEqual(["kicad-layout"]);
  });
});

describe("freerouting-tool refusals", () => {
  // REQ-REL-fa70a38d
  it("refuses a folder that is not a kicad-layout run and a changed candidate before exporting", async () => {
    await mkdir(join(dir, "electronics-results", "empty"), { recursive: true });
    const empty = route(["--run", "electronics-results/empty"], dir);
    expect(empty.code).toBe(2);
    expect(empty.doc.problems[0]?.kind).toBe("run");
    const { run } = await handRun(dir, "changed");
    await writeFile(
      join(run, "candidate/layout.kicad_pcb"),
      `${await readFile(join(run, "candidate/layout.kicad_pcb"), "utf8")}\n`,
    );
    const changed = route(["--run", "electronics-results/changed"], dir);
    expect(changed.code).toBe(2);
    expect(changed.doc.problems[0]?.kind).toBe("changed");
    expect(existsSync(join(run, "freerouting"))).toBe(false);
  });

  // REQ-REL-140facf3
  it("refuses custom design rules before Freerouting starts", async () => {
    const { run } = await handRun(dir, "rules");
    await writeFile(
      join(run, "candidate/layout.kicad_dru"),
      '(version 1)\n(rule "HV clearance"\n  (constraint clearance (min 1mm)))\n',
    );
    const refused = route(["--run", "electronics-results/rules"], dir);
    expect(refused.code).toBe(2);
    expect(refused.doc.problems[0]).toMatchObject({
      kind: "rules",
      message: expect.stringContaining("HV clearance"),
    });
    expect(existsSync(join(run, "freerouting"))).toBe(false);
  });
});

describe.skipIf(!router)(`freerouting-tool with Freerouting ${routerReason}`, () => {
  // REQ-FUNC-2a80da7f, REQ-SEC-73847af9, REQ-FUNC-93285684
  it("routes the fixture offline into a kicad-layout request that keeps the existing copper", async () => {
    const { run, sha } = await handRun(dir, "routed");
    const done = route(["--run", "electronics-results/routed"], dir);
    expect(done.code, done.stdout).toBe(0);
    expect(done.doc).toMatchObject({ status: "completed", freerouting: { version: "2.5.0", unrouted: 0 } });
    expect(done.doc.freerouting.java).toMatch(/^25\./);
    expect(done.doc.protected).toBeGreaterThan(0);
    expect(done.doc.next).toBe(
      "kicad-layout-tool edit --run electronics-results/routed --request electronics-results/routed/freerouting/001/request.json",
    );
    const work = join(run, "freerouting/001");
    const request = await json(join(work, "request.json"));
    expect(request).toMatchObject({ format: 1, candidate: sha, units: "mm" });
    expect(request.operations.length).toBe(done.doc.operations.tracks + done.doc.operations.vias);
    // Every existing wire is protected in the DSN, and none of them is in the request.
    const dsn = await readFile(join(work, "board.dsn"), "utf8");
    expect(dsn.slice(dsn.indexOf("(wiring"))).not.toMatch(/\(type route\)/);
    // Freerouting's settings and log stay in the work folder (user.home), not in the user's profile.
    const home = (await readdir(join(work, "home"), { recursive: true })).map((p) =>
      String(p).replaceAll("\\", "/"),
    );
    expect(home.some((p) => p.endsWith("freerouting.json"))).toBe(true);
    expect(sha256(await readFile(join(run, "candidate/layout.kicad_pcb")))).toBe(sha);
    // A net filter keeps only that net's routes.
    const vin = route(["--run", "electronics-results/routed", "--nets", "VIN"], dir);
    expect(vin.code, vin.stdout).toBe(0);
    const only = await json(join(run, "freerouting/002/request.json"));
    expect(new Set(only.operations.map((o: { net: string }) => o.net))).toEqual(new Set(["VIN"]));
  }, 300_000);

  // REQ-REL-558ec184
  it("fails without a request on an exhausted budget and on an unreadable session file", async () => {
    const { run, sha } = await handRun(dir, "failing");
    const slow = route(["--run", "electronics-results/failing", "--max-seconds", "1"], dir);
    expect(slow.code, slow.stdout).toBe(3);
    expect(slow.doc.problems[0]?.kind).toBe("router");
    expect(existsSync(join(run, "freerouting/001/request.json"))).toBe(false);
    await writeFile(
      join(dir, "bad.ses"),
      "(session x (routes (resolution um 10) (network_out (net VIN (wire (path F.Cu",
    );
    const corrupt = route(["--run", "electronics-results/failing"], dir, {
      FREEROUTING_TEST_SES: join(dir, "bad.ses"),
    });
    expect(corrupt.code, corrupt.stdout).toBe(3);
    expect(corrupt.doc.problems[0]?.kind).toBe("ses");
    expect(existsSync(join(run, "freerouting/002/request.json"))).toBe(false);
    expect(sha256(await readFile(join(run, "candidate/layout.kicad_pcb")))).toBe(sha);
  }, 300_000);
});

describe.skipIf(!gui)("freerouting golden path in KiCad's PCB editor (VERA_TEST_KICAD_GUI)", () => {
  // REQ-FUNC-2a80da7f, REQ-FUNC-93285684: open -> route -> edit --request -> zero unconnected, old copper kept.
  it("routes a candidate to zero unconnected items through kicad-layout", async () => {
    const opened = runScript(
      layoutTool,
      ["open", "--board", "boards/layout.kicad_pcb", "--run-id", "golden"],
      dir,
      {},
      true,
    );
    expect(opened.code, opened.stdout).toBe(0);
    try {
      const before = await json(join(dir, "electronics-results/golden/board.json"));
      expect(opened.doc.unconnected.before).toBeGreaterThan(0);
      const routed = route(["--run", "electronics-results/golden"], dir);
      expect(routed.code, routed.stdout).toBe(0);
      const edited = runScript(
        layoutTool,
        ["edit", "--run", "electronics-results/golden", "--request", routed.doc.request],
        dir,
      );
      expect(edited.code, edited.stdout).toBe(0);
      expect(edited.doc.unconnected.after).toBe(0);
      expect(edited.doc.drc.newCount).toBe(0);
      expect(edited.doc.objectives.status).toBe("pass");
      const after = await json(join(dir, "electronics-results/golden/board.json"));
      // KiCad counts segments: a track operation with n points makes n - 1 of them.
      const request = await json(join(dir, routed.doc.request));
      const segments = request.operations
        .filter((o: Doc) => o.op === "track")
        .reduce((sum: number, o: Doc) => sum + o.points.length - 1, 0);
      expect(after.tracks).toBe(before.tracks + segments);
      expect(after.vias).toBe(before.vias + routed.doc.operations.vias);
      // Every footprint, including the locked ones, is where it was.
      expect(after.footprints.map((f: Doc) => [f.reference, f.at, f.orientation])).toEqual(
        before.footprints.map((f: Doc) => [f.reference, f.at, f.orientation]),
      );
    } finally {
      runScript(layoutTool, ["close", "--run", "electronics-results/golden"], dir);
    }
  }, 900_000);
});
