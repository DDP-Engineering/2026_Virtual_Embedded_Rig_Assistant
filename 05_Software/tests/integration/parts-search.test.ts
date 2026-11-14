// The parts-search plugin: package, catalog and skills, and the parts-compare script on the toolchain's Python
// against the hand-derived fixtures of tests/fixtures/parts-search (expected values in its README). VERA_PARTS_UV
// names a real uv: the opt-in test provisions the script on uv's managed Python and runs it offline.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("parts-search/", plugins));
const scripts = join(source, "scripts");
const script = join(scripts, "parts_compare.py");
const fixtures = fileURLToPath(new URL("../fixtures/parts-search/", import.meta.url));
const windows = process.platform === "win32";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const STDOUT_LIMIT = 11000;
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
const env = () => ({ ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" });

interface Check {
  constraint: string;
  status: string;
  value: string | null;
  evidence: {
    value: string;
    basis: string;
    conditions: Record<string, string>;
    source: Record<string, unknown>;
  }[];
  reasons: string[];
}
interface Offer {
  supplier: string;
  sku: string;
  orderQuantity: number;
  unitPrice: number | null;
  extendedPrice: number | null;
  currency: string | null;
  retrievedAt: string;
  basis: string;
  stale: boolean;
}
interface DeviceRow {
  rank: number | null;
  outcome: string;
  manufacturer: string;
  mpn: string;
  package: string | null;
  mergedFrom: number[];
  dropIn: string | null;
  checks: Check[];
  unconfirmedValues: { name: string; value: string; status: string }[];
  offers: Offer[];
}
interface Comparison {
  format: number;
  kind: string;
  proposed: number | null;
  currency: string | null;
  devices: DeviceRow[];
  warnings: string[];
  limits: string[];
}

function stamp(hours: number) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}
async function fixture(name: string) {
  return (await readFile(join(fixtures, name), "utf8"))
    .replaceAll('"{{-1h}}"', JSON.stringify(stamp(1)))
    .replaceAll('"{{-25h}}"', JSON.stringify(stamp(25)));
}
function run(cwd: string, args: string[]) {
  const result = spawnSync(python, ["-I", script, ...args], { cwd, encoding: "utf8", env: env() });
  return {
    code: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    doc: result.stdout ? JSON.parse(result.stdout) : undefined,
  };
}
async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true }))
    if (entry.isFile())
      out.push(
        join(entry.parentPath, entry.name)
          .slice(dir.length + 1)
          .replaceAll("\\", "/"),
      );
  return out.sort();
}

it("publishes the official parts-search package, its pack group, activity and two skills (REQ-FUNC-98175a73)", async () => {
  const m: PluginManifest = parse(await readFile(new URL("parts-search/plugin.yaml", plugins), "utf8"));
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "parts-search",
    version: "1.0.0",
    ecosystem: "electronics",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(Object.keys(m.programs)).toEqual(["parts-compare"]);
  expect(m.programs["parts-compare"]?.install).toEqual({ script: "scripts/parts_compare.py" });
  const risk = (args: string[]) => classifyCommand(m.rules ?? [], "parts-compare", args).risk;
  expect(risk(["compare", "--input", "r.json"])).toBe("safe");
  expect(risk(["--version"])).toBe("safe");
  expect(risk(["order", "--now"])).toBe("device-write");
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("parts-search");
  expect(catalog.metadata["parts-search"].activities).toEqual(["design"]);
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs.find((pack: { id: string }) => pack.id === "electronics")?.groups).toContainEqual({
    name: "Component selection",
    plugins: ["parts-search"],
    default: true,
  });
  expect(await core.checkCatalogSource(fileURLToPath(plugins))).toEqual([]);
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-parts-skills-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("parts-search");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const listed = (await skills.list()).filter((skill) => skill.plugin === "parts-search");
    expect(listed.map((skill) => skill.name)).toEqual(["component-families", "component-selection"]);
    const families = (await skills.read("plugin", "component-families")).content;
    for (const family of [
      "## MOSFET",
      "## Regulator",
      "## Op-amp",
      "## Resistor",
      "## Capacitor",
      "## Diode",
      "## Inductor",
      "DC bias",
      "Isat",
      "dropout",
      "common-mode",
      "SOA",
      "pinout",
    ])
      expect(families).toContain(family);
    const selection = (await skills.read("plugin", "component-selection")).content;
    for (const text of [
      "parts_search",
      "parts-compare compare",
      "Hard constraints",
      "Preferences",
      "VGS(th)",
      "proposed",
      "snapshot",
      "never present it as ordered",
    ])
      expect(selection).toContain(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps the shared path module byte-identical in the three electronics plugins", async () => {
  const copies = await Promise.all(
    [
      "electronics-calc/scripts/elec_support",
      "kicad/scripts/kicad_support",
      "parts-search/scripts/parts_support",
    ].map((folder) => readFile(fileURLToPath(new URL(`${folder}/workspace.py`, plugins)))),
  );
  expect(new Set(copies.map(sha256)).size).toBe(1);
});

