import { copyFile, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  bundledPluginsFolder,
  checkBundledPlugins,
  prepareBundledPlugins,
} from "../environment/prepare-plugins.mjs";
import {
  assertCanWrite,
  catalogPublicKey,
  commitPart,
  currentDelivery,
  describeFile,
  licenseName,
  listFiles,
  printPart,
  recordPart,
  repository,
  runVeraCli,
  startStaging,
  writeSums,
  zipFiles,
} from "./delivery-common.mjs";

// Builds the official plugins' catalog release with `npm run prepare:plugins`, signs its channel indexes
// when a key is given, and collects it in 07_Delivery/vera-<version>/plugins/ with one archive of the whole
// catalog, vera-plugins-<version>.zip, VERA's LICENSE.txt and SHA256SUMS.
const { values } = parseArgs({
  options: { "signing-key": { type: "string" }, replace: { type: "boolean", default: false } },
});
const delivery = await currentDelivery();
const part = "plugins";
const target = join(delivery.folder, part);
assertCanWrite(target, values.replace);

await prepareBundledPlugins();
const staging = await startStaging(delivery.folder, part);
let files;
let index;
try {
  await cp(bundledPluginsFolder, staging, { recursive: true });
  index = await checkBundledPlugins(staging);
  if (values["signing-key"])
    runVeraCli([
      "catalog",
      "sign",
      "--release",
      staging,
      "--key",
      resolve(values["signing-key"]),
      "--public",
      catalogPublicKey,
    ]);
  await copyFile(join(repository, licenseName), join(staging, licenseName));
  const catalog = await listFiles(staging);
  const archive = `vera-plugins-${delivery.version}.zip`;
  await zipFiles(staging, catalog, join(staging, archive), `vera-plugins-${delivery.version}`);
  files = [];
  for (const name of [...catalog, archive]) files.push(await describeFile(staging, name));
  await writeSums(staging, files);
  await commitPart(staging, target, values.replace);
} finally {
  await rm(staging, { recursive: true, force: true });
}
await recordPart(delivery, part, {
  signed: Boolean(values["signing-key"]),
  plugins: index.plugins.length,
  files: files.map((file) => ({ ...file, path: `${part}/${file.path}` })),
});
printPart(
  target,
  files,
  "npm run delivery:vera -- --platform <windows-x64|linux-x64>, then npm run delivery:verify",
);
