import { expect, it } from "vitest";
import { validatePluginManifest } from "./plugins.js";

const canonical = {
  format: 1,
  id: "esp32-esptool",
  version: "1.2.0",
  name: "ESP32 esptool",
  description: "Identify, flash, erase and read Espressif chips over a serial port.",
  ecosystem: "esp32",
  platforms: ["windows-x64", "linux-x64"],
  requires: ["serial-monitor"],
  programs: {
    esptool: {
      install: { pip: "esptool>=5,<6" },
      version: { args: ["version"], match: "v(\\d+.\\d+.\\d+)" },
      timeout: 120,
    },
  },
  rules: [
    { match: "esptool version", risk: "safe" },
    {
      match: "esptool * {chip-id,read-mac,flash-id,read-flash} *",
      risk: "device-read",
      note: "Resets the chip into its bootloader.",
    },
    {
      match: "esptool * {write-flash,erase-flash,erase-region} *",
      risk: "device-write",
      note: "Overwrites firmware or data on the chip.",
    },
  ],
  docs: ["https://docs.espressif.com/projects/esptool/en/latest/"],
};
const program = canonical.programs.esptool;
/** A placeholder such as ${workbench}, built so no string literal looks like a template. */
const ph = (name: string) => `\${${name}}`;
const paths = (data: unknown) => validatePluginManifest(data).issues.map((issue) => issue.path);

// REQ-DATA-4d4471f9
it("accepts the canonical manifest, a skills-only plugin and every install kind", () => {
  const valid = validatePluginManifest(canonical);
  expect(valid.issues).toEqual([]);
  expect(valid.manifest?.programs.esptool?.timeout).toBe(120);
  const skillsOnly = validatePluginManifest({
    format: 1,
    id: "analysis-skills",
    version: "0.1.0-rc.1+build.5",
    name: "Analysis skills",
    description: "Compare firmware images and plan tests.",
    ecosystem: "general",
    platforms: ["windows-x64", "linux-x64", "linux-arm64"],
  });
  expect(skillsOnly.issues).toEqual([]);
  expect(skillsOnly.manifest).toMatchObject({ requires: [], programs: {}, rules: [], docs: [] });
  const kinds = [
    { script: "scripts/probe.py" },
    {
      download: {
        "windows-x64": {
          url: "https://example.test/probe-rs.zip",
          sha256: "a".repeat(64),
          path: "bin/probe-rs.exe",
          prefix: ["--cli"],
        },
      },
    },
    { find: { windows: ["C:/Espressif/*/eim.exe"], linux: ["~/.espressif/*/eim"] }, hint: "Install EIM." },
  ];
  for (const install of kinds)
    expect(
      paths({
        ...canonical,
        programs: {
          tool: {
            ...program,
            install,
            prefix: ["-c", `${ph("pluginDir")}/cfg`],
            env: { IDF_PATH: `${ph("workbench")}/idf`, PLAIN: "x" },
          },
        },
      }),
    ).toEqual([]);
});

// REQ-DATA-10e10001
it("requires an explicit transport for find launchers and refuses orphan modes", () => {
  const found = { ...program, install: { find: { linux: ["$PATH"] } } };
  const check = (p: object) => paths({ ...canonical, programs: { idf: p } });
  for (const launcherMode of ["argv", "string"])
    expect(check({ ...found, launcher: ["eim", "run"], launcherMode })).toEqual([]);
  expect(check({ ...found, launcher: ["eim"] })).toContain("programs.idf.launcherMode");
  expect(check({ ...found, launcherMode: "string" })).toContain("programs.idf.launcherMode");
  expect(check({ ...found, launcher: ["eim"], launcherMode: "auto" })).toContain("programs.idf.launcherMode");
  expect(check({ ...program, launcher: ["eim"], launcherMode: "argv" })).toContain("programs.idf.install");
});

// REQ-DATA-4d4471f9
it("reports the field path of each invalid manifest field", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ format: 2 }, "format"],
    [{ id: "Bad_ID" }, "id"],
    [{ id: "a".repeat(65) }, "id"],
    [{ version: "1.2" }, "version"],
    [{ name: "n".repeat(81) }, "name"],
    [{ name: "  " }, "name"],
    [{ description: "d".repeat(1025) }, "description"],
    [{ ecosystem: "ESP 32" }, "ecosystem"],
    [{ platforms: ["macos-arm64"] }, "platforms.0"],
    [{ platforms: [] }, "platforms"],
    [{ platforms: ["linux-x64", "linux-x64"] }, "platforms"],
    [{ requires: ["Bad"] }, "requires.0"],
    [{ extra: true }, "extra"],
    [{ docs: ["../outside.md"] }, "docs.0"],
    [{ rules: [{ match: "esptool", risk: "dangerous" }] }, "rules.0.risk"],
    [{ rules: [{ match: "", risk: "safe" }] }, "rules.0.match"],
    [{ rules: [{ match: "esptool", risk: "safe", timeout: 0 }] }, "rules.0.timeout"],
    [{ programs: { "Bad Name": program } }, "programs.Bad Name"],
    [{ programs: { esptool: { ...program, timeout: 3601 } } }, "programs.esptool.timeout"],
    [
      { programs: { esptool: { ...program, install: { pip: "x", find: { windows: ["x"] } } } } },
      "programs.esptool.install",
    ],
    [{ programs: { esptool: { ...program, install: {} } } }, "programs.esptool.install"],
    [
      { programs: { esptool: { ...program, version: { args: ["version"], match: "v\\d+" } } } },
      "programs.esptool.version.match",
    ],
    [
      { programs: { esptool: { ...program, version: { args: ["version"], match: "(" } } } },
      "programs.esptool.version.match",
    ],
    [{ programs: { esptool: { ...program, env: { HOME: ph("home") } } } }, "programs.esptool.env.HOME"],
    // REQ-PLAT-e0d8f3cf: gui is only ever `true` (a program that opens windows).
    [{ programs: { esptool: { ...program, gui: false } } }, "programs.esptool.gui"],
    [{ programs: { esptool: { ...program, prefix: [ph("workbench")] } } }, "programs.esptool.prefix.0"],
    [{ programs: { esptool: { ...program, launcher: [] } } }, "programs.esptool.launcher"],
    [
      { programs: { esptool: { ...program, version: { args: ["a\nb"], match: "(x)" } } } },
      "programs.esptool.version.args.0",
    ],
  ];
  for (const [patch, path] of cases) {
    const result = validatePluginManifest({ ...canonical, ...patch });
    expect(result.manifest, path).toBeUndefined();
    expect(
      result.issues.map((i) => i.path),
      JSON.stringify(patch),
    ).toContain(path);
    expect(result.issues.every((i) => i.code === "field" && i.issue)).toBe(true);
  }
  expect(
    validatePluginManifest({ ...canonical, programs: { esptool: { ...program, timeout: 3601 } } }).issues,
  ).toEqual([{ code: "field", path: "programs.esptool.timeout", issue: "too_big" }]);
  expect(paths({ ...canonical, programs: { "con.exe": program } })).toEqual([]);
  expect(validatePluginManifest({ ...canonical, docs: ["CONIN$/x.md"] }).issues[0]?.path).toBe("docs.0");
  const { version: _version, ...withoutVersion } = canonical;
  expect(paths(withoutVersion)).toEqual(["version"]);
  expect(paths({ ...canonical, id: "Bad_ID", name: "" })).toEqual(["id", "name"]);
});
