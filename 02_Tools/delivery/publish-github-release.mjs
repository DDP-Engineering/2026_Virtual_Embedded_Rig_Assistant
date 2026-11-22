import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { importSoftware } from "../environment/software.mjs";
import { publicRepository, releaseFeed } from "../release/update-config.mjs";
import {
  currentDelivery,
  describeFile,
  formatSums,
  licenseName,
  listFiles,
  platforms,
  readManifest,
  releaseNotesName,
  repository,
  sumsName,
} from "./delivery-common.mjs";

// Publishes a verified delivery as a GitHub release of the public repository, whose latest release is also the
// update feed (update-config.mjs releaseFeed). Without --publish it creates or completes a draft, which no update
// check sees; review and edit its text on GitHub, then --publish makes it the latest release and so moves every
// installed VERA's feed to this version.

export const desktopParts = platforms.map((platform) => `vera-${platform}`);
/** GitHub refuses release assets of 2 GiB and more. */
export const assetLimit = 2 * 1024 ** 3;
export const releaseTag = (version) => `v${version}`;
/** A version with a pre-release part (`1.2.0-beta.1`): GitHub marks it pre-release and the feed never serves it. */
export const isPrerelease = (version) => version.includes("-");

/** Why a delivery cannot become a release; empty when it can. */
export function releaseProblems(manifest, feed) {
  if (!manifest) return ["delivery.json missing"];
  const problems = [];
  if (/^0\.0\.0-/.test(manifest.version))
    problems.push(`${manifest.version} is a development delivery; give the desktop package a version first`);
  const built = [];
  for (const key of desktopParts) {
    const part = manifest.parts?.[key];
    if (!part) {
      problems.push(`${key}: missing`);
      continue;
    }
    built.push(`${key} ${part.commit}`);
    if (part.dirty) problems.push(`${key}: built from a tree with uncommitted changes`);
    if (part.updateFeed !== feed)
      problems.push(`${key}: built for update feed ${part.updateFeed || "(none)"}, not ${feed}`);
  }
  const commits = new Set(desktopParts.map((key) => manifest.parts?.[key]?.commit).filter(Boolean));
  if (commits.size > 1)
    problems.push(`the installers were built from different commits: ${built.join(", ")}`);
  return problems;
}

/**
 * Release assets from a verified delivery, as `{ name, path }` sorted by name. The release gets one
 * combined checksum file, and the desktop release notes become its text.
 */
