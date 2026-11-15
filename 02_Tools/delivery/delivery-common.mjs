import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync, writeSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { importSoftware, software } from "../environment/software.mjs";

/** The repository root and its delivery folder. */
export const repository = resolve(software, "..");
export const deliveryRoot = join(repository, "07_Delivery");
/** The public key the desktop build pins; signed catalog indexes must verify with it. */
export const catalogPublicKey = join(repository, "02_Tools/release/catalog-signing-key.pub.pem");
export const platforms = ["windows-x64", "linux-x64"];
export const sumsName = "SHA256SUMS";
export const manifestName = "delivery.json";
export const releaseNotesName = "RELEASE-NOTES.md";
export const licenseName = "LICENSE.txt";

const categoryTitles = { new: "New", improved: "Improved", fixed: "Fixed" };

/** English Markdown of one release-notes document (05_Software/release-notes/*.yaml). */
export function formatReleaseNotes(document, version) {
  const lines = [`# VERA ${version} release notes`, ""];
  if (document.date) lines.push(String(document.date), "");
  const entries = document.entries ?? [];
  for (const [category, title] of Object.entries(categoryTitles)) {
    const own = entries.filter((entry) => entry.category === category);
    if (own.length)
      lines.push(`## ${title}`, "", ...own.map((entry) => `- **${entry.topic.en}:** ${entry.text.en}`), "");
  }
  if (!entries.length) lines.push("No user-visible changes.", "");
  lines.push("Settings > About > What's new shows these notes in the interface language.", "");
  return lines.join("\n");
}

/** The release notes of `desktopVersion`, or the unreleased ones while that version has no file yet. */
export async function releaseNotesFor(desktopVersion, version, root = software) {
  const { parse } = await importSoftware("yaml");
  const folder = join(root, "release-notes");
  const own = join(folder, `${desktopVersion}.yaml`);
  const file = existsSync(own) ? own : join(folder, "unreleased.yaml");
  return formatReleaseNotes(parse(await readFile(file, "utf8")), version);
}

/** The delivery version: the desktop version, or `0.0.0-<short commit>` while it is still `0.0.0`. */
export function deliveryVersion(desktopVersion, commit) {
  return desktopVersion === "0.0.0" ? `0.0.0-${commit}` : desktopVersion;
}

export const deliveryFolderName = (version) => `vera-${version}`;

