// industrial_catalog on a temporary workbench (spec REQ-DATA-d7e27def "Tool"): catalogs listed from
// electrical-automation-catalogs, broken files reported without stopping the others, selections from files only.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import * as api from "../index.js";

const FIXTURE = new URL(
  "../../../../../tests/fixtures/industrial-catalog/cat-schneider-tesys.json",
  import.meta.url,
);
const DIR = "electrical-automation-catalogs";
let root: string;
const signal = () => new AbortController().signal;
// The tool context carries no web, parts or credential host: everything comes from the workbench files.
const run = (args: unknown) =>
  api.industrialCatalogTool.execute(api.createToolContext(root), args, signal()) as Promise<
    Record<string, any>
  >;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-catalog-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function place(name: string, data: string | Buffer) {
  await mkdir(join(root, DIR), { recursive: true });
  await writeFile(join(root, DIR, name), data);
}

describe("industrial_catalog tool (REQ-REL-003c3adc, REQ-SEC-07040413)", () => {
  it("lists no catalogs when the folder is missing", async () => {
    expect(await run({ view: "list" })).toEqual({ path: DIR, catalogs: [] });
  });

  it("lists a broken file as invalid and still lists and selects from the valid one", async () => {
    const bytes = await readFile(FIXTURE);
    await place("cat-schneider-tesys.json", bytes);
    await place("cat-broken.json", "{ not json");
    await mkdir(join(root, DIR, "cat-folder.json"));
    await place("notes.txt", "ignored");
    const listed = await run({ view: "list" });
    expect(listed.catalogs).toEqual([
      { file: "cat-broken.json", valid: false, problem: expect.stringMatching(/^\(document\): /) },
      { file: "cat-folder.json", valid: false, problem: "The catalog file is not an ordinary file." },
      {
        file: "cat-schneider-tesys.json",
        valid: true,
        id: "cat-schneider-tesys",
        version: "2026-11-15.1",
        title: expect.stringContaining("TeSys"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        families: 3,
        items: 8,
        tables: 2,
      },
    ]);
    await expect(
      run({
        view: "select",
        catalog: "cat-broken",
        requirements: [{ id: "ie", parameter: "ratedCurrent", op: ">=", value: { value: 9, unit: "A" } }],
      }),
    ).rejects.toThrow(/^Invalid industrial catalog:\n\(document\): /);
    const selection = await run({
      view: "select",
      catalog: "cat-schneider-tesys",
      category: "contactor",
      requirements: [
        {
          id: "ie",
          parameter: "ratedCurrent",
          op: ">=",
          value: { value: 12, unit: "A" },
          conditions: { utilisationCategory: { text: "AC-3" }, voltage: { value: 400, unit: "V" } },
        },
      ],
    });
    expect(selection.catalog).toEqual({
      id: "cat-schneider-tesys",
      version: "2026-11-15.1",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      path: `${DIR}/cat-schneider-tesys.json`,
    });
    expect(selection.counts).toEqual({ eligible: 2, unknown: 0, eliminated: 2 });
  });

  it("lists a schema-invalid and an oversized file as invalid with their problems", async () => {
    const wrong = { ...JSON.parse(await readFile(FIXTURE, "utf8")), id: "cat-format", format: 2 };
    await place("cat-format.json", JSON.stringify(wrong));
    await place("cat-huge.json", Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    const listed = await run({ view: "list" });
    expect(listed.catalogs).toEqual([
      { file: "cat-format.json", valid: false, problem: expect.stringMatching(/^format: /) },
      { file: "cat-huge.json", valid: false, problem: "The catalog file is larger than 4 MiB." },
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "never reads a catalog through a link leaving the workbench",
    async () => {
      const outside = await mkdtemp(join(tmpdir(), "vera-outside-"));
      try {
        await writeFile(join(outside, "cat-schneider-tesys.json"), await readFile(FIXTURE));
        await mkdir(join(root, DIR), { recursive: true });
        await symlink(join(outside, "cat-schneider-tesys.json"), join(root, DIR, "cat-schneider-tesys.json"));
        const listed = await run({ view: "list" });
        expect(listed.catalogs).toEqual([
          { file: "cat-schneider-tesys.json", valid: false, problem: expect.any(String) },
        ]);
        await expect(run({ view: "items", catalog: "cat-schneider-tesys" })).rejects.toThrow();
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  it("refuses a catalog that does not exist and an id that is not a catalog id", async () => {
    await expect(run({ view: "items", catalog: "cat-missing" })).rejects.toThrow(
      `The catalog ${DIR}/cat-missing.json does not exist.`,
    );
    await expect(run({ view: "items", catalog: "../escape" })).rejects.toThrow();
  });

  it("finds items by distributor SKU and answers coordination questions", async () => {
    await place("cat-schneider-tesys.json", await readFile(FIXTURE));
    const found = await run({ view: "items", catalog: "cat-schneider-tesys", sku: "395-0239" });
    expect(
      found.items.map((item: { orderCode: string; match: string }) => [item.orderCode, item.match]),
    ).toEqual([["GV2ME14", "distributor-sku"]]);
    const coordination = await run({
      view: "coordination",
      catalog: "cat-schneider-tesys",
      items: ["itm-lc1d18p7"],
      conditions: { voltage: { value: 400, unit: "V" }, circuit: { text: "power" } },
    });
    expect(coordination.applicable.map((entry: { table: string }) => entry.table)).toEqual([
      "tbl-lc1d-fuse-type1",
      "tbl-lc1d-fuse-type2",
    ]);
  });
});

it("ships the industrial-catalog plugin in the electrical ecosystem, which enables the tool (REQ-SEC-4dfa2a5b)", async () => {
  const text = await readFile(
    new URL("../../../../../plugins/industrial-catalog/plugin.yaml", import.meta.url),
    "utf8",
  );
  const { manifest, issues } = validatePluginManifest(parse(text));
  expect(issues).toEqual([]);
  expect(api.electricalModelPlugin({ manifest: manifest! })).toBe(true);
  expect(api.electricalToolNames).toContain("industrial_catalog");
});
