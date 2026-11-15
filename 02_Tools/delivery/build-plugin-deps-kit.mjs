import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { prepareBundledUv } from "../environment/prepare-uv.mjs";
import { software } from "../environment/software.mjs";
import {
  assertCanWrite,
  commitPart,
  currentDelivery,
  describeFile,
  listTree,
  printPart,
  readSums,
  recordPart,
  requireHost,
  runVeraCli,
  startStaging,
  writeSums,
  zipFiles,
} from "./delivery-common.mjs";

// Builds the offline dependency kit of this host's platform with `vera catalog kit` (needs network and the
// pinned uv) and zips it as 07_Delivery/vera-<version>/plugin-deps/vera-plugin-deps-<version>-<platform>.zip.
// The other platform's zip in the same folder stays; SHA256SUMS lists both.
const { values } = parseArgs({
  options: {
    platform: { type: "string" },
    skip: { type: "string", default: "sigrok" },
    replace: { type: "boolean", default: false },
  },
});
requireHost(values.platform);
const delivery = await currentDelivery();
const name = `vera-plugin-deps-${delivery.version}-${values.platform}`;
const folder = join(delivery.folder, "plugin-deps");
const target = join(folder, `${name}.zip`);
assertCanWrite(target, values.replace);

await prepareBundledUv();
const staging = await startStaging(delivery.folder, `plugin-deps-${values.platform}`);
let file;
let kit;
try {
  const out = join(staging, name);
  runVeraCli([
    "catalog",
    "kit",
    "--source",
    join(software, "plugins"),
    "--platform",
    values.platform,
    "--out",
    out,
    ...(values.skip ? ["--skip", values.skip] : []),
  ]);
  kit = JSON.parse(await readFile(join(out, "kit.json"), "utf8"));
  await zipFiles(out, await listTree(out), join(staging, `${name}.zip`), name);
  await mkdir(folder, { recursive: true });
  await commitPart(join(staging, `${name}.zip`), target, values.replace);
  file = await describeFile(folder, `${name}.zip`);
  const others = (await readSums(folder)).filter((entry) => entry.path !== file.path);
  await writeSums(folder, [...others, file]);
} finally {
  await rm(staging, { recursive: true, force: true });
}
await recordPart(delivery, `plugin-deps/${values.platform}`, {
  skipped: kit.skipped ?? [],
  kitBytes: kit.bytes,
  files: [{ ...file, path: `plugin-deps/${file.path}` }],
});
printPart(folder, [file], "npm run delivery:verify");