export async function releaseAssets(folder, version, license = join(repository, licenseName)) {
  const assets = [];
  const add = (path) => {
    const name = basename(path);
    if (assets.some((asset) => asset.name === name)) throw new Error(`${name} is in the delivery twice`);
    assets.push({ name, path });
  };
  for (const part of desktopParts)
    for (const name of await listFiles(join(folder, part)))
      if (name !== sumsName && name !== releaseNotesName) add(join(folder, part, name));
  const optional = [
    join(folder, "plugins", `vera-plugins-${version}.zip`),
    ...platforms.map((platform) =>
      join(folder, "plugin-deps", `vera-plugin-deps-${version}-${platform}.zip`),
    ),
  ];
  for (const path of optional) if (existsSync(path)) add(path);
  const components = join(folder, "components");
  if (existsSync(components)) {
    for (const name of await listFiles(components)) if (name !== sumsName) add(join(components, name));
  }
  add(license);
  return assets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The sections of a part's RELEASE-NOTES.md, without its title, date and closing hint. */
export function notesSections(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => line.startsWith("## ") || line === "No user-visible changes.");
  const end = lines.findIndex((line) => line.startsWith("Settings > About"));
  return lines
    .slice(Math.max(start, 0), end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

const code = (names) => names.map((name) => `\`${name}\``).join(", ");

/** The release text: notes, a table of the downloads and what the release lacks; the draft is edited on GitHub. */
export function releaseBody({ version, notes, names, plugins, commit, unsigned, catalogUnsigned }) {
  const lines = [];
  if (version.startsWith("0."))
    lines.push(
      "Pre-release of VERA. Versions below 1.0.0 do not promise that the data of earlier builds carries over.",
      "",
    );
  lines.push(notes, "", "## Downloads", "", "| File | For |", "|---|---|");
  const rows = [
    [/-win-x64\.exe$/, "Windows x64 installer (per user, no admin rights)"],
    [/-win-x64\.zip$/, "Windows x64 portable"],
    [/\.AppImage$/, "Linux x64, portable"],
    [/\.deb$/, "Linux x64, Debian and Ubuntu package"],
    [
      /^vera-plugins-/,
      `the ${plugins ? `${plugins} ` : ""}official plugins as a catalog release (the installer already contains them)`,
    ],
    [
      /^vera-plugin-deps-/,
      "the programs the plugins need, for a computer without network; extract and set `plugins.kit` to the folder",
    ],
    [
      /^chrome-(?:linux|win)64\.zip$/,
      "Chromium for offline installation from Settings > Web access > Install from file",
    ],
    [
      /^whisper-.+\.zip$/,
      "Whisper models for offline installation from Settings > Dictation > Install from file",
    ],
    [/^THIRD-PARTY-NOTICES\.md$/, "sources and licences for the offline components"],
    [/\.(?:yml|blockmap)$/, "the update feed: VERA reads it to find this version and verify the download"],
    [
      /^(?:InRelease|Packages(?:\.gz)?|Release(?:\.gpg)?|vera-archive-keyring\.gpg)$/,
      "the apt repository of the deb and its signing key; the Linux install help shows how to add it",
    ],
    [/^LICENSE\.txt$/, "VERA's license"],
    [/^SHA256SUMS$/, "checksums of every file"],
  ];
  for (const [pattern, text] of rows) {
    const own = names.filter((name) => pattern.test(name));
    if (own.length) lines.push(`| ${code(own)} | ${text} |`);
  }
  const caveats = ["The installers need no network to install or start."];
  if (catalogUnsigned) caveats.push("The plugin catalog indexes are not signed in this build.");
  if (unsigned) caveats.push("Windows binaries are not code-signed (SmartScreen warns).");
  caveats.push(`Built from commit ${commit}.`);
  lines.push("", caveats.join(" "), "");
  return lines.join("\n");
}

/** Why one uploaded asset does not match its local file, or undefined when it does. */
export function assetProblem(file, asset) {
  if (!asset) return `${file.name}: not uploaded`;
  if (asset.state && asset.state !== "uploaded") return `${file.name}: upload ${asset.state}`;
  if (asset.size !== file.bytes) return `${file.name}: size ${asset.size}, expected ${file.bytes}`;
  if (asset.digest && asset.digest !== `sha256:${file.sha256}`) return `${file.name}: SHA-256 differs`;
  return undefined;
}

/** Problems of a release's assets against the local files: missing, incomplete, changed and foreign assets. */
export function assetProblems(local, remote) {
  const uploaded = new Map(remote.map((asset) => [asset.name, asset]));
  const names = new Set(local.map((file) => file.name));
  return [
    ...local.map((file) => assetProblem(file, uploaded.get(file.name))).filter(Boolean),
    ...remote
      .filter((asset) => !names.has(asset.name))
      .map((asset) => `${asset.name}: not part of this delivery`),
  ];
}

/** The version a feed channel file names, or undefined while it cannot be read. */
export async function feedVersion(feed, name, fetcher = fetch) {
  const url = new URL(name, feed);
  url.search = `noCache=${Date.now().toString(32)}`;
  try {
    const response = await fetcher(url, { redirect: "follow" });
    if (!response.ok) return undefined;
    const { parse } = await importSoftware("yaml");
    return parse(await response.text())?.version;
  } catch {
    return undefined;
  }
}

/** Stops the release; thrown, so that the staging folder is still removed. */
function fail(problems) {
  throw new Error(`${problems.length} problem(s):\n${problems.map((text) => `  ${text}`).join("\n")}`);
}

function gh(args) {
  const result = spawnSync("gh", args, { stdio: "inherit" });
  if (result.error)
    throw new Error(`gh: ${result.error.message}; install the GitHub CLI and run gh auth login`);
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed (${result.status})`);
}

/** The release with this tag, drafts included, or null when there is none. */
function viewRelease(repo, tag) {
  const result = spawnSync(
    "gh",
    ["release", "view", tag, "--repo", repo, "--json", "isDraft,isPrerelease,url,assets"],
    { encoding: "utf8" },
  );
  if (result.error)
    throw new Error(`gh: ${result.error.message}; install the GitHub CLI and run gh auth login`);
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/release not found/i.test(result.stderr)) return null;
  throw new Error(`gh release view failed: ${result.stderr.trim()}`);
}

/** Waits until both channel files of the feed name `version`; GitHub's redirect can lag a few seconds. */
async function confirmFeed(feed, version) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await Promise.all(
      ["latest.yml", "latest-linux.yml"].map((name) => feedVersion(feed, name)),
    );
    if (found.every((value) => value === version)) return;
    await new Promise((done) => setTimeout(done, 6000));
  }
  throw new Error(`the feed ${feed} does not serve ${version} yet; check it again in a few minutes`);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string", default: publicRepository },
      publish: { type: "boolean", default: false },
      "7zip": { type: "string" },
      gpgv: { type: "string" },
    },
  });
  const folder = positionals[0] ? resolve(positionals[0]) : (await currentDelivery()).folder;
  const repo = values.repo;
  const feed = releaseFeed(repo);
  const verify = spawnSync(
    process.execPath,
    [
      join(repository, "02_Tools/delivery/verify-delivery.mjs"),
      folder,
      ...(values["7zip"] ? ["--7zip", values["7zip"]] : []),
      ...(values.gpgv ? ["--gpgv", values.gpgv] : []),
    ],
    { stdio: "inherit" },
  );
  if (verify.status !== 0) fail(["delivery:verify failed; fix the delivery before releasing it"]);
  const manifest = await readManifest(folder);
  const problems = releaseProblems(manifest, feed);
  if (problems.length) fail(problems);
  const version = manifest.version;
  const notes = await Promise.all(
    desktopParts.map((part) => readFile(join(folder, part, releaseNotesName), "utf8")),
  );
  if (notes[0] !== notes[1]) problems.push("the desktop parts have different release notes");
  const assets = await releaseAssets(folder, version);
  for (const asset of assets)
    if ((await stat(asset.path)).size >= assetLimit) problems.push(`${asset.name}: 2 GiB or larger`);
  if (problems.length) fail(problems);

  const staging = join(folder, ".github-release");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const local = [];
    for (const asset of assets) {
      const { bytes, sha256 } = await describeFile(dirname(asset.path), asset.name);
      local.push({ ...asset, bytes, sha256 });
    }
    await writeFile(join(staging, sumsName), formatSums(local.map((file) => ({ ...file, path: file.name }))));
    const sums = await describeFile(staging, sumsName);
    local.push({ name: sumsName, path: join(staging, sumsName), bytes: sums.bytes, sha256: sums.sha256 });

    const tag = releaseTag(version);
    const prerelease = isPrerelease(version);
    let release = viewRelease(repo, tag);
    if (release && !release.isDraft) fail([`${tag} is already published: ${release.url}`]);
    if (values.publish) {
      if (!release) fail([`no draft ${tag}; run npm run delivery:release first`]);
      const left = assetProblems(local, release.assets);
      if (left.length) fail([...left, "run npm run delivery:release to complete the draft"]);
      gh(["release", "edit", tag, "--repo", repo, "--draft=false", ...(prerelease ? [] : ["--latest"])]);
      if (prerelease)
        console.log(`\n${tag} is published as a pre-release; the update feed does not serve it.`);
      else {
        await confirmFeed(feed, version);
        console.log(`\n${tag} is published and the update feed ${feed} serves it.`);
      }
      return;
    }
    if (!release) {
      const index = join(folder, "plugins", "index.json");
      const plugins = existsSync(index)
        ? new Set(JSON.parse(await readFile(index, "utf8")).plugins.map((plugin) => plugin.id)).size
        : undefined;
      const body = releaseBody({
        version,
        notes: notesSections(notes[0]),
        names: local.map((file) => file.name),
        plugins,
        commit: manifest.parts[desktopParts[0]].commit,
        unsigned: Object.values(manifest.parts).some((part) => part.signing === "unsigned"),
        catalogUnsigned: Boolean(manifest.parts.plugins) && !manifest.parts.plugins.signed,
      });
      await writeFile(join(staging, "release-notes.md"), body);
      gh([
        "release",
        "create",
        tag,
        "--repo",
        repo,
        "--draft",
        "--title",
        `VERA ${version}`,
        "--notes-file",
        join(staging, "release-notes.md"),
        ...(prerelease ? ["--prerelease"] : []),
      ]);
      release = viewRelease(repo, tag);
    }
    // A rerun completes an interrupted draft: only missing or different files go up again.
    const uploaded = new Map(release.assets.map((asset) => [asset.name, asset]));
    const pending = local.filter((file) => assetProblem(file, uploaded.get(file.name)));
    if (pending.length)
      gh(["release", "upload", tag, "--repo", repo, "--clobber", ...pending.map((f) => f.path)]);
    const names = new Set(local.map((file) => file.name));
    for (const asset of release.assets)
      if (!names.has(asset.name)) gh(["release", "delete-asset", tag, asset.name, "--repo", repo, "--yes"]);
    release = viewRelease(repo, tag);
    const left = assetProblems(local, release.assets);
    if (left.length) fail(left);
    console.log(
      `\nDraft ${tag} is complete: ${release.url}\nReview and edit its text on GitHub, then: npm run delivery:release -- --publish`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
}