function git(args) {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

/** Version, commit and folder of the delivery that this checkout builds. */
export async function currentDelivery(root = deliveryRoot) {
  const desktop = JSON.parse(await readFile(join(software, "src/apps/desktop/package.json"), "utf8"));
  const commit = git(["rev-parse", "--short", "HEAD"]);
  const version = deliveryVersion(desktop.version, commit);
  return {
    version,
    desktopVersion: desktop.version,
    commit,
    dirty: git(["status", "--porcelain"]) !== "",
    folder: join(root, deliveryFolderName(version)),
  };
}

/** `windows-x64` or `linux-x64` for a supported host, otherwise undefined. */
export function hostPlatform(platform = process.platform, arch = process.arch) {
  if (arch !== "x64") return undefined;
  if (platform === "win32") return "windows-x64";
  if (platform === "linux") return "linux-x64";
  return undefined;
}

/** Each platform is built on its own host: native modules and compiled wheels need it. */
export function requireHost(platform, host = hostPlatform()) {
  if (!platforms.includes(platform)) throw new Error("--platform must be windows-x64 or linux-x64");
  if (platform !== host)
    throw new Error(`${platform} is built on a ${platform} host; this host is ${host ?? "unsupported"}`);
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Name, size and SHA-256 of one file in a folder. */
export async function describeFile(folder, name) {
  const path = join(folder, name);
  return { path: name, bytes: (await stat(path)).size, sha256: await sha256File(path) };
}

/** The regular files of a folder (not recursive), sorted. */
export async function listFiles(folder) {
  return (await readdir(folder, { withFileTypes: true }))
    .filter((item) => item.isFile())
    .map((item) => item.name)
    .sort();
}

/** `SHA256SUMS` text, as `sha256sum` prints it: `<hex>  <name>` per line, sorted by name. */
export function formatSums(entries) {
  return [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.sha256}  ${entry.path}\n`)
    .join("");
}

/** Parses `SHA256SUMS`; accepts the text (two spaces) and binary (` *`) forms of `sha256sum`. */
export function parseSums(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.replace(/\r$/, ""));
      if (!match) throw new Error(`malformed ${sumsName} line: ${line}`);
      return { sha256: match[1], path: match[2] };
    });
}

export async function writeSums(folder, entries) {
  await writeFile(join(folder, sumsName), formatSums(entries));
}

/** The entries of a folder's `SHA256SUMS`, or none when it has no such file. */
export async function readSums(folder) {
  try {
    return parseSums(await readFile(join(folder, sumsName), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/** Problems of a folder against its `SHA256SUMS`: missing, changed and unlisted files. */
export async function checkSums(folder, hash = sha256File) {
  if (!existsSync(join(folder, sumsName))) return [`${sumsName} missing`];
  const entries = await readSums(folder);
  const files = new Set(await listFiles(folder));
  const problems = [];
  for (const entry of entries) {
    if (!files.has(entry.path)) problems.push(`${entry.path}: missing`);
    else if ((await hash(join(folder, entry.path))) !== entry.sha256)
      problems.push(`${entry.path}: SHA-256 mismatch`);
  }
  const listed = new Set(entries.map((entry) => entry.path));
  for (const file of files)
    if (file !== sumsName && !listed.has(file)) problems.push(`${file}: not in ${sumsName}`);
  return problems;
}

/** Refuses an existing part unless `--replace` was given. */
export function assertCanWrite(target, replace) {
  if (existsSync(target) && !replace) throw new Error(`${target} exists; pass --replace to rebuild it`);
}

/** A fresh staging folder for a part, next to the parts, so the final rename stays on one volume. */
export async function startStaging(folder, name) {
  const staging = join(folder, `.staging-${name}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  return staging;
}

/** Moves a finished staging folder or file to its place; with `replace`, the old part goes only after. */
export async function commitPart(staging, target, replace) {
  assertCanWrite(target, replace);
  if (!existsSync(target)) {
    await rename(staging, target);
    return;
  }
  const old = `${target}.old`;
  await rm(old, { recursive: true, force: true });
  await rename(target, old);
  await rename(staging, target);
  await rm(old, { recursive: true, force: true });
}

/** `delivery.json` of a delivery folder, or a new one. */
export async function readManifest(folder) {
  try {
    return JSON.parse(await readFile(join(folder, manifestName), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Records one part in `delivery.json` and keeps the others; refuses a manifest of another version. */
export async function recordPart(delivery, key, record) {
  const manifest = (await readManifest(delivery.folder)) ?? {
    format: 1,
    version: delivery.version,
    desktopVersion: delivery.desktopVersion,
    parts: {},
  };
  if (manifest.version !== delivery.version)
    throw new Error(`${manifestName} is for version ${manifest.version}, not ${delivery.version}`);
  manifest.parts[key] = {
    version: delivery.version,
    commit: delivery.commit,
    dirty: delivery.dirty,
    host: hostPlatform() ?? `${process.platform}-${process.arch}`,
    builtAt: new Date().toISOString(),
    ...record,
  };
  manifest.parts = Object.fromEntries(Object.entries(manifest.parts).sort(([a], [b]) => (a < b ? -1 : 1)));
  const temporary = join(delivery.folder, `${manifestName}.tmp`);
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporary, join(delivery.folder, manifestName));
  return manifest;
}

/**
 * Writes a zip of `names` (files of `folder`, recursive paths allowed) under `prefix/`. Entries are stored, not
 * deflated: the inputs are archives already. No zip64, so every file and the whole zip stay below 4 GiB.
 */
export async function zipFiles(folder, names, out, prefix = "") {
  const fflate = await importSoftware("fflate");
  const { Zip, ZipPassThrough } = fflate.Zip ? fflate : fflate.default;
  let total = 0;
  for (const name of names) total += (await stat(join(folder, name))).size;
  if (total >= 0xffff0000) throw new Error(`zip too large for a zip without zip64: ${out}`);
  const descriptor = openSync(out, "w");
  try {
    let failure;
    let finished = false;
    const zip = new Zip((error, chunk, final) => {
      if (error) failure = error;
      else writeSync(descriptor, chunk);
      if (final) finished = true;
    });
    for (const name of names) {
      const path = join(folder, name);
      const entry = new ZipPassThrough(prefix ? `${prefix}/${name}` : name);
      entry.mtime = (await stat(path)).mtime;
      zip.add(entry);
      for await (const chunk of createReadStream(path)) entry.push(chunk);
      entry.push(new Uint8Array(0), true);
      if (failure) throw failure;
    }
    zip.end();
    if (failure) throw failure;
    if (!finished) throw new Error(`zip not finished: ${out}`);
  } finally {
    closeSync(descriptor);
  }
}

/** Every file below a folder, as `/`-separated relative paths, sorted. */
export async function listTree(folder) {
  const files = [];
  async function walk(path, prefix) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(join(path, item.name), name);
      else if (item.isFile()) files.push(name);
    }
  }
  await walk(folder, "");
  return files.sort();
}

/** Runs a command and throws when it fails. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: software, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${[command, ...args].join(" ")} failed (${result.status})`);
}

/** Builds the CLI (as `npm run vera` does) and runs it from 05_Software. */
export function runVeraCli(args) {
  run(process.execPath, [join(repository, "02_Tools/build/build-cli.mjs")]);
  run(process.execPath, [join(software, "src/apps/cli/dist/index.js"), ...args]);
}

export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/** Prints the part folder, its files with their sizes and the next step. */
export function printPart(folder, files, next) {
  console.log(`\n${folder}`);
  const width = Math.max(...files.map((file) => file.path.length));
  for (const file of files)
    console.log(`  ${file.path.padEnd(width)}  ${formatBytes(file.bytes).padStart(10)}`);
  console.log(`\nNext: ${next}`);
}
