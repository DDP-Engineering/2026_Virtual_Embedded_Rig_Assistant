import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { browserRelease } from "../../05_Software/src/apps/desktop/src/main/browser/release.ts";
import { dictationCatalog } from "../../05_Software/src/apps/desktop/src/main/dictation/catalog.ts";
import { importSoftware } from "../environment/software.mjs";
import {
  assertCanWrite,
  commitPart,
  describeFile,
  listFiles,
  recordPart,
  sha256File,
  startStaging,
  sumsName,
  writeSums,
  zipFiles,
} from "./delivery-common.mjs";

// The offline components part of a delivery: the browser runtime and the dictation models that Desktop otherwise
// downloads on first use. Every file is the exact upstream artifact, or a ZIP of exact upstream files, checked
// against the pins compiled into Desktop; those pins verify them again when Desktop installs from the file.

export const componentsPart = "components";
export const noticesName = "THIRD-PARTY-NOTICES.md";
export const apacheLicense = new URL("./licenses/Apache-2.0.txt", import.meta.url);

/** The files of the part, from the Desktop pins: one Chrome for Testing ZIP per platform, one ZIP per model. */
export function componentPins(
  releases = [browserRelease("win32", "x64"), browserRelease("linux", "x64")],
  catalog = dictationCatalog,
) {
  return {
    browsers: releases.map((release) => ({
      name: basename(new URL(release.url).pathname),
      url: release.url,
      version: release.version,
      bytes: release.archiveBytes,
      sha256: release.archiveSha256,
    })),
    models: catalog.map((model) => ({
      id: model.id,
      name: `${model.id}.zip`,
      repository: model.repository,
      revision: model.revision,
      license: model.license,
      files: model.files.map((file) => ({
        path: file.path,
        url: `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.path}?download=true`,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
    })),
  };
}

/** The file names the part holds besides `SHA256SUMS`, sorted. */
export function componentNames(pins) {
  return [
    ...pins.browsers.map((item) => item.name),
    ...pins.models.map((item) => item.name),
    noticesName,
  ].sort();
}

/** Stream one pinned file to `destination`, refusing it when it is unreadable or differs from its pin. */
async function fetchPinned(fetchFile, pin, destination, label) {
  let response;
  try {
    response = await fetchFile(pin.url);
  } catch (error) {
    throw new Error(`${label}: cannot be fetched (${error.message})`, { cause: error });
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  const hash = createHash("sha256");
  let received = 0;
  const verify = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > pin.bytes) return callback(new Error(`${label}: differs from its pin (longer)`));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(destination, { flags: "wx" }));
  } catch (error) {
    if (error.message.startsWith(label)) throw error;
    throw new Error(`${label}: cannot be fetched (${error.message})`, { cause: error });
  }
  if (received !== pin.bytes || hash.digest("hex") !== pin.sha256)
    throw new Error(`${label}: differs from its pin (${received} of ${pin.bytes} bytes)`);
}

const modelTitle = (id) =>
  id
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
const licenceTitle = (license) => (license === "Apache-2.0" ? "Apache License 2.0" : license);

/** `THIRD-PARTY-NOTICES.md`: each component with its version or revision, source and licence, then the Apache text. */
export function formatNotices(pins, apache) {
  const browsers = pins.browsers;
  const version = browsers[0]?.version;
  const lines = [
    "# Third-party notices",
    "",
    "The files in this folder are third-party components that VERA installs without network. Each is the unchanged",
    "upstream file, or a ZIP of unchanged upstream files, and VERA checks it against the SHA-256 it pins.",
    "",
    `## Google Chrome for Testing ${version}`,
    "",
    `- Files: ${browsers.map((item) => `\`${item.name}\``).join(", ")}`,
    "- Source: https://googlechromelabs.github.io/chrome-for-testing/",
    ...browsers.map((item) => `- Downloaded from: ${item.url}`),
    "- Copyright Google LLC. Chrome for Testing is provided under the Google Chrome Terms of Service",
    "  (chrome://terms). It is built from the Chromium open source project (https://www.chromium.org/); the",
    "  licences of its open source components are listed at chrome://credits. Each archive holds its own `ABOUT` file.",
    "",
  ];
  for (const model of pins.models) {
    lines.push(
      `## ${modelTitle(model.id)} (${model.repository})`,
      "",
      `- File: \`${model.name}\``,
      `- Source: https://huggingface.co/${model.repository}, revision \`${model.revision}\``,
      `- Licence: ${licenceTitle(model.license)}, printed below`,
      "",
    );
  }
  lines.push("## Apache License 2.0", "", "");
  return lines.join("\n") + apache;
}

