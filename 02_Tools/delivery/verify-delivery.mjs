import { verify as verifySignature } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { importSoftware } from "../environment/software.mjs";
import { embeddingPayload } from "../release/embedding-payload.mjs";
import {
  catalogPublicKey,
  checkSums,
  checkUpdateFiles,
  currentDelivery,
  deliveryFolderName,
  deliveryWarnings,
  formatBytes,
  isUpdateFile,
  licenseName,
  listFiles,
  manifestName,
  platforms,
  readManifest,
  releaseNotesName,
  sha256File,
  sumsName,
} from "./delivery-common.mjs";
import { verifyEmbeddingArchive } from "./verify-embedding-archive.mjs";

// Checks a delivery folder (default: the one this checkout builds) without changing or publishing anything:
// every SHA256SUMS and delivery.json entry, pinned desktop model members, the expected files per part
// and the plugin zips against the catalog indexes. Exit 1 on any mismatch.
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { "7zip": { type: "string", default: process.platform === "win32" ? "7z" : "7zz" } },
});
const folder = positionals[0] ? resolve(positionals[0]) : (await currentDelivery()).folder;
if (!existsSync(folder)) {
  console.error(`No delivery folder: ${folder}`);
  process.exit(1);
}

const problems = [];
const warnings = [];
const hashes = new Map();
const hash = async (path) => {
  if (!hashes.has(path)) hashes.set(path, await sha256File(path));
  return hashes.get(path);
};
const problem = (where, text) => problems.push(`${where}: ${text}`);

const manifest = await readManifest(folder);
if (!manifest) problem(manifestName, "missing");
const version = manifest?.version;
if (manifest && basename(folder) !== deliveryFolderName(version))
  problem(manifestName, `version ${version} does not match the folder name ${basename(folder)}`);

/** The files of a part folder, and their SHA256SUMS problems. */
async function partFiles(part) {
  const path = join(folder, part);
  if (!existsSync(path)) return undefined;
  for (const text of await checkSums(path, hash)) problem(part, text);
  return (await listFiles(path)).filter((name) => name !== sumsName);
}

function expectOne(part, files, pattern, what) {
  const found = files.filter((name) => pattern.test(name));
  if (found.length !== 1) problem(part, `expected one ${what}, found ${found.length}`);
}

const present = {};
let modelFiles;
for (const platform of platforms) {
  const part = `vera-${platform}`;
  const files = await partFiles(part);
  present[part] = Boolean(files);
  if (!files) continue;
  const desktop = manifest?.desktopVersion ?? "";
  const [first, second] = platform === "windows-x64" ? [/\.exe$/, /\.zip$/] : [/\.AppImage$/, /\.deb$/];
  expectOne(part, files, first, `${first.source} installer`);
  expectOne(part, files, second, `${second.source} package`);
  if (!files.includes(releaseNotesName)) problem(part, `${releaseNotesName}: missing`);
  const updateFiles = files.filter(isUpdateFile);
  for (const text of await checkUpdateFiles(join(folder, part), updateFiles, desktop, platform))
    problem(part, text);
  const feed = manifest?.parts?.[part]?.updateFeed ?? "";
  const channels = updateFiles.filter((name) => name.endsWith(".yml"));
  if (feed && !channels.length) problem(part, `built for update feed ${feed} but has no channel file`);
  if (!feed && channels.length) problem(part, "has channel files but no update feed in delivery.json");
  for (const name of files) {
    if (name === releaseNotesName || isUpdateFile(name)) continue;
    if (!first.test(name) && !second.test(name)) problem(part, `${name}: unexpected file`);
    else if (!name.startsWith(`VERA-${desktop}-`)) problem(part, `${name}: not desktop version ${desktop}`);
    else {
      try {
        modelFiles ??= await embeddingPayload();
        await verifyEmbeddingArchive(join(folder, part, name), modelFiles, values["7zip"]);
      } catch (error) {
        problem(part, `${name}: ${error.message}`);
      }
    }
  }
}

