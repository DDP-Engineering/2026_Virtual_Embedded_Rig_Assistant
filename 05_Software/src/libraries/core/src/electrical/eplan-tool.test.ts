// The EPLAN tools on the plant M bench (spec REQ-DATA-203d52e6): a real electrical-documentation run, the fictional
// EPLAN exports of tests/fixtures/eplan, reconcile with the documentation lists, the device list import candidate,
// the check result with its round-trip and outcome criteria, refusals before any change and gating. EPLAN itself is
// not involved: a "re-export" here is a file the test writes, so these tests prove VERA's own mapping and
// verification, never interoperability with EPLAN (the real-application criteria stay open).
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectricalResult, EplanOutcome } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../index.js";
import { PLANT_M, type PlantMBench, plantMBench } from "./plant-m.test-support.js";

// biome-ignore lint/suspicious/noExplicitAny: printed JSON documents and fixture data, checked field by field.
type Json = any;
const fixtures = new URL("../../../../../tests/fixtures/eplan/", import.meta.url);
const PROFILE = "electrical-automation-eplan/epl-plant-m.json";
const DEVICES = "eplan/export/devices.csv";
const TERMINALS = "eplan/export/terminals.txt";
const CONNECTIONS = "eplan/export/connections.txt";
const LINK = "C:\\EPLAN\\Projects\\PlantM-MCP1.elk";
let bench: PlantMBench;
let root: string;
let profileSha: string;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const read = (path: string) => readFile(join(root, path), "utf8");
const write = async (path: string, body: string) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), body);
};

beforeEach(async () => {
  bench = await plantMBench("vera-eplan-");
  root = bench.root;
  for (const [to, from] of [
    [PROFILE, "epl-plant-m.json"],
    [DEVICES, "devices-plant-m.csv"],
    [TERMINALS, "terminals-plant-m.txt"],
    [CONNECTIONS, "connections-plant-m.txt"],
  ] as const)
    await write(to, await readFile(new URL(from, fixtures), "utf8"));
  profileSha = hash(await read(PROFILE));
});
afterEach(async () => {
  await bench?.close();
});

/** The upstream chain and one documentation run of plant M. */
async function documentationRun(): Promise<string> {
  const { panel } = await bench.upstream();
  return bench.applied(bench.documentation(panel));
}
const view = (args: Record<string, unknown>) =>
  api.eplanTool.execute(bench.context(), args, signal()) as Promise<Record<string, Json>>;
const reconcile = (documentationRun: string, extra: Record<string, unknown> = {}) =>
  view({
    view: "reconcile",
    profile: "epl-plant-m",
    documentationRun,
    devices: DEVICES,
    terminals: TERMINALS,
    connections: CONNECTIONS,
    ...extra,
  });
async function stored(run: string): Promise<ElectricalResult> {
  return JSON.parse(await read(`electrical-automation-results/${run}/result.json`)) as ElectricalResult;
}
const criterion = (result: ElectricalResult, id: string) => result.criteria.find((entry) => entry.id === id);
async function allFiles(dir = root, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".vera") continue;
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...(await allFiles(join(dir, entry.name), `${path}/`)));
    else out.push(path);
  }
  return out.sort();
}
const sources = [PROFILE, DEVICES, TERMINALS, CONNECTIONS, PLANT_M.model];
const hashes = () => Promise.all(sources.map(async (path) => hash(await read(path))));

/**
 * The base export of the candidate tests: Q1-M1 with another part, G1 without a part, S1-M2 missing, KM1-M1 without its
 * VERA ID, an EPLAN-only lamp.
 */
