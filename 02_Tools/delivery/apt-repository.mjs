import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { sha256File } from "./delivery-common.mjs";

// A flat apt repository (sources.list suite "/") beside the deb of the Linux part. GitHub release assets are flat
// files and releases/latest/download/ serves every file of the newest release, so
// `deb [signed-by=/usr/share/keyrings/vera-archive-keyring.gpg] <update feed> /` gives apt the Packages index and
// the deb of the same release. gpg and gpgv run in the repository folder with relative paths: the MSYS builds of
// Git for Windows read a C:\ path as relative.

/** The public key users install for `signed-by`. */
export const keyringName = "vera-archive-keyring.gpg";
/** Every file of the repository, in the part folder next to the deb. */
export const aptFiles = ["InRelease", "Packages", "Packages.gz", "Release", "Release.gpg", keyringName];
export const isAptFile = (name) => aptFiles.includes(name);
const indexes = ["Packages", "Packages.gz"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The control fields of a deb, as `dpkg-deb --field` prints them. */
export function debControl(path, dpkgDeb = "dpkg-deb") {
  const result = spawnSync(dpkgDeb, ["--field", path], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`${dpkgDeb} --field ${path} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout;
}

/** The deb's Packages stanza: its control fields, then the file apt downloads, its size and SHA-256. */
export function packagesEntry(control, deb) {
  const fields = control.replaceAll("\r\n", "\n").trimEnd();
  for (const name of ["Package", "Version", "Architecture"])
    if (!new RegExp(`^${name}: \\S+$`, "m").test(fields))
      throw new Error(`the deb control has no ${name} field`);
  if (/^(?:Filename|Size|SHA256):/m.test(fields))
    throw new Error("the deb control already has a Filename, Size or SHA256 field");
  return `${fields}\nFilename: ${deb.name}\nSize: ${deb.bytes}\nSHA256: ${deb.sha256}\n`;
}

/** The Release file: who publishes the repository, when, for which architecture, and each index's size and hash. */
export function releaseText(date, architecture, files) {
  return [
    "Origin: VERA",
    "Label: VERA",
    `Architectures: ${architecture}`,
    `Date: ${date.toUTCString().replace(/GMT$/, "UTC")}`,
    "Description: VERA for Debian and Ubuntu",
    "SHA256:",
    ...files.map((file) => ` ${file.sha256} ${String(file.bytes).padStart(16)} ${file.name}`),
    "",
  ].join("\n");
}

/** The stanzas of a deb822 file (Packages) as field maps; a continuation line joins the field above it. */
export function parseStanzas(text) {
  const stanzas = [];
  for (const block of text.replaceAll("\r\n", "\n").split(/\n{2,}/)) {
    const fields = {};
    let last;
    for (const line of block.split("\n")) {
      if (/^[ \t]/.test(line) && last) fields[last] += `\n${line}`;
      else {
        const match = /^([^:\s]+):[ \t]?(.*)$/.exec(line);
        if (match) {
          last = match[1];
          fields[last] = match[2];
        }
      }
    }
    if (Object.keys(fields).length) stanzas.push(fields);
  }
  return stanzas;
}

/** The SHA256 section of a Release file, by file name. */
export function releaseHashes(text) {
  const entries = new Map();
  let inside = false;
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    if (/^\S/.test(line)) inside = line.startsWith("SHA256:");
    const match = inside && /^\s+([0-9a-f]{64})\s+(\d+)\s+(\S+)$/.exec(line);
    if (match) entries.set(match[3], { bytes: Number(match[2]), sha256: match[1] });
  }
  return entries;
}

/** Runs gpg in `cwd` with the GnuPG home `gnupgHome` (relative to `cwd` or absolute, else GNUPGHOME or ~/.gnupg). */
function gpgRunner(gpg, gnupgHome, cwd) {
  const home = gnupgHome ? ["--homedir", gnupgHome] : [];
  return (args, input) => {
    const result = spawnSync(gpg, [...home, "--batch", ...args], { cwd, input, maxBuffer: 1 << 24 });
    if (result.status !== 0)
      throw new Error(
        `gpg ${args.join(" ")} failed: ${result.error?.message ?? String(result.stderr).trim()}`,
      );
    return result.stdout;
  };
}

/** The VERA_APT_KEY of `env` when the part is the Linux one (the only part with a deb), else none. */
export function aptKeyFor(platform, env = process.env) {
  return platform === "linux-x64" ? (env.VERA_APT_KEY ?? "") : "";
}

/**
 * The fingerprint of the one secret key `key` names (a fingerprint, key ID or user ID), proven usable by a trial
 * signature, so an expired, revoked or locked key fails before a long build; throws otherwise.
 */
export function signingKey(key, { gpg = "gpg", gnupgHome, cwd = process.cwd() } = {}) {
  const fingerprints = [];
  let primary = false;
  const run = gpgRunner(gpg, gnupgHome, cwd);
  const listing = run(["--with-colons", "--list-secret-keys", "--", key]);
  // Each primary secret key's fingerprint is the first fpr line after its sec line.
  for (const line of String(listing).split(/\r?\n/)) {
    if (line.startsWith("sec:")) primary = true;
    else if (primary && line.startsWith("fpr:")) {
      fingerprints.push(line.split(":")[9]);
      primary = false;
    }
  }
  if (fingerprints.length !== 1)
    throw new Error(`VERA_APT_KEY must name exactly one secret key, ${key} names ${fingerprints.length}`);
  run(["--local-user", fingerprints[0], "--digest-algo", "SHA512", "--clearsign"], "VERA apt key check\n");
  return fingerprints[0];
}

/**
 * Writes the repository beside `deb` in `folder` and signs it with the secret key `key` (a fingerprint, key ID or
 * user ID naming exactly one secret key of the GnuPG home: `gnupgHome`, relative to `folder` or absolute, else
 * GNUPGHOME or ~/.gnupg). `control` replaces `dpkg-deb --field` in tests. Returns the files and the key's fingerprint.
 */
export async function buildAptRepository({
  folder,
  deb,
  key,
  date = new Date(),
  control,
  gpg = "gpg",
  gnupgHome,
}) {
  const bytes = await readFile(join(folder, deb));
  const packages = packagesEntry(control ?? debControl(join(folder, deb)), {
    name: deb,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
  const compressed = gzipSync(packages, { level: 9 });
  const architecture = /^Architecture: (\S+)$/m.exec(packages)[1];
  await writeFile(join(folder, "Packages"), packages);
  await writeFile(join(folder, "Packages.gz"), compressed);
  await writeFile(
    join(folder, "Release"),
    releaseText(date, architecture, [
      { name: "Packages", bytes: Buffer.byteLength(packages), sha256: sha256(packages) },
      { name: "Packages.gz", bytes: compressed.length, sha256: sha256(compressed) },
    ]),
  );
  const run = gpgRunner(gpg, gnupgHome, folder);
  const fingerprint = signingKey(key, { gpg, gnupgHome, cwd: folder });
  // apt refuses SHA-1 signatures; SHA-512 is accepted everywhere.
  const sign = ["--yes", "--local-user", fingerprint, "--digest-algo", "SHA512"];
  run([...sign, "--clearsign", "--output", "InRelease", "Release"]);
  run([...sign, "--armor", "--detach-sign", "--output", "Release.gpg", "Release"]);
  // Binary even when gpg.conf says armor: signed-by and gpgv read a .gpg keyring as binary.
  await writeFile(join(folder, keyringName), run(["--no-armor", "--export", fingerprint]));
  return { files: [...aptFiles], fingerprint };
}

/** `explicit`, else gpgv on PATH, else the gpgv of Git for Windows; undefined when none runs. */
export function findGpgv(explicit) {
  const git = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "gpgv.exe");
  const candidates = explicit ? [explicit] : ["gpgv", ...(process.platform === "win32" ? [git] : [])];
  return candidates.find((candidate) => spawnSync(candidate, ["--version"]).status === 0);
}

/**
 * What is wrong with the apt repository among `files` of a Linux part folder: an incomplete set, a signature that
 * does not verify with the part's keyring or is not by `fingerprint`, an InRelease that signs another text than
 * Release, Release hashes that do not match the indexes, or a Packages entry that is not exactly the part's deb.
 * A part without repository files has no problems here; the delivery warns about it instead.
 */
export async function checkAptRepository(folder, files, { fingerprint, gpgv }) {
  if (!files.some(isAptFile)) return [];
  const missing = aptFiles.filter((name) => !files.includes(name));
  if (missing.length) return [`apt repository incomplete: ${missing.join(", ")} missing`];
  if (!gpgv) return ["apt repository: gpgv not found, so the signature is unchecked; pass --gpgv <path>"];
  const problems = [];
  const work = await mkdtemp(join(tmpdir(), "vera-apt-check-"));
  try {
    await mkdir(join(work, "home"), { mode: 0o700 });
    for (const name of ["InRelease", "Release", "Release.gpg", keyringName])
      await copyFile(join(folder, name), join(work, name));
    const verify = (name, args) => {
      const result = spawnSync(
        gpgv,
        ["--homedir", "home", "--keyring", `./${keyringName}`, "--status-fd", "1", ...args],
        { cwd: work },
      );
      const status = String(result.stdout);
      // apt accepts only GOODSIG: an expired or revoked key still gets VALIDSIG, with EXPKEYSIG or REVKEYSIG.
      // VALIDSIG ends with the primary key's fingerprint.
      const signer =
        result.status === 0 && /^\[GNUPG:\] GOODSIG /m.test(status)
          ? /^\[GNUPG:\] VALIDSIG .* ([0-9A-F]{40,64})\r?$/m.exec(status)?.[1]
          : undefined;
      if (!signer) {
        const reason = String(result.stderr ?? result.error?.message ?? "")
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .pop();
        problems.push(
          `${name}: the signature does not verify with ${keyringName}${reason ? ` (${reason.trim()})` : ""}`,
        );
      } else if (fingerprint && signer !== fingerprint.toUpperCase())
        problems.push(`${name}: signed by ${signer}, not by the recorded key ${fingerprint}`);
      return Boolean(signer);
    };
    const inline = verify("InRelease", ["--output", "signed", "InRelease"]);
    verify("Release.gpg", ["Release.gpg", "Release"]);
    const release = await readFile(join(folder, "Release"), "utf8");
    const same = (a, b) => a.replaceAll("\r\n", "\n").trimEnd() === b.replaceAll("\r\n", "\n").trimEnd();
    if (inline && !same(await readFile(join(work, "signed"), "utf8"), release))
      problems.push("InRelease: signs another text than Release");
    const hashes = releaseHashes(release);
    for (const name of indexes) {
      const bytes = await readFile(join(folder, name));
      const listed = hashes.get(name);
      if (!listed) problems.push(`Release: ${name} not listed`);
      else if (listed.bytes !== bytes.length || listed.sha256 !== sha256(bytes))
        problems.push(`Release: ${name} size or SHA-256 differs`);
    }
    const packages = await readFile(join(folder, "Packages"));
    let unpacked;
    try {
      unpacked = gunzipSync(await readFile(join(folder, "Packages.gz")));
    } catch {
      unpacked = undefined;
    }
    if (!unpacked?.equals(packages)) problems.push("Packages.gz: not the compressed Packages");
    const debs = files.filter((name) => name.endsWith(".deb"));
    const stanzas = parseStanzas(packages.toString("utf8"));
    if (stanzas.length !== 1 || debs.length !== 1)
      problems.push(
        `Packages: lists ${stanzas.length} package(s) for ${debs.length} deb(s), expected one each`,
      );
    else {
      const [entry] = stanzas;
      const [deb] = debs;
      const path = join(folder, deb);
      if (entry.Filename !== deb) problems.push(`Packages: names ${entry.Filename}, not ${deb}`);
      else if (Number(entry.Size) !== (await stat(path)).size || entry.SHA256 !== (await sha256File(path)))
        problems.push(`Packages: size or SHA-256 of ${deb} differs`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return problems;
}
