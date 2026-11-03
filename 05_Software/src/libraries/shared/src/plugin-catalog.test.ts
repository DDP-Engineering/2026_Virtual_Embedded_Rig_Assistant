import { expect, it } from "vitest";
import {
  CATALOG_LIMITS,
  catalogIndexSchema,
  catalogMaintainersSchema,
  catalogPacksSchema,
  catalogUrl,
  compareVersions,
  dangerousToken,
} from "./plugin-catalog.js";
import { ruleNamesProgram } from "./program-rules.js";
import { settingsPatchSchema, settingsSchema } from "./settings.js";

const entry = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  version: "1.0.0",
  tier: "official",
  ecosystem: "esp32",
  platforms: ["windows-x64", "linux-x64"],
  name: "Serial monitor",
  description: "Lists ports.",
  requires: [],
  url: `${id}-1.0.0.zip`,
  sha256: "a".repeat(64),
  bytes: 1234,
  ...more,
});
const pack = {
  id: "esp32",
  name: "ESP32",
  groups: [{ name: "Core", plugins: ["serial-monitor"], default: true }],
};
const index = (plugins: unknown[], more: Record<string, unknown> = {}) => ({
  format: 1,
  plugins,
  packs: [pack],
  ...more,
});

// REQ-DATA-b40d3f9b
it("parses index format 1 and refuses other versions, unknown keys and out-of-limit values", () => {
  expect(catalogIndexSchema.safeParse(index([entry("serial-monitor")])).success).toBe(true);
  expect(catalogIndexSchema.safeParse(index([entry("serial-monitor", { tier: "community" })])).success).toBe(
    true,
  );
  const refused = [
    index([entry("serial-monitor")], { format: 2 }),
    index([entry("serial-monitor")], { extra: true }),
    index([entry("serial-monitor", { extra: 1 })]),
    index([entry("serial-monitor", { tier: "local" })]),
    index([entry("serial-monitor", { url: "dir/serial-monitor-1.0.0.zip" })]),
    index([entry("serial-monitor", { url: "https://host.test/serial-monitor-1.0.0.zip" })]),
    index([entry("serial-monitor", { url: "serial-monitor-1.0.0.tar" })]),
    index([entry("serial-monitor", { bytes: 64 * 1024 * 1024 + 1 })]),
    index([entry("serial-monitor", { bytes: 0 })]),
    index([entry("serial-monitor", { sha256: "A".repeat(64) })]),
    index([entry("serial-monitor", { version: "1.0" })]),
    index([entry("serial-monitor"), entry("serial-monitor")]),
    index(Array.from({ length: CATALOG_LIMITS.plugins + 1 }, (_, i) => entry(`p${i}`))),
    index([entry("serial-monitor")], { packs: [pack, pack] }),
  ];
  for (const value of refused) expect(catalogIndexSchema.safeParse(value).success).toBe(false);
});

// REQ-DATA-b40d3f9b
it("parses packs.yaml and catalog.yaml data with defaults and strict keys", () => {
  expect(
    catalogPacksSchema.parse([{ id: "esp32", name: "ESP32", groups: [{ name: "JTAG", plugins: ["a"] }] }]),
  ).toEqual([{ id: "esp32", name: "ESP32", groups: [{ name: "JTAG", plugins: ["a"], default: false }] }]);
  expect(catalogPacksSchema.safeParse([{ ...pack, color: "red" }]).success).toBe(false);
  expect(
    catalogPacksSchema.safeParse([{ ...pack, groups: [pack.groups[0], pack.groups[0]] }]).success,
    "group names are unique in a pack",
  ).toBe(false);
  expect(
    catalogPacksSchema.safeParse([{ ...pack, groups: [{ name: "Core", plugins: ["a", "a"] }] }]).success,
  ).toBe(false);
  expect(catalogMaintainersSchema.parse({ format: 1 })).toEqual({ format: 1, official: [], reviewed: [] });
  expect(
    catalogMaintainersSchema.parse({
      format: 1,
      official: ["serial-monitor"],
      reviewed: [{ plugin: "tool", match: "tool * lock *" }],
    }).reviewed,
  ).toEqual([{ plugin: "tool", match: "tool * lock *" }]);
  expect(catalogMaintainersSchema.safeParse({ format: 2 }).success).toBe(false);
  expect(catalogMaintainersSchema.safeParse({ format: 1, community: [] }).success).toBe(false);
  expect(catalogMaintainersSchema.safeParse({ format: 1, official: ["a", "a"] }).success).toBe(false);
});

// REQ-SEC-5fa5cd5e
it("finds dangerous tokens as case-insensitive substrings of a pattern", () => {
  expect(dangerousToken("tool * burn *")).toBe("burn");
  expect(dangerousToken("tool * BLOCK *")).toBe("lock");
  expect(dangerousToken("espefuse * summary")).toBe("efuse");
  expect(dangerousToken("tool * read-otp")).toBe("otp");
  expect(dangerousToken("serial * send *")).toBe("send");
  expect(dangerousToken("serial * list *")).toBeUndefined();
  expect(dangerousToken("esptool * get-security-info *")).toBeUndefined();
});

// REQ-SEC-dfc6a26d
it("tells whether a rule's first pattern token names a program", () => {
  expect(ruleNamesProgram("esptool * chip-id *", "esptool")).toBe(true);
  expect(ruleNamesProgram("ESP_TOOL *", "esp-tool")).toBe(true);
  expect(ruleNamesProgram("* --help", "anything")).toBe(true);
  expect(ruleNamesProgram("{a,b} x", "b")).toBe(true);
  expect(ruleNamesProgram("esp* *", "esptool")).toBe(true);
  expect(ruleNamesProgram("serial list", "esptool")).toBe(false);
  expect(ruleNamesProgram("   ", "esptool")).toBe(false);
});

// REQ-SEC-69f9d44d
it("orders versions by semantic version precedence", () => {
  expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
  expect(compareVersions("1.0.0", "1.0.0+build.5")).toBe(0);
  expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
  expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
  expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
  expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
});

// REQ-SEC-a3c31442
it("accepts https and loopback http catalog folders and refuses everything else", () => {
  expect(catalogUrl("https://example.test/catalog")).toBe("https://example.test/catalog/");
  expect(catalogUrl("https://example.test/vera/releases/")).toBe("https://example.test/vera/releases/");
  expect(catalogUrl("http://127.0.0.1:8080/c")).toBe("http://127.0.0.1:8080/c/");
  expect(catalogUrl("http://localhost/c/")).toBe("http://localhost/c/");
  expect(catalogUrl("http://[::1]:9/")).toBe("http://[::1]:9/");
  for (const value of [
    "http://example.test/",
    "http://127.0.0.2/",
    "http://localhost.example.test/",
    "ftp://example.test/",
    "https://user:secret@example.test/",
    "https://user@example.test/",
    "https://example.test/c?x=1",
    "https://example.test/c#top",
    "https:///c",
    "example.test/c",
    "",
  ])
    expect(catalogUrl(value), value).toBeUndefined();
});

// REQ-SEC-a3c31442
it("stores only a valid catalog URL in the plugin settings", () => {
  expect(settingsPatchSchema.safeParse({ plugins: { catalog: "https://mirror.test/vera/" } }).success).toBe(
    true,
  );
  expect(settingsPatchSchema.safeParse({ plugins: { catalog: "http://mirror.test/vera/" } }).success).toBe(
    false,
  );
  expect(settingsSchema.shape.plugins.safeParse({ catalog: "https://u:p@mirror.test/" }).success).toBe(false);
});
