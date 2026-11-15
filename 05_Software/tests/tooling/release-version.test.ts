import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vitest";

const tool = (path: string) =>
  import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/../02_Tools/${path}`).href);
const version = await tool("release/set-version.mjs");
const notes = await tool("build/check-release-notes.mjs");
const scratch: string[] = [];
afterEach(async () => {
  for (const folder of scratch.splice(0)) await rm(folder, { recursive: true, force: true });
});

const entry = (text = "Plugins install offline.") => ({
  category: "new",
  topic: { en: "Plugins", ro: "Pluginuri", de: "Plugins", fr: "Plugins" },
  text: { en: text, ro: text, de: text, fr: text },
});

test("orders versions by SemVer precedence and refuses other strings", () => {
  expect(version.compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
  expect(version.compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
  expect(version.compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
  expect(version.compareVersions("1.0.0", "1.0.0")).toBe(0);
  for (const bad of ["1.0", "v1.0.0", "01.0.0", "1.0.0-"]) expect(() => version.parseVersion(bad)).toThrow();
});

test("sets the package version and every @vera dependency, leaving other ranges", () => {
  const next = version.setPackageVersion(
    { name: "@vera/cli", version: "0.0.0", dependencies: { "@vera/core": "0.0.0", yaml: "2.9.1" } },
    "0.1.0",
  );
  expect(next).toEqual({
    name: "@vera/cli",
    version: "0.1.0",
    dependencies: { "@vera/core": "0.1.0", yaml: "2.9.1" },
  });
});

test("rolls Unreleased into a dated release and moves the previous release out", () => {
  const text =
    "# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Added\n\n- New thing.\n\n## [0.1.0] - 2026-11-15\n\n### Added\n\n- Old thing.\n";
  const rolled = version.rollChangelog(text, "0.2.0", "2026-12-01");
  expect(rolled.changelog).toBe(
    "# Changelog\n\nIntro.\n\n## [Unreleased]\n\n## [0.2.0] - 2026-12-01\n\n### Added\n\n- New thing.\n",
  );
  expect(rolled.moved).toBe("## [0.1.0] - 2026-11-15\n\n### Added\n\n- Old thing.");
  expect(version.appendArchive("# Archive\n\nIntro.\n", rolled.moved)).toBe(
    "# Archive\n\nIntro.\n\n## [0.1.0] - 2026-11-15\n\n### Added\n\n- Old thing.\n",
  );
  expect(() => version.rollChangelog("# Changelog\n\n## [Unreleased]\n\n", "0.2.0", "2026-12-01")).toThrow(
    /empty/,
  );
  expect(() => version.rollChangelog("# Changelog\n", "0.2.0", "2026-12-01")).toThrow(/Unreleased/);
});

test("set-version updates packages, lockfile, changelog and release notes, and refuses a lower version", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-version-"));
  scratch.push(root);
  const software = join(root, "05_Software");
  for (const path of version.workspaces) {
    await mkdir(join(software, path), { recursive: true });
    await writeFile(
      join(software, path, "package.json"),
      `${JSON.stringify({ name: "@vera/x", version: "0.0.0", dependencies: { "@vera/shared": "0.0.0" } }, null, 2)}\n`,
    );
  }
  const packages = Object.fromEntries(version.workspaces.map((path: string) => [path, { version: "0.0.0" }]));
  await writeFile(join(software, "package-lock.json"), `${JSON.stringify({ packages }, null, 2)}\n`);
  await mkdir(join(software, "release-notes"));
  await writeFile(join(software, "release-notes/unreleased.yaml"), version.emptyReleaseNotes);
  await mkdir(join(root, "06_SoftwareDocu"));
  await writeFile(join(root, "06_SoftwareDocu/CHANGELOG-archive.md"), "# Archive\n");
  await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- First.\n");

  await expect(version.setVersion("0.1.0", { root: software, date: "2026-11-15" })).resolves.toMatchObject({
    from: "0.0.0",
    to: "0.1.0",
  });
  const desktop = JSON.parse(await readFile(join(software, "src/apps/desktop/package.json"), "utf8"));
  expect(desktop).toMatchObject({ version: "0.1.0", dependencies: { "@vera/shared": "0.1.0" } });
  const lock = JSON.parse(await readFile(join(software, "package-lock.json"), "utf8"));
  expect(lock.packages["src/libraries/core"].version).toBe("0.1.0");
  expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toContain("## [0.1.0] - 2026-11-15");
  expect(await readFile(join(software, "release-notes/0.1.0.yaml"), "utf8")).toContain(
    "version: 0.1.0\ndate: 2026-11-15",
  );
  expect(await readFile(join(software, "release-notes/unreleased.yaml"), "utf8")).toBe(
    version.emptyReleaseNotes,
  );

  await cp(join(root, "CHANGELOG.md"), join(root, "CHANGELOG.before"));
  await expect(version.setVersion("0.1.0", { root: software })).rejects.toThrow(/not higher/);
  expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toBe(
    await readFile(join(root, "CHANGELOG.before"), "utf8"),
  );
});

test("accepts complete release notes and refuses missing languages, long or technical texts and too many entries", () => {
  const valid = { version: "Unreleased", date: null, entries: [entry()] };
  expect(notes.checkReleaseNotes("unreleased.yaml", valid)).toEqual([]);
  expect(notes.checkReleaseNotes("0.1.0.yaml", { ...valid, version: "0.1.0", date: "2026-11-15" })).toEqual(
    [],
  );

  const missing = entry();
  delete (missing.text as Record<string, string>).fr;
  const errors = [
    notes.checkReleaseNotes("unreleased.yaml", { ...valid, entries: [missing] }),
    notes.checkReleaseNotes("unreleased.yaml", { ...valid, entries: [entry("x".repeat(101))] }),
    notes.checkReleaseNotes("unreleased.yaml", {
      ...valid,
      entries: [entry("See settings.ts for REQ-UX-1234abcd.")],
    }),
    notes.checkReleaseNotes("unreleased.yaml", {
      ...valid,
      entries: Array.from({ length: 11 }, () => entry()),
    }),
    notes.checkReleaseNotes("unreleased.yaml", { ...valid, entries: [{ ...entry(), category: "other" }] }),
    notes.checkReleaseNotes("0.1.0.yaml", { ...valid, version: "0.2.0", date: null }),
  ];
  expect(errors.map((list) => list.length > 0)).toEqual([true, true, true, true, true, true]);
  expect(errors[0].join()).toMatch(/text\.fr: missing/);
  expect(errors[1].join()).toMatch(/longer than 100/);
  expect(errors[2].join()).toMatch(/file name, path or id/);
  expect(errors[3].join()).toMatch(/11 new entries/);
  expect(errors[5].join()).toMatch(/version must be 0\.1\.0/);
});