const pluginFiles = await partFiles("plugins");
present.plugins = Boolean(pluginFiles);
if (pluginFiles) {
  const plugins = join(folder, "plugins");
  const indexes = ["index.json", "index-stable.json", "index-pre-release.json"];
  const archive = `vera-plugins-${version}.zip`;
  const listed = new Set();
  for (const name of indexes) {
    if (!pluginFiles.includes(name)) {
      problem("plugins", `${name}: missing`);
      continue;
    }
    const index = JSON.parse(await readFile(join(plugins, name), "utf8"));
    for (const entry of index.plugins) {
      listed.add(entry.url);
      const path = join(plugins, entry.url);
      if (!existsSync(path)) problem("plugins", `${entry.url}: missing (${name})`);
      else if ((await stat(path)).size !== entry.bytes || (await hash(path)) !== entry.sha256)
        problem("plugins", `${entry.url}: differs from ${name}`);
    }
  }
  const signed = manifest?.parts?.plugins?.signed;
  const key = await readFile(catalogPublicKey, "utf8");
  const unsigned = [];
  for (const name of indexes.slice(1)) {
    const sig = `${name}.sig`;
    if (!pluginFiles.includes(sig)) {
      if (signed) problem("plugins", `${sig}: missing`);
      // Judged by the signature files, not by the flag that the folder under test records about itself.
      else unsigned.push(name);
      continue;
    }
    const valid = verifySignature(
      null,
      await readFile(join(plugins, name)),
      key,
      Buffer.from((await readFile(join(plugins, sig), "utf8")).trim(), "base64"),
    );
    if (!valid) problem("plugins", `${sig}: does not verify with ${basename(catalogPublicKey)}`);
  }
  if (unsigned.length)
    warnings.push(`plugins: the catalog is not signed (no signature for ${unsigned.join(", ")})`);
  const allowed = new Set([
    ...indexes,
    ...indexes.slice(1).map((name) => `${name}.sig`),
    ...listed,
    archive,
    licenseName,
  ]);
  if (!pluginFiles.includes(licenseName)) problem("plugins", `${licenseName}: missing`);
  for (const name of pluginFiles) if (!allowed.has(name)) problem("plugins", `${name}: unexpected file`);
  if (!pluginFiles.includes(archive)) problem("plugins", `${archive}: missing`);
  else {
    const fflate = await importSoftware("fflate");
    const { unzipSync } = fflate.unzipSync ? fflate : fflate.default;
    const names = [];
    unzipSync(new Uint8Array(await readFile(join(plugins, archive))), {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
    const prefix = `vera-plugins-${version}/`;
    const expected = pluginFiles.filter((name) => name !== archive).map((name) => `${prefix}${name}`);
    if (names.sort().join("\n") !== expected.sort().join("\n"))
      problem("plugins", `${archive}: does not hold exactly the catalog files`);
  }
}

const depsFiles = await partFiles("plugin-deps");
for (const platform of platforms) {
  const name = `vera-plugin-deps-${version}-${platform}.zip`;
  present[`plugin-deps/${platform}`] = Boolean(depsFiles?.includes(name));
}
for (const name of depsFiles ?? [])
  if (!platforms.some((platform) => name === `vera-plugin-deps-${version}-${platform}.zip`))
    problem("plugin-deps", `${name}: unexpected file`);

for (const [key, part] of Object.entries(manifest?.parts ?? {})) {
  if (part.version !== version) problem(manifestName, `${key}: version ${part.version}, expected ${version}`);
  if (!(key in present)) problem(manifestName, `${key}: unknown part`);
  else if (!present[key]) problem(manifestName, `${key}: recorded but not present`);
  for (const file of part.files ?? []) {
    const path = join(folder, file.path);
    if (!existsSync(path)) problem(manifestName, `${file.path}: missing`);
    else if ((await stat(path)).size !== file.bytes || (await hash(path)) !== file.sha256)
      problem(manifestName, `${file.path}: differs from ${manifestName}`);
  }
}
for (const [key, isPresent] of Object.entries(present))
  if (isPresent && !manifest?.parts?.[key]) problem(manifestName, `${key}: present but not recorded`);

console.log(`${folder}\n`);
for (const [key, isPresent] of Object.entries(present)) {
  const part = manifest?.parts?.[key];
  const bytes = (part?.files ?? []).reduce((sum, file) => sum + file.bytes, 0);
  console.log(
    `  ${key.padEnd(24)} ${isPresent ? `present  ${formatBytes(bytes).padStart(10)}  ${part?.commit ?? ""}${part?.dirty ? " (dirty)" : ""}` : "missing"}`,
  );
}
warnings.push(...deliveryWarnings(manifest));
if (warnings.length) {
  console.warn(`\nWARNING: ${warnings.length} warning(s), not a delivery to release as it is:`);
  for (const text of warnings) console.warn(`  ! ${text}`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const text of problems) console.error(`  ${text}`);
  process.exit(1);
}
if (!Object.values(present).some(Boolean)) {
  console.error("\nThe delivery has no parts.");
  process.exit(1);
}
console.log(
  warnings.length ? `\nDelivery verified, with ${warnings.length} warning(s).` : "\nDelivery verified.",
);