async function plantedBase(): Promise<string> {
  const base = (await read(DEVICES))
    .replace("=P+MCP1-Q1-M1;SE.GV2ME10;", "=P+MCP1-Q1-M1;SE.GV2ME08;")
    .replace("=P+MCP1-G1;SE.ABLS1A24050;", "=P+MCP1-G1;;")
    .replace("=P+MCP1-S1-M2;SE.XB5AA31;Start M2;;Door\n", "")
    .replace("Line contactor M1;dev-km1-m1;", "Line contactor M1;;")
    .concat("=P+MCP1-H1;SE.XVBC2B4;Lamp running;;Door\n");
  await write(DEVICES, base);
  return base;
}
const candidate = (documentationRun: string, base: string, extra: Record<string, unknown> = {}) =>
  api.prepareEplanChange(
    bench.context(),
    {
      action: "candidate",
      profile: "epl-plant-m",
      base: DEVICES,
      sha256: hash(base),
      documentationRun,
      path: "eplan/candidate/devices-import.csv",
      ...extra,
    },
    signal(),
  );
function outcome(files: Record<string, string>, extra: Partial<EplanOutcome> = {}): EplanOutcome {
  return {
    kind: "vera-eplan-outcome",
    format: 1,
    tool: "eplan-tool 0.1.0",
    operation: "import",
    status: "completed",
    reason: null,
    profile: { path: PROFILE, sha256: profileSha },
    project: LINK,
    copy: "C:\\EPLAN\\Projects\\PlantM-MCP1-vera.elk",
    candidate: { path: "eplan/candidate/devices-import.csv", sha256: "0".repeat(64) },
    eplan: "C:\\Program Files\\EPLAN\\Platform\\2025.0.3\\Bin\\EPLAN.exe",
    steps: ["snapshot", "import", "reports", ...Object.keys(files).map((table) => `export-${table}`)].map(
      (name) => ({
        name: name as EplanOutcome["steps"][number]["name"],
        command: `"EPLAN.exe" ${name}`,
        exit: 0,
        seconds: 1,
        file: null,
      }),
    ),
    files: Object.entries(files).map(([table, body]) => ({
      table: table as "devices",
      path: `eplan/reexport/${table}`,
      sha256: hash(body),
    })),
    startedAt: "2026-11-16T10:00:00Z",
    finishedAt: "2026-11-16T10:01:00Z",
    ...extra,
  };
}
const check = (documentationRun: string, extra: Record<string, unknown> = {}) =>
  api.prepareEplanCheck(
    bench.context(),
    {
      profile: "epl-plant-m",
      documentationRun,
      exports: { devices: DEVICES, terminals: TERMINALS, connections: CONNECTIONS },
      ...extra,
    },
    signal(),
  );

