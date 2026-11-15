import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { software } from "../environment/software.mjs";

/** Workspace packages that carry the one app version, desktop first (the source). */
export const workspaces = ["src/apps/desktop", "src/apps/cli", "src/libraries/core", "src/libraries/shared"];

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

/** Parses `x.y.z` or `x.y.z-pre`; throws on anything else. */
export function parseVersion(text) {
  const match = semver.exec(text);
  if (!match) throw new Error(`Not a semantic version: ${text}`);
  return { core: match.slice(1, 4).map(Number), pre: match[4] };
}

/** SemVer precedence: negative, zero or positive like a comparator. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  const [p, q] = [x.pre.split("."), y.pre.split(".")];
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const [m, n] = [/^\d+$/.test(p[i]) ? Number(p[i]) : p[i], /^\d+$/.test(q[i]) ? Number(q[i]) : q[i]];
    if (m === n) continue;
    if (typeof m === "number" && typeof n === "number") return m - n;
    if (typeof m === "number") return -1;
    if (typeof n === "number") return 1;
    return m < n ? -1 : 1;
  }
  return 0;
}

/** Sets the version and every `@vera/*` dependency of one package.json object. */
export function setPackageVersion(manifest, version) {
  const next = { ...manifest, version };
  for (const field of ["dependencies", "devDependencies"])
    if (manifest[field])
      next[field] = Object.fromEntries(
        Object.entries(manifest[field]).map(([name, range]) => [
          name,
          name.startsWith("@vera/") ? version : range,
        ]),
      );
  return next;
}

/** Applies setPackageVersion to the workspace entries of a package-lock.json object. */
export function setLockVersion(lock, version) {
  const packages = { ...lock.packages };
  for (const path of workspaces) {
    if (!packages[path]) throw new Error(`Lockfile has no workspace ${path}`);
    packages[path] = setPackageVersion(packages[path], version);
  }
  return { ...lock, packages };
}

const releaseHeading = /^## \[(?!Unreleased\])[^\]]+\]/m;

/**
 * Turns `## [Unreleased]` into `## [version] - date` under a new empty Unreleased section.
 * Returns the new changelog and the older release sections it moved out.
 */
export function rollChangelog(text, version, date) {
  const start = text.indexOf("## [Unreleased]");
  if (start < 0) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const header = text.slice(0, start);
  const rest = text.slice(start + "## [Unreleased]".length);
  const next = rest.search(releaseHeading);
  const unreleased = (next < 0 ? rest : rest.slice(0, next)).trim();
  if (!unreleased) throw new Error("## [Unreleased] is empty; nothing to release");
  const older = next < 0 ? "" : rest.slice(next).trim();
  const changelog = `${header}## [Unreleased]\n\n## [${version}] - ${date}\n\n${unreleased}\n`;
  return { changelog, moved: older };
}

/** Inserts moved release sections at the top of the archive, below its introduction. */
export function appendArchive(text, moved) {
  if (!moved) return text;
  const first = text.search(releaseHeading);
  const intro = (first < 0 ? text : text.slice(0, first)).trimEnd();
  const kept = first < 0 ? "" : `\n\n${text.slice(first).trim()}`;
  return `${intro}\n\n${moved}${kept}\n`;
}

/** Stamps `version: Unreleased` / `date: null` of a release-notes file with the release. */
export function stampReleaseNotes(text, version, date) {
  if (!/^version: Unreleased$/m.test(text) || !/^date: null$/m.test(text))
    throw new Error("release-notes/unreleased.yaml must start with version: Unreleased and date: null");
  return text
    .replace(/^version: Unreleased$/m, `version: ${version}`)
    .replace(/^date: null$/m, `date: ${date}`);
}

export const emptyReleaseNotes = "version: Unreleased\ndate: null\nentries: []\n";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/** Sets the app version everywhere and rolls the changelog and release notes. */
export async function setVersion(
  version,
  { root = software, date = new Date().toISOString().slice(0, 10) } = {},
) {
  parseVersion(version);
  const current = (await readJson(join(root, workspaces[0], "package.json"))).version;
  if (compareVersions(version, current) <= 0) throw new Error(`${version} is not higher than ${current}`);
  const repository = resolve(root, "..");
  const changelogPath = join(repository, "CHANGELOG.md");
  const archivePath = join(repository, "06_SoftwareDocu/CHANGELOG-archive.md");
  const notes = join(root, "release-notes");
  const rolled = rollChangelog(await readFile(changelogPath, "utf8"), version, date);
  const stamped = stampReleaseNotes(await readFile(join(notes, "unreleased.yaml"), "utf8"), version, date);
  for (const path of workspaces) {
    const file = join(root, path, "package.json");
    await writeJson(file, setPackageVersion(await readJson(file), version));
  }
  const lock = join(root, "package-lock.json");
  await writeJson(lock, setLockVersion(await readJson(lock), version));
  await writeFile(changelogPath, rolled.changelog);
  if (rolled.moved)
    await writeFile(archivePath, appendArchive(await readFile(archivePath, "utf8"), rolled.moved));
  await writeFile(join(notes, "unreleased.yaml"), stamped);
  await rename(join(notes, "unreleased.yaml"), join(notes, `${version}.yaml`));
  await writeFile(join(notes, "unreleased.yaml"), emptyReleaseNotes);
  return { from: current, to: version, date, archived: Boolean(rolled.moved) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version || process.argv.length > 3) {
    console.error("Usage: node ../02_Tools/release/set-version.mjs <x.y.z>");
    process.exit(2);
  }
  try {
    const result = await setVersion(version);
    console.log(`VERA ${result.from} -> ${result.to} (${result.date})`);
    console.log("Updated: 4 workspace packages, package-lock.json, CHANGELOG.md, release-notes/.");
    if (result.archived) console.log("Moved older releases to 06_SoftwareDocu/CHANGELOG-archive.md.");
    console.log(`Next: npm run verify, commit "release: ${version}", tag v${version}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