it("imports nothing that can reach a network or place an order (REQ-FUNC-8dfa1ca5)", async () => {
  for (const name of await readdir(join(scripts, "parts_support"))) {
    if (!name.endsWith(".py")) continue;
    const text = await readFile(join(scripts, "parts_support", name), "utf8");
    expect(text, name).not.toMatch(
      /^\s*(?:import|from)\s+(?:socket|ssl|http|urllib|ftplib|smtplib|asyncio|subprocess)\b/m,
    );
  }
});

describe("parts-compare", { timeout: 120_000 }, () => {
  let dir: string;
  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "vera-parts-compare-")));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("decides on confirmed evidence under the stated conditions, groups SKUs into devices and writes three files (E03-C, E03-D, E03-E)", async () => {
    const body = await fixture("mosfet-24v.json");
    await writeFile(join(dir, "mosfet.json"), body);
    const before = await files(dir);
    const result = run(dir, ["compare", "--input", "mosfet.json", "--run-id", "m1"]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(STDOUT_LIMIT);
    expect(result.doc).toMatchObject({
      kind: "parts-compare-summary",
      status: "ok",
      proposed: "FS3025L",
      devices: [
        { mpn: "FS3025L", outcome: "eligible", rank: 1 },
        { mpn: "FS3025L-P", outcome: "eligible", rank: 2 },
        { mpn: "FS3040", outcome: "unknown", rank: null },
        { mpn: "FS3030T", outcome: "unknown", rank: null },
        { mpn: "FS6020", outcome: "rejected", rank: null },
      ],
    });
    expect(await files(dir)).toEqual(
      [
        ...before,
        "electronics-results/m1/bom.csv",
        "electronics-results/m1/comparison.json",
        "electronics-results/m1/comparison.md",
      ].sort(),
    );
    expect(await readFile(join(dir, "mosfet.json"), "utf8")).toBe(body);
    const comparison = JSON.parse(
      await readFile(join(dir, "electronics-results/m1/comparison.json"), "utf8"),
    ) as Comparison;
    const device = (mpn: string) => comparison.devices.find((row) => row.mpn === mpn) as DeviceRow;
    const check = (mpn: string, id: string) =>
      device(mpn).checks.find((item) => item.constraint === id) as Check;
    // E03-C: RDS(on) at VGS 10 V and VGS(th) are not evidence at a 3.3 V drive.
    expect(check("FS3040", "rdson")).toMatchObject({
      status: "unknown",
      evidence: [],
      reasons: ["RDS(on) 28 mΩ: VGS 10 V does not meet VGS <= 3.3 V"],
    });
    expect(check("FS3030T", "rdson").reasons).toEqual([
      "RDS(on) 30 mΩ: typical value is not a guarantee",
      "RDS(on) 36 mΩ: proposed, not confirmed in the datasheet",
    ]);
    expect(check("FS3030T", "vds")).toMatchObject({
      status: "unknown",
      reasons: ["VDS 30 V: supplier value, not a datasheet value"],
    });
    expect(device("FS3030T").unconfirmedValues.map((item) => item.name)).toEqual(["VDS", "RDS(on)"]);
    // Only the qualifying row at VGS 2.5 V decides; the 4.5 V row is not evidence at a 3.3 V drive.
    expect(check("FS3025L", "rdson")).toMatchObject({
      status: "pass",
      value: "35 mΩ",
      evidence: [
        {
          value: "35 mΩ",
          basis: "max",
          conditions: { VGS: "2.5 V", ID: "3 A" },
          source: {
            kind: "datasheet",
            page: 3,
            table: "Electrical characteristics",
            url: "https://example.com/fs3025l.pdf",
            revision: "Rev. 4",
          },
        },
      ],
    });
    expect(check("FS3025L-P", "rdson")).toMatchObject({ status: "pass", value: "38 mΩ" });
    expect(check("FS6020", "vds")).toMatchObject({ status: "fail", value: "20 V" });
    // E03-D: cut tape and reel of one MPN and package are one device; the pinout variant is another.
    expect(device("FS3025L")).toMatchObject({ mergedFrom: [1, 2], dropIn: "yes" });
    expect(
      device("FS3025L").offers.map((offer) => [
        offer.supplier,
        offer.orderQuantity,
        offer.unitPrice,
        offer.extendedPrice,
        offer.stale,
        offer.basis,
      ]),
    ).toEqual([
      ["mouser", 100, 0.19, 19, false, "snapshot"],
      ["digikey", 3000, 0.07, 210, true, "snapshot"],
    ]);
    expect(device("FS3025L-P")).toMatchObject({
      dropIn: "no",
      offers: [{ orderQuantity: 100, unitPrice: 0.15, extendedPrice: 15 }],
    });
    expect(device("FS3040").dropIn).toBe("unknown");
    expect(device("FS3030T").offers[0]).toMatchObject({ currency: null, unitPrice: 0.2 });
    expect(comparison.devices[comparison.proposed as number]?.mpn).toBe("FS3025L");
    expect(comparison.warnings).toEqual([
      "Candidates 1 and 2 are the same device (FICTIONAL SEMI fs3025l, SOT-23); their offers and values were merged.",
      "1 offer(s) were captured more than 24 hours before this run; search again for current values.",
    ]);
    const bom = await readFile(join(dir, "electronics-results/m1/bom.csv"), "utf8");
    const captured = device("FS3025L").offers[0]?.retrievedAt;
    expect(bom).toBe(
      "Status,Quantity,Manufacturer,MPN,Package,Supplier,SKU,Packaging,OrderQuantity,UnitPrice,Currency,CapturedAt,Stale\r\n" +
        `proposed,100,Fictional Semi,FS3025L,SOT-23,mouser,FS-3025L-CT,Cut Tape,100,0.19,EUR,${captured},no\r\n`,
    );
    const markdown = await readFile(join(dir, "electronics-results/m1/comparison.md"), "utf8");
    for (const text of [
      "**Proposed:** Fictional Semi FS3025L",
      "page 3, Electrical characteristics, Rev. 4",
      "VGS 10 V does not meet VGS <= 3.3 V",
      "| digikey | FS3025L-TR-ND |",
      "| yes |",
      "Nothing is ordered",
    ])
      expect(markdown).toContain(text);
    // A run folder is never overwritten.
    const again = run(dir, ["compare", "--input", "mosfet.json", "--run-id", "m1"]);
    expect(again.code).toBe(2);
    expect(again.doc.errors[0]).toMatchObject({ code: "output" });
  });

  it("compares prices only within one currency and proposes nothing without an eligible device (REQ-FUNC-1d01263c, REQ-FUNC-f2b0b6c6)", async () => {
    const request = JSON.parse(await fixture("mosfet-24v.json"));
    delete request.currency;
    request.candidates[3].offers[0].currency = "USD";
    request.preferences = [{ criterion: "price" }];
    const mixed = run(dir, ["compare", "--json", JSON.stringify(request), "--run-id", "mixed"]);
    expect(mixed.code, mixed.stdout).toBe(0);
    expect(mixed.doc.warnings).toContain(
      "The price preference was skipped: the offers are in different currencies (give a request currency).",
    );
    request.candidates = request.candidates.filter((candidate: { mpn: string }) =>
      ["FS3040", "FS6020"].includes(candidate.mpn),
    );
    const none = run(dir, ["compare", "--json", JSON.stringify(request), "--run-id", "none"]);
    expect(none.doc).toMatchObject({
      proposed: null,
      devices: [
        { mpn: "FS3040", outcome: "unknown" },
        { mpn: "FS6020", outcome: "rejected" },
      ],
    });
    expect(await readFile(join(dir, "electronics-results/none/bom.csv"), "utf8")).toBe(
      "Status,Quantity,Manufacturer,MPN,Package,Supplier,SKU,Packaging,OrderQuantity,UnitPrice,Currency,CapturedAt,Stale\r\n",
    );
  });

  it("refuses an invalid request with every problem and writes nothing (REQ-REL-4f8d5368)", async () => {
    const request = JSON.parse(await fixture("mosfet-24v.json"));
    delete request.quantity;
    request.constraints[0].value = "thirty volts";
    request.constraints.push({ id: "vds", parameter: "VDS", op: ">=", value: "40 V" });
    request.candidates[0].offers[0].retrievedAt = new Date(Date.now() + 3600_000).toISOString();
    request.candidates[0].unknown = 1;
    const refused = run(dir, ["compare", "--json", JSON.stringify(request), "--run-id", "bad"]);
    expect(refused.code).toBe(2);
    expect(
      refused.doc.errors.map((problem: { code: string; path: string }) => [problem.code, problem.path]),
    ).toEqual(
      expect.arrayContaining([
        ["schema", "quantity"],
        ["unit", "constraints.0.value"],
        ["schema", "constraints.3.id"],
        ["schema", "candidates.0.offers.0.retrievedAt"],
        ["schema", "candidates.0.unknown"],
      ]),
    );
    const duplicate = run(dir, ["compare", "--json", '{"title": "a", "title": "b"}']);
    expect(duplicate.doc.errors).toEqual([
      { code: "json", path: "", message: "The key 'title' appears twice in one object." },
    ]);
    const vera = run(dir, [
      "compare",
      "--json",
      await fixture("mosfet-24v.json"),
      "--results-dir",
      ".vera/out",
    ]);
    expect(vera.code).toBe(2);
    expect(vera.doc.errors[0].code).toBe("path");
    await expect(readdir(join(dir, "electronics-results/bad"))).rejects.toThrow();
  });

  it("reads signed values, ranks only within one unit, keeps each row's datasheet and refuses unusable offers (review round 1)", async () => {
    const page = (n: number) => ({ kind: "datasheet", page: n });
    const row = (name: string, value: string, basis: string, n = 2) => ({
      name,
      value,
      basis,
      source: page(n),
      status: "confirmed",
    });
    const candidate = (mpn: string, rows: object[], extra: object = {}) => ({
      manufacturer: "Fictional Semi",
      mpn,
      package: "SOT-23",
      parameters: rows,
      ...extra,
    });
    const request = {
      title: "P-channel high-side switch",
      quantity: 10,
      constraints: [
        { id: "vds", parameter: "VDS", op: "<=", value: "-30 V" },
        { id: "vth", parameter: "VGS(th)", op: ">=", value: "-.9 V" },
      ],
      preferences: [
        { parameter: "Qg", goal: "min" },
        { parameter: "RDS(on)", goal: "min" },
      ],
      candidates: [
        candidate("FP1", [
          row("VDS", "-30 V", "rating"),
          row("VGS(th)", "-0.8 V", "min"),
          row("Qg", "5 nC", "max"),
          row("RDS(on)", "30 mΩ", "max"),
        ]),
        candidate("FP2", [
          row("VDS", "-40 V", "rating"),
          row("VGS(th)", "+0.1 V", "min"),
          row("Qg", "4500 pC", "max"),
          row("RDS(on)", "20 milliohm", "max"),
        ]),
        candidate("FP3", [row("VDS", "-30 V", "rating"), row("Qg", "1 nC", "min")], {
          datasheet: { url: "https://example.com/fp3-a.pdf", revision: "A" },
        }),
        candidate("FP3", [row("VGS(th)", "-0.5 V", "min", 3), row("RDS(on)", "25 mΩ", "max", 4)], {
          datasheet: { url: "https://example.com/fp3-b.pdf", revision: "B" },
        }),
        candidate("FP3", [], { package: "DFN-6" }),
      ],
    };
    const result = run(dir, ["compare", "--json", JSON.stringify(request), "--run-id", "signed"]);
    expect(result.code, result.stdout).toBe(0);
    const comparison = JSON.parse(
      await readFile(join(dir, "electronics-results/signed/comparison.json"), "utf8"),
    ) as Comparison;
    // -30 V and -.9 V are quantities: a P-channel part can pass.
    expect(
      comparison.devices.map((device) => [device.mpn, device.package, device.outcome, device.rank]),
    ).toEqual([
      ["FP2", "SOT-23", "eligible", 1],
      ["FP1", "SOT-23", "eligible", 2],
      ["FP3", "SOT-23", "eligible", 3],
      ["FP3", "DFN-6", "unknown", null],
    ]);
    // Qg in nC and pC compare (4.5 nC < 5 nC); a min row never ranks a value to minimise (FP3 ranks last).
    // RDS(on) "20 milliohm" is another unit than mΩ and is not compared with it.
    expect(comparison.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FP3 is listed with the packages 'SOT-23' and 'DFN-6'"),
        "The preference on RDS(on) ranks only values in Ω; 20 milliohm cannot be compared with them and rank as unknown.",
      ]),
    );
    const fp3 = comparison.devices[2] as DeviceRow;
    expect(fp3.mergedFrom).toEqual([2, 3]);
    expect(fp3.checks.find((check) => check.constraint === "vds")?.evidence[0]?.source).toMatchObject({
      revision: "A",
    });
    expect(fp3.checks.find((check) => check.constraint === "vth")?.evidence[0]?.source).toMatchObject({
      page: 3,
      revision: "B",
      url: "https://example.com/fp3-b.pdf",
    });
    const unusable = structuredClone(request);
    Object.assign(unusable.candidates[0] as object, {
      offers: [
        {
          supplier: "mouser",
          sku: "M",
          retrievedAt: stamp(1),
          priceBreaks: [
            { quantity: 100, unitPrice: null },
            { quantity: 100, unitPrice: 0.19 },
          ],
        },
      ],
    });
    Object.assign(unusable.candidates[1] as object, {
      offers: [
        {
          supplier: "tme",
          sku: "T",
          retrievedAt: stamp(1),
          priceBreaks: [{ quantity: 1, unitPrice: 1e300 }],
        },
      ],
    });
    const refused = run(dir, ["compare", "--json", JSON.stringify(unusable), "--run-id", "unusable"]);
    expect(refused.code, refused.stdout).toBe(2);
    expect(refused.doc.errors.map((problem: { path: string }) => problem.path)).toEqual([
      "candidates.0.offers.0.priceBreaks.1.quantity",
      "candidates.1.offers.0.priceBreaks.0.unitPrice",
    ]);
  });

  it("matches text constraints by the text as written and ranks in a recognised unit first (review round 2)", async () => {
    const page = { kind: "datasheet", page: 1 };
    const row = (name: string, value: string, basis: string) => ({
      name,
      value,
      basis,
      source: page,
      status: "confirmed",
    });
    const request = {
      title: "Bypass capacitor",
      quantity: 1,
      constraints: [
        { id: "case", parameter: "Case", op: "in", value: ["0603", "0805"] },
        { id: "range", parameter: "Temperature range", op: "==", value: "-55 to 125 °C" },
      ],
      preferences: [{ parameter: "ESR", goal: "min" }],
      candidates: [
        {
          manufacturer: "Fictional Passives",
          mpn: "FC1",
          parameters: [
            row("Case", "0603", "nominal"),
            row("Temperature range", "-55 to 125 °C", "rating"),
            row("ESR", "30 milliohm", "max"),
          ],
        },
        {
          manufacturer: "Fictional Passives",
          mpn: "FC2",
          parameters: [
            row("Case", "0805", "nominal"),
            row("Temperature range", "-55 to 125 °C", "rating"),
            row("ESR", "20 mΩ", "max"),
          ],
        },
        {
          manufacturer: "Fictional Passives",
          mpn: "FC3",
          parameters: [
            row("Case", "0603", "nominal"),
            row("Temperature range", "-55 to 125 °C", "rating"),
            row("ESR", "10 mΩ", "max"),
          ],
        },
        {
          manufacturer: "Fictional Passives",
          mpn: "FC4",
          parameters: [
            row("Case", "1206", "nominal"),
            row("Temperature range", "-55 to 125 °C", "rating"),
            row("ESR", "5 mΩ", "max"),
          ],
        },
      ],
    };
    const result = run(dir, ["compare", "--json", JSON.stringify(request), "--run-id", "texts"]);
    expect(result.code, result.stdout).toBe(0);
    expect(result.doc.devices).toEqual([
      { mpn: "FC3", outcome: "eligible", rank: 1 },
      { mpn: "FC2", outcome: "eligible", rank: 2 },
      { mpn: "FC1", outcome: "eligible", rank: 3 },
      { mpn: "FC4", outcome: "rejected", rank: null },
    ]);
    expect(result.doc.warnings).toEqual([
      "The preference on ESR ranks only values in Ω; 30 milliohm cannot be compared with them and rank as unknown.",
    ]);
  });

  it("discards a run whose input file changes while it runs (REQ-REL-4f8d5368)", async () => {
    const body = await fixture("mosfet-24v.json");
    await writeFile(join(dir, "changing.json"), body);
    const changed = spawnSync(
      python,
      [
        join(fixtures, "change_input.py"),
        scripts,
        "compare",
        "--input",
        "changing.json",
        "--run-id",
        "changed",
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: env(),
      },
    );
    expect(changed.status, changed.stderr).toBe(3);
    expect(JSON.parse(changed.stdout).errors[0].message).toContain("input file changed");
    await expect(readdir(join(dir, "electronics-results/changed"))).rejects.toThrow();
    expect(await readFile(join(dir, "changing.json"), "utf8")).toBe(`${body} `);
  });
});