describe("reconcile with the documentation lists (CAD-04-D, REQ-FUNC-f415fdc8)", () => {
  it("matches devices, part numbers, terminals and connections and proposes eplanTag operations it never applies", async () => {
    const run = await documentationRun();
    const before = await hashes();
    const files = await allFiles();
    const out = await reconcile(run);
    expect(out.devices.eplanOnly).toEqual([]);
    expect(out.devices.veraOnly).toEqual([]);
    expect(out.devices.duplicates).toEqual([]);
    expect(out.devices.matched).toHaveLength(15);
    expect(out.devices.matched.find((m: { tag: string }) => m.tag === "KM1-M1")).toMatchObject({
      eplan: "=P+MCP1-KM1-M1",
      by: "vera",
      object: "dev-km1-m1",
      part: { eplan: "SE.LC1D09P7", vera: "SE.LC1D09P7", verdict: "match" },
    });
    expect(out.devices.matched.find((m: { tag: string }) => m.tag === "Q1-M2").part.vera).toBe("ETN.C10G32");
    expect(out.devices.matched.find((m: { tag: string }) => m.tag === "KT1-M2").part.verdict).toBe("unknown");
    expect(out.devices.differs).toEqual([]);
    expect(out.terminals).toMatchObject({ matched: 14, eplanOnly: [], veraOnly: [] });
    expect(out.connections).toMatchObject({ eplanOnly: [], veraOnly: [], wireDiffers: [] });
    expect(out.connections.matched).toBeGreaterThan(50);
    expect(out.operations).toEqual([
      { op: "update-object", id: "dev-a1", attributes: { eplanTag: "=P+MCP1-A1" } },
      { op: "update-object", id: "dev-f1-m2", attributes: { eplanTag: "=P+MCP1-F1-M2" } },
      { op: "update-object", id: "dev-km1-m1", attributes: { eplanTag: "=P+MCP1-KM1-M1" } },
      { op: "update-object", id: "dev-km1-m2", attributes: { eplanTag: "=P+MCP1-KM1-M2" } },
    ]);
    expect(await allFiles()).toEqual(files);
    expect(await hashes()).toEqual(before);

    // Planted differences: a part number, a missing device, an extra terminal and another wire number.
    await write(
      DEVICES,
      (await read(DEVICES))
        .replace("=P+MCP1-Q1-M1;SE.GV2ME10;", "=P+MCP1-Q1-M1;SE.GV2ME08;")
        .replace("=P+MCP1-S1-M2;SE.XB5AA31;Start M2;;Door\n", "")
        .concat("=P+MCP1-KM1-M1;SE.LC1D09P7;Duplicate;;Plate\n"),
    );
    await write(TERMINALS, `${await read(TERMINALS)}=P+MCP1-X1;PE\n`);
    await write(
      CONNECTIONS,
      (await read(CONNECTIONS)).replace(
        "=P+MCP1-X0:L1;=P+MCP1-Q1-M1:1;101;",
        "=P+MCP1-X0:L1;=P+MCP1-Q1-M1:1;199;",
      ),
    );
    const planted = await reconcile(run);
    expect(planted.devices.differs).toEqual([
      {
        tag: "Q1-M1",
        eplan: "=P+MCP1-Q1-M1",
        field: "part",
        eplanValue: "SE.GV2ME08",
        veraValue: "SE.GV2ME10",
      },
    ]);
    expect(planted.devices.veraOnly).toEqual([{ tag: "S1-M2", part: "SE.XB5AA31", object: null }]);
    expect(planted.devices.duplicates).toEqual(["KM1-M1"]);
    expect(planted.terminals.eplanOnly).toEqual(["X1:PE"]);
    expect(planted.connections.wireDiffers).toEqual([{ ends: "Q1-M1:1|X0:L1", eplan: "199", vera: "101" }]);
  }, 60_000);

  it("pages one table with its unmapped columns (view inspect)", async () => {
    const out = await view({ view: "inspect", profile: "epl-plant-m", table: "devices", path: DEVICES });
    expect(out).toMatchObject({ table: "devices", total: 15, unmapped: ["Mounting location"] });
    expect(out.records[0]).toMatchObject({
      line: 2,
      values: { tag: "=P+MCP1-Q1-M1" },
      extra: { "Mounting location": "Plate" },
    });
    expect(out.sha256).toBe(hash(await read(DEVICES)));
  });
});

describe("device list import candidate (CAD-04-B, REQ-FUNC-0103d4c6)", () => {
  it("keeps untouched records byte for byte, updates parts and VERA IDs, appends missing devices and reports what cannot transfer", async () => {
    const run = await documentationRun();
    const base = await plantedBase();
    const files = await allFiles();
    const before = await hashes();
    const change = await candidate(run, base);
    expect(change.request).toMatchObject({ tool: "eplan_change", beforeSha256: null, existed: false });
    expect(await allFiles()).toEqual(files);
    const applied = (await change.apply(signal())) as Record<string, Json>;
    expect(await allFiles()).toEqual([...files, "eplan/candidate/devices-import.csv"].sort());
    expect(await hashes()).toEqual(before);
    const out = await read("eplan/candidate/devices-import.csv");
    const baseLines = base.split("\n");
    const outLines = out.split("\n");
    expect(outLines[0]).toBe(baseLines[0]);
    for (const line of baseLines)
      if (line && !/^=P\+MCP1-(Q1-M1|KM1-M1|G1);/.test(line)) expect(outLines, line).toContain(line);
    expect(outLines).toContain("=P+MCP1-Q1-M1;SE.GV2ME10;Motor circuit breaker M1;;Plate");
    expect(outLines).toContain("=P+MCP1-KM1-M1;SE.LC1D09P7;Line contactor M1;dev-km1-m1;Plate");
    expect(outLines).toContain("=P+MCP1-G1;SE.ABLS1A24050;Power supply 24 V DC;;Plate");
    expect(outLines).toContain("-S1-M2;SE.XB5AA31;;;");
    expect(outLines).toContain("=P+MCP1-H1;SE.XVBC2B4;Lamp running;;Door");
    expect(out.endsWith("\n")).toBe(true);
    expect(applied.report).toMatchObject({
      updated: [
        { tag: "Q1-M1", fields: ["part"] },
        { tag: "KM1-M1", fields: ["vera"] },
        { tag: "G1", fields: ["part"] },
      ],
      added: ["S1-M2"],
      eplanOnly: ["H1"],
    });
    expect(applied.report.unchanged).toBe(12);
    expect(applied.report.notTransferred.join(" ")).toMatch(/connections.*terminals.*macros/s);
    expect(applied.sha256).toBe(hash(out));
  }, 60_000);

  it("keeps CRLF line endings and the byte order mark", async () => {
    const run = await documentationRun();
    const base = `\uFEFF${(await plantedBase()).replaceAll("\n", "\r\n")}`;
    await write(DEVICES, base);
    await (await candidate(run, base)).apply(signal());
    const out = await read("eplan/candidate/devices-import.csv");
    expect(out.startsWith("\uFEFFDevice tag;")).toBe(true);
    expect(out.replaceAll("\r\n", "")).not.toContain("\n");
    expect(out).toContain("\r\n-S1-M2;SE.XB5AA31;;;\r\n");
  }, 60_000);
});

