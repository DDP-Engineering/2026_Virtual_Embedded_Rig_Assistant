// The EPLAN exchange contracts (spec REQ-DATA-203d52e6): the strict mapping profile, the strict semicolon tables
// (device list exported with XDLCsvImporterExporter, terminal and connection tables of the user's export scheme), the
// device tag form =plant+location-identifier and the record serialisation of the import candidate.
import { readFile } from "node:fs/promises";
import { eplanLimits } from "@vera/shared";
import { describe, expect, it } from "vitest";
import * as api from "../index.js";

// biome-ignore lint/suspicious/noExplicitAny: printed JSON documents and fixture data, checked field by field.
type Json = any;
const fixtures = new URL("../../../../../tests/fixtures/eplan/", import.meta.url);
const text = async (name: string) => readFile(new URL(name, fixtures), "utf8");
const profileText = () => text("epl-plant-m.json");
async function profile() {
  return api.parseEplanProfile(await profileText(), "epl-plant-m");
}
function edited(source: string, change: (json: Record<string, Json>) => void): string {
  const json = JSON.parse(source);
  change(json);
  return JSON.stringify(json);
}

describe("EPLAN profile (REQ-DATA-203d52e6)", () => {
  it("accepts the plant M profile with its declared target, link and columns", async () => {
    const parsed = await profile();
    expect(parsed.target).toEqual({ product: "EPLAN Electric P8", version: "2025", platform: "windows-x64" });
    expect(parsed.project.link).toBe("C:\\EPLAN\\Projects\\PlantM-MCP1.elk");
    expect(parsed.tables.devices.columns).toMatchObject({ tag: "Device tag", vera: "VERA ID" });
    expect(parsed.tables.connections?.scheme).toBe("VERA-connections");
  });

  it("refuses an unknown key, another format, product or version, a relative or spaced link, a repeated header, a missing column and another file name", async () => {
    const source = await profileText();
    const cases: [string, (json: Record<string, Json>) => void, RegExp][] = [
      ["unknown key", (j) => (j.extra = 1), /extra/],
      ["format", (j) => (j.format = 2), /format/],
      ["product", (j) => (j.target.product = "EPLAN Pro Panel"), /target\.product/],
      ["version", (j) => (j.target.version = "2024"), /target\.version/],
      ["relative link", (j) => (j.project.link = "Projects\\PlantM.elk"), /project\.link/],
      ["spaced link", (j) => (j.project.link = "C:\\EPLAN\\My Projects\\PlantM.elk"), /project\.link/],
      ["not an .elk", (j) => (j.project.link = "C:\\EPLAN\\PlantM.zw1"), /project\.link/],
      [
        "repeated header",
        (j) => (j.tables.devices.columns.part = "Device tag"),
        /tables\.devices\.columns: the header Device tag is mapped twice/,
      ],
      ["missing tag", (j) => delete j.tables.devices.columns.tag, /tables\.devices\.columns\.tag/],
      ["terminal point", (j) => delete j.tables.terminals.columns.point, /tables\.terminals\.columns\.point/],
      ["scheme", (j) => (j.tables.terminals.scheme = "my scheme"), /tables\.terminals\.scheme/],
      [
        "header with ;",
        (j) => (j.tables.devices.columns.part = "Part;number"),
        /tables\.devices\.columns\.part/,
      ],
    ];
    for (const [name, change, message] of cases)
      expect(() => api.parseEplanProfile(edited(source, change), "epl-plant-m"), name).toThrow(message);
    expect(() => api.parseEplanProfile(source, "epl-other")).toThrow(
      /Invalid EPLAN profile epl-other: id: must equal the file name epl-other/,
    );
    expect(() => api.parseEplanProfile("{", "epl-plant-m")).toThrow(
      /Invalid EPLAN profile epl-plant-m: .*JSON/,
    );
  });
});