/** Fetch, check and write every component file and `SHA256SUMS` into the empty folder `out`. */
export async function buildComponents(
  out,
  { pins = componentPins(), apache, fetch: fetchFile = globalThis.fetch },
) {
  await mkdir(out, { recursive: true });
  for (const browser of pins.browsers)
    await fetchPinned(fetchFile, browser, join(out, browser.name), browser.name);
  const work = join(out, ".models");
  for (const model of pins.models) {
    const folder = join(work, model.id);
    for (const file of model.files) {
      const destination = join(folder, ...file.path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await fetchPinned(fetchFile, file, destination, `${model.name}: ${file.path}`);
    }
    await zipFiles(folder, model.files.map((file) => file.path).sort(), join(out, model.name));
  }
  await rm(work, { recursive: true, force: true });
  await writeFile(
    join(out, noticesName),
    formatNotices(pins, apache ?? (await readFile(apacheLicense, "utf8"))),
  );
  const files = [];
  for (const name of componentNames(pins)) files.push(await describeFile(out, name));
  await writeSums(out, files);
  return files;
}

/**
 * Build the part in staging next to it, move it in only when complete and record it in `delivery.json` with the
 * Chrome for Testing version, the model revisions and every file; a failure keeps the earlier part and record.
 */
export async function writeComponentsPart(
  delivery,
  { replace = false, pins = componentPins(), ...options } = {},
) {
  const target = join(delivery.folder, componentsPart);
  assertCanWrite(target, replace);
  const staging = await startStaging(delivery.folder, componentsPart);
  let files;
  try {
    const out = join(staging, componentsPart);
    files = await buildComponents(out, { pins, ...options });
    await commitPart(out, target, replace);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await recordPart(delivery, componentsPart, {
    chromeForTesting: pins.browsers[0]?.version,
    models: Object.fromEntries(pins.models.map((model) => [model.id, model.revision])),
    files: files.map((file) => ({ ...file, path: `${componentsPart}/${file.path}` })),
  });
  return files;
}

/** Problems of a components part against the Desktop pins: missing, unexpected and changed files or members. */
export async function verifyComponents(folder, { pins = componentPins(), hash = sha256File } = {}) {
  const problems = [];
  const present = new Set((await listFiles(folder)).filter((name) => name !== sumsName));
  const expected = componentNames(pins);
  for (const name of expected) if (!present.has(name)) problems.push(`${name}: missing`);
  for (const name of present) if (!expected.includes(name)) problems.push(`${name}: unexpected file`);
  for (const browser of pins.browsers) {
    if (!present.has(browser.name)) continue;
    const path = join(folder, browser.name);
    if ((await stat(path)).size !== browser.bytes || (await hash(path)) !== browser.sha256)
      problems.push(`${browser.name}: differs from its pin`);
  }
  const fflate = await importSoftware("fflate");
  const { unzipSync } = fflate.unzipSync ? fflate : fflate.default;
  for (const model of pins.models) {
    if (!present.has(model.name)) continue;
    let members;
    try {
      // A Buffer is a Uint8Array: no second copy of a ZIP of up to 250 MB.
      members = unzipSync(await readFile(join(folder, model.name)));
    } catch {
      problems.push(`${model.name}: not a readable ZIP`);
      continue;
    }
    const pinned = new Map(model.files.map((file) => [file.path, file]));
    for (const member of Object.keys(members))
      if (!member.endsWith("/") && !pinned.has(member))
        problems.push(`${model.name}: ${member} is not a pinned model file`);
    for (const file of model.files) {
      const bytes = members[file.path];
      if (!bytes) problems.push(`${model.name}: ${file.path} missing`);
      else if (
        bytes.length !== file.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== file.sha256
      )
        problems.push(`${model.name}: ${file.path} differs from its pin`);
    }
  }
  return problems;
}