describe("refusals before any change (REQ-REL-f8d51ff3)", () => {
  it("refuses a changed base, an existing target, a missing profile, a foreign run, unmapped columns and read-only sessions", async () => {
    const { panel } = await bench.upstream();
    const run = await bench.applied(bench.documentation(panel));
    const base = await plantedBase();
    const files = await allFiles();
    await expect(candidate(run, base, { sha256: hash("other") })).rejects.toThrow(
      /The base export eplan\/export\/devices\.csv changed: its sha256 is .* not .*/,
    );
    await write("eplan/candidate/devices-import.csv", "x");
    await expect(candidate(run, base)).rejects.toThrow(/already exists/);
    await expect(candidate(run, base, { profile: "epl-none" })).rejects.toThrow(
      /The EPLAN profile electrical-automation-eplan\/epl-none\.json does not exist/,
    );
    await expect(candidate(panel, base, { path: "eplan/c2.csv" })).rejects.toThrow(
      /is not an electrical_documentation_check result/,
    );
    const profile = JSON.parse(await read(PROFILE));
    delete profile.tables.devices.columns.part;
    delete profile.tables.devices.columns.vera;
    await write(PROFILE, JSON.stringify(profile));
    await expect(candidate(run, base, { path: "eplan/c2.csv" })).rejects.toThrow(
      /maps neither a part nor a VERA ID column/,
    );
    await expect(
      api.prepareEplanChange(
        bench.context(true),
        {
          action: "candidate",
          profile: "epl-plant-m",
          base: DEVICES,
          sha256: hash(base),
          documentationRun: run,
          path: "eplan/c3.csv",
        },
        signal(),
      ),
    ).rejects.toThrow(/read-only/);
    await expect(check(run, { exports: { devices: "eplan/none.csv" } })).rejects.toThrow(/does not exist/);
    await expect(
      check(run, {
        base: { path: DEVICES, sha256: hash("other") },
        candidate: "eplan/candidate/devices-import.csv",
      }),
    ).rejects.toThrow(/The base export eplan\/export\/devices\.csv changed/);
    await expect(check(run, { profile: "epl-none" })).rejects.toThrow(/does not exist/);
    await expect(
      api.prepareEplanCheck(
        bench.context(true),
        { profile: "epl-plant-m", documentationRun: run, exports: { devices: DEVICES } },
        signal(),
      ),
    ).rejects.toThrow(/read-only/);
    expect((await allFiles()).filter((path) => !files.includes(path))).toEqual([
      "eplan/candidate/devices-import.csv",
    ]);
  }, 60_000);
});

