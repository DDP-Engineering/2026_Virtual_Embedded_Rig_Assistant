import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { software } from "../environment/software.mjs";
import { releaseFeed, updateFeed } from "../release/update-config.mjs";
import { aptFiles, aptKeyFor, buildAptRepository, signingKey } from "./apt-repository.mjs";
import {
  assertCanWrite,
  commitPart,
  currentDelivery,
  describeFile,
  printPart,
  recordPart,
  releaseNotesFor,
  releaseNotesName,
  repository,
  requireHost,
  run,
  startStaging,
  writeSums,
} from "./delivery-common.mjs";

// Builds the release installers of this host with `npm run package` and collects them in
// 07_Delivery/vera-<version>/vera-<platform>/ with their update feed files, RELEASE-NOTES.md and SHA256SUMS.
// Never the instrumented (--test) build. The installers check the public GitHub release feed unless
// VERA_UPDATE_URL names another feed; an empty VERA_UPDATE_URL builds them without one. On Linux, VERA_APT_KEY
// names the GnuPG secret key that signs the flat apt repository written next to the deb; without it there is none.
const { values } = parseArgs({
  options: { platform: { type: "string" }, replace: { type: "boolean", default: false } },
});
requireHost(values.platform);
const delivery = await currentDelivery();
const part = `vera-${values.platform}`;
const target = join(delivery.folder, part);
assertCanWrite(target, values.replace);

const feed = updateFeed(process.env.VERA_UPDATE_URL ?? releaseFeed());
const aptKey = aptKeyFor(values.platform);
// A wrong key fails now, not after the installers are built.
if (aptKey) signingKey(aptKey);
run(process.execPath, [join(repository, "02_Tools/release/package.mjs")], {
  env: { ...process.env, VERA_UPDATE_URL: feed },
});
const release = join(software, "release_tmp/release");
const report = JSON.parse(await readFile(join(release, "package-report.json"), "utf8"));
if (report.testBuild) throw new Error("package-report.json is an instrumented build");
if (report.updateFeed !== feed) throw new Error("package-report.json was built for another update feed");

const staging = await startStaging(delivery.folder, part);
let files;
let aptFingerprint;
try {
  files = [];
  for (const artifact of [...report.artifacts, ...report.updateFiles]) {
    await copyFile(join(release, artifact.path), join(staging, artifact.path));
    const file = await describeFile(staging, artifact.path);
    if (file.sha256 !== artifact.sha256 || file.bytes !== artifact.bytes)
      throw new Error(`${artifact.path} differs from package-report.json`);
    files.push(file);
  }
  if (aptKey) {
    const deb = files.find((file) => file.path.endsWith(".deb"));
    if (!deb) throw new Error("VERA_APT_KEY is set but the build wrote no deb");
    ({ fingerprint: aptFingerprint } = await buildAptRepository({
      folder: staging,
      deb: deb.path,
      key: aptKey,
    }));
    for (const name of aptFiles) files.push(await describeFile(staging, name));
  }
  await writeFile(
    join(staging, releaseNotesName),
    await releaseNotesFor(delivery.desktopVersion, delivery.version),
  );
  files.push(await describeFile(staging, releaseNotesName));
  await writeSums(staging, files);
  await commitPart(staging, target, values.replace);
} finally {
  await rm(staging, { recursive: true, force: true });
}
await recordPart(delivery, part, {
  signing: report.signing,
  updateFeed: feed,
  ...(aptFingerprint ? { aptKey: aptFingerprint } : {}),
  files: files.map((file) => ({ ...file, path: `${part}/${file.path}` })),
});
printPart(target, files, "npm run delivery:verify");