const uv = process.env.VERA_PARTS_UV;
// Explicit real acceptance: VERA_PARTS_UV names a uv executable; provisioning may download uv's managed CPython.
it.skipIf(!uv)(
  "runs offline through a real uv on its managed Python (REQ-PLAT-cad89d58)",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-parts-real-")));
    const host = new core.NodeProcessHost(spawn);
    let provisioner: core.Provisioner | undefined;
    try {
      const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
      expect(release.issues).toEqual([]);
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(join(root, "release/parts-search-1.0.0.zip"));
      provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        uv: { executable: uv as string },
        host,
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) },
        settings: () => undefined,
        fetch: async () => {
          throw Error("No download program in this package");
        },
      });
      expect(await provisioner.install("parts-search")).toEqual([
        { name: "parts-compare", kind: "script", state: "ready", version: "1.0.0" },
      ]);
      const resolved = await provisioner.resolve(await store.load("parts-search"), "parts-compare");
      if (!resolved) throw Error("parts-compare did not resolve");
      expect(resolved.prefix).toContain("--offline");
      const bench = join(root, "bench");
      await mkdir(bench);
      await writeFile(join(bench, "mosfet.json"), await fixture("mosfet-24v.json"));
      const result = spawnSync(
        resolved.executable,
        [...(resolved.prefix ?? []), "compare", "--input", "mosfet.json", "--run-id", "real"],
        {
          cwd: bench,
          encoding: "utf8",
          env: { ...process.env, ...resolved.env },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ proposed: "FS3025L" });
      expect(await readdir(join(bench, "electronics-results", "real"))).toEqual([
        "bom.csv",
        "comparison.json",
        "comparison.md",
      ]);
      await expect(store.load("parts-search")).resolves.toBeDefined();
    } finally {
      provisioner?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  600_000,
);