describe("check result (CAD-04-B, CAD-04-D, REQ-FUNC-8b2ae38f)", () => {
  it("stores reconcile criteria with sources and fails a planted difference", async () => {
    const run = await documentationRun();
    const before = await hashes();
    const result = await stored(await bench.applied(check(run)));
    expect(result.producer).toEqual({
      plugin: "eplan",
      operation: "check",
      engine: { name: "vera-eplan", version: "1.0.0" },
    });
    for (const id of ["source:documentation", "devices", "part-numbers", "terminals", "connections"])
      expect(criterion(result, id)?.verdict, id).toBe("pass");
    expect(criterion(result, "outcome")).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.sources).toContain(`eplan-profile:${PROFILE}@sha256:${hash(await read(PROFILE))}`);
    expect(result.sources).toContain(`eplan-devices:${DEVICES}@sha256:${hash(await read(DEVICES))}`);
    expect(result.sources).toContain(`documentation:${run}`);
    expect(await hashes()).toEqual(before);
    await write(DEVICES, (await read(DEVICES)).replace("SE.GV2ME10", "SE.GV2ME08"));
    const planted = await stored(await bench.applied(check(run)));
    expect(criterion(planted, "part-numbers")).toMatchObject({ verdict: "fail" });
    expect(criterion(planted, "part-numbers")?.note).toContain("Q1-M1: EPLAN SE.GV2ME08, VERA SE.GV2ME10");
  }, 60_000);

  it("verifies the round trip: identity, unchanged and applied pass on a faithful re-export and fail on each planted loss", async () => {
    const run = await documentationRun();
    const base = await plantedBase();
    await (await candidate(run, base)).apply(signal());
    const cand = await read("eplan/candidate/devices-import.csv");
    const roundTrip = async (reexport: string, extra: Partial<EplanOutcome> = {}) => {
      await write("eplan/reexport/devices.csv", reexport);
      await write(
        "eplan/reexport/outcome.json",
        JSON.stringify(
          outcome(
            { devices: reexport },
            {
              candidate: { path: "eplan/candidate/devices-import.csv", sha256: hash(cand) },
              ...extra,
            },
          ),
        ),
      );
      return stored(
        await bench.applied(
          check(run, {
            exports: { devices: "eplan/reexport/devices.csv" },
            base: { path: DEVICES, sha256: hash(base) },
            candidate: "eplan/candidate/devices-import.csv",
            outcome: "eplan/reexport/outcome.json",
          }),
        ),
      );
    };
    // A faithful re-export: EPLAN may reorder columns; values are compared by header name.
    // The last column (Mounting location) never holds ; so it moves to the front without a CSV writer.
    const reordered = cand
      .split("\n")
      .map((line) => line.replace(/^(.*);([^;]*)$/, "$2;$1"))
      .join("\n");
    expect(reordered.split("\n")[0]).toBe("Mounting location;Device tag;Part number;Function text;VERA ID");
    // EPLAN may give the appended -S1-M2 its structure: it is still found by its identifier.
    expect(reordered).toContain(";-S1-M2;");
    const faithful = await roundTrip(reordered.replace(";-S1-M2;", ";=P+MCP1-S1-M2;"));
    for (const id of ["identity", "unchanged", "applied", "outcome"])
      expect(criterion(faithful, id)?.verdict, id).toBe("pass");
    expect(faithful.status).toBe("completed");

    const lost = await roundTrip(cand.replace("=P+MCP1-H1;SE.XVBC2B4;Lamp running;;Door\n", ""));
    expect(criterion(lost, "identity")).toMatchObject({ verdict: "fail" });
    expect(criterion(lost, "identity")?.note).toContain("=P+MCP1-H1");
    const touched = await roundTrip(cand.replace("Stop M1;;Door", "Stop M1;;Plate"));
    expect(criterion(touched, "unchanged")).toMatchObject({ verdict: "fail" });
    expect(criterion(touched, "unchanged")?.note).toContain("=P+MCP1-S0-M1: Mounting location");
    const missing = await roundTrip(cand.replace("=P+MCP1-Q1-M1;SE.GV2ME10;", "=P+MCP1-Q1-M1;SE.GV2ME08;"));
    expect(criterion(missing, "applied")).toMatchObject({ verdict: "fail" });
    expect(criterion(missing, "applied")?.note).toContain("=P+MCP1-Q1-M1: Part number");
  }, 90_000);
});

