import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { software } from "../environment/software.mjs";
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
// 07_Delivery/vera-<version>/vera-<platform>/ with RELEASE-NOTES.md and SHA256SUMS. Never the instrumented
// (--test) build.
const { values } = parseArgs({
  options: { platform: { type: "string" }, replace: { type: "boolean", default: false } },
});
requireHost(values.platform);
const delivery = await currentDelivery();
const part = `vera-${values.platform}`;
const target = join(delivery.folder, part);
assertCanWrite(target, values.replace);

run(process.execPath, [join(repository, "02_Tools/release/package.mjs")]);
const release = join(software, "release_tmp/release");
const report = JSON.parse(await readFile(join(release, "package-report.json"), "utf8"));
if (report.testBuild) throw new Error("package-report.json is an instrumented build");

const staging = await startStaging(delivery.folder, part);
let files;
try {
  files = [];
  for (const artifact of report.artifacts) {
    await copyFile(join(release, artifact.path), join(staging, artifact.path));
    const file = await describeFile(staging, artifact.path);
    if (file.sha256 !== artifact.sha256 || file.bytes !== artifact.bytes)
      throw new Error(`${artifact.path} differs from package-report.json`);
    files.push(file);
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
  files: files.map((file) => ({ ...file, path: `${part}/${file.path}` })),
});
printPart(target, files, "npm run delivery:verify");