describe("EPLAN exchange tables (REQ-DATA-e601f922)", () => {
  it("reads the plant M device, terminal and connection tables with unmapped columns and raw records", async () => {
    const p = await profile();
    const devices = api.parseEplanTable(await text("devices-plant-m.csv"), "devices.csv", "devices", p);
    expect(devices.header).toEqual([
      "Device tag",
      "Part number",
      "Function text",
      "VERA ID",
      "Mounting location",
    ]);
    expect(devices.unmapped).toEqual(["Mounting location"]);
    expect(devices.records).toHaveLength(15);
    expect(devices.records[0]).toMatchObject({
      line: 2,
      raw: "=P+MCP1-Q1-M1;SE.GV2ME10;Motor circuit breaker M1;;Plate\n",
      values: { tag: "=P+MCP1-Q1-M1", part: "SE.GV2ME10", vera: null },
    });
    const interlock = devices.records.find((record) => record.values.tag === "=P+MCP1-KM2-KM3-M2");
    expect(interlock?.cells[2]).toBe("Mechanical interlock; KM2/KM3");
    expect(interlock?.raw).toBe('=P+MCP1-KM2-KM3-M2;SE.LAD9V2;"Mechanical interlock; KM2/KM3";;Plate\n');
    const terminals = api.parseEplanTable(
      await text("terminals-plant-m.txt"),
      "terminals.txt",
      "terminals",
      p,
    );
    expect(terminals.records).toHaveLength(14);
    const connections = api.parseEplanTable(
      await text("connections-plant-m.txt"),
      "connections.txt",
      "connections",
      p,
    );
    expect(connections.records[0]?.values).toEqual({
      from: "=P+MCP1-X0:L1",
      to: "=P+MCP1-Q1-M1:1",
      wire: "101",
      crossSection: "2.5",
      color: "BK",
    });
    // CRLF, a byte order mark and one empty final line are accepted and kept.
    const crlf = `\uFEFF${(await text("devices-plant-m.csv")).replaceAll("\n", "\r\n")}\r\n`;
    const read = api.parseEplanTable(crlf, "devices.csv", "devices", p);
    expect(read.bom).toBe(true);
    expect(read.header[0]).toBe("Device tag");
    expect(read.records).toHaveLength(15);
    expect(read.records[0]?.raw.endsWith("Plate\r\n")).toBe(true);
  });

  it("refuses a comma file, a missing or repeated mapped header, a short record, text after a quote, control characters, bad UTF-8 and oversized files", async () => {
    const p = await profile();
    const source = await text("devices-plant-m.csv");
    const parse = (body: string) => () => api.parseEplanTable(body, "devices.csv", "devices", p);
    // A comma-separated export: the whole header is one name, so the mapped headers are missing.
    expect(parse(source.split("\n").slice(0, 3).join("\n").replaceAll(";", ","))).toThrow(
      /Invalid EPLAN devices table devices\.csv: line 1: the header lacks Device tag\./,
    );
    expect(parse(source.replace("Function text", "Part number"))).toThrow(
      /line 1: the header holds Part number twice\./,
    );
    expect(parse(source.replace(";Plate\n=P+MCP1-KM1-M1", "\n=P+MCP1-KM1-M1"))).toThrow(
      /line 2: 4 fields, the header has 5\./,
    );
    expect(parse(source.replace('"Mechanical interlock; KM2/KM3"', '"Mechanical interlock"x'))).toThrow(
      /line 8: text after a closing quote\./,
    );
    expect(parse(source.replace("Stop M1", "Stop\tM1"))).toThrow(/line 11: a control character\./);
    expect(parse(source.replace("Stop M1", "Stop\rM1"))).toThrow(/line 11: a control character\./);
    expect(parse(`${source}\n\n`)).toThrow(/line 17: 1 fields, the header has 5\./);
    expect(() =>
      api.decodeEplanTable(new Uint8Array([0x44, 0xff, 0x0a]), "devices.csv", "devices", p),
    ).toThrow(/Invalid EPLAN devices table devices\.csv: line 1: not UTF-8 text\./);
    const many = `${source}${"=P+MCP1-X;;;;\n".repeat(eplanLimits.tableRecords)}`;
    expect(parse(many)).toThrow(/more than 20000 records/);
    expect(() =>
      api.decodeEplanTable(new Uint8Array(eplanLimits.tableBytes + 1), "devices.csv", "devices", p),
    ).toThrow(/line 1: larger than 4 MiB\./);
  });
});

describe("EPLAN device tags", () => {
  it("splits =plant+location-identifier and connection ends at the last colon", () => {
    expect(api.eplanTag("=P+MCP1-KM2-KM3-M2")).toEqual({
      tag: "=P+MCP1-KM2-KM3-M2",
      structure: "=P+MCP1",
      identifier: "KM2-KM3-M2",
    });
    expect(api.eplanTag("-Q1")).toEqual({ tag: "-Q1", structure: "", identifier: "Q1" });
    expect(api.eplanTag("=A1=A2+L1+L2-X4")?.identifier).toBe("X4");
    for (const wrong of ["Q1", "=P+MCP1", "=P+MCP1-", "+L-", ""])
      expect(api.eplanTag(wrong), wrong).toBeNull();
    expect(api.eplanEnd("=P+MCP1-X0:L1")).toEqual({ identifier: "X0", pin: "L1", end: "X0:L1" });
    expect(api.eplanEnd("=P+MCP1-X0")).toBeNull();
  });

  it("serialises a changed record with quotes only where needed and the original line ending", () => {
    expect(api.eplanRecordText(["-Q1", "SE.GV2ME10", "a;b", 'say "x"', ""], "\r\n")).toBe(
      '-Q1;SE.GV2ME10;"a;b";"say ""x""";\r\n',
    );
  });
});