describe("no success without a completed outcome (CAD-04-C, REQ-REL-803299e7)", () => {
  it("fails outcome for a missing, refused, failed, interrupted, foreign or mismatched outcome and marks the run incomplete", async () => {
    const run = await documentationRun();
    const base = await plantedBase();
    await (await candidate(run, base)).apply(signal());
    const cand = await read("eplan/candidate/devices-import.csv");
    await write("eplan/reexport/devices.csv", cand);
    const args = (outcomePath?: string) => ({
      exports: { devices: "eplan/reexport/devices.csv" },
      base: { path: DEVICES, sha256: hash(base) },
      candidate: "eplan/candidate/devices-import.csv",
      ...(outcomePath ? { outcome: outcomePath } : {}),
    });
    const good = { candidate: { path: "eplan/candidate/devices-import.csv", sha256: hash(cand) } };
    const cases: [string, Partial<EplanOutcome> | null, RegExp][] = [
      ["missing", null, /no eplan-tool outcome/],
      ["refused", { ...good, status: "refused", reason: "conflict" }, /refused: conflict/],
      ["failed", { ...good, status: "failed", reason: "step-failed:import" }, /failed: step-failed:import/],
      ["interrupted", { ...good, status: "interrupted", reason: "stopped" }, /interrupted: stopped/],
      [
        "project",
        { ...good, project: "C:\\EPLAN\\Projects\\Other.elk" },
        /names the project C:\\EPLAN\\Projects\\Other\.elk/,
      ],
      ["candidate", { candidate: { path: "x.csv", sha256: "1".repeat(64) } }, /another candidate/],
      ["operation", { ...good, operation: "export" }, /not an import/],
      ["profile", { ...good, profile: { path: PROFILE, sha256: "2".repeat(64) } }, /another profile/],
      ["steps", { ...good, steps: [] }, /no snapshot step that exited 0/],
    ];
    for (const [name, extra, message] of cases) {
      let path: string | undefined;
      if (extra) {
        path = `eplan/reexport/outcome-${name}.json`;
        await write(path, JSON.stringify(outcome({ devices: cand }, extra)));
      }
      const result = await stored(await bench.applied(check(run, args(path))));
      expect(criterion(result, "outcome"), name).toMatchObject({ verdict: "fail" });
      expect(criterion(result, "outcome")?.note, name).toMatch(message);
      expect(criterion(result, "applied")?.verdict, name).not.toBe("pass");
      expect(result.status, name).toBe("incomplete");
    }
    await write("eplan/reexport/outcome-sha.json", JSON.stringify(outcome({ devices: "other" }, good)));
    const sha = await stored(await bench.applied(check(run, args("eplan/reexport/outcome-sha.json"))));
    expect(criterion(sha, "outcome")?.note).toMatch(/devices re-export .* differs from the outcome/);
    await write("eplan/reexport/outcome-bad.json", "{}");
    const bad = await stored(await bench.applied(check(run, args("eplan/reexport/outcome-bad.json"))));
    expect(criterion(bad, "outcome")?.note).toMatch(/not a valid eplan-tool outcome/);
  }, 120_000);
});

describe("gating (REQ-SEC-4dfa2a5b)", () => {
  it("offers the EPLAN tools only with the eplan plugin and never the write tools read-only", () => {
    for (const name of ["eplan", "eplan_change", "eplan_check"]) {
      expect(api.electricalToolOffered(name, ["eplan"]), name).toBe(true);
      expect(api.electricalToolOffered(name, ["electrical-documentation", "qelectrotech"]), name).toBe(false);
    }
    expect(api.eplanTool.class).toBe("read");
    expect(api.eplanChangeTool.class).toBe("write");
    expect(api.eplanCheckTool.class).toBe("write");
  });
});
