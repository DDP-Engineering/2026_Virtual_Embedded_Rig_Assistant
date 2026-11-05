import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { unzipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The uv platform key of this build host (plugin platform names). */
export function uvPlatform(platform = process.platform, arch = process.arch) {
  return `${platform === "win32" ? "windows" : platform}-${arch}`;
}

/** The manifest entry of a platform, validated before any download or file write. */
export function uvEntry(manifest, platform) {
  const entry = manifest.platforms?.[platform];
  if (!entry) throw new Error(`No pinned uv for ${platform}`);
  const prefix = `https://github.com/astral-sh/uv/releases/download/${manifest.version}/`;
  if (
    !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    typeof entry.url !== "string" ||
    !entry.url.startsWith(prefix) ||
    !/^[a-zA-Z0-9_.-]+\.(?:zip|tar\.gz)$/.test(entry.url.slice(prefix.length)) ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !/^[a-f0-9]{64}$/.test(entry.binarySha256) ||
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?$/.test(entry.member) ||
    !/^uv(?:\.exe)?$/.test(entry.binary)
  )
    throw new Error(`Invalid pinned uv descriptor for ${platform}`);
  return entry;
}

/** The bytes of one regular file of a ustar/GNU tar archive (long names through `L` records). */
function tarMember(archive, member) {
  let longName;
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const data = archive.subarray(offset + 512, offset + 512 + size);
    longName = type === "L" ? data.toString("utf8").replace(/\0.*$/s, "") : undefined;
    if ((type === "0" || type === "7") && name.replace(/^\.\//, "") === member) return Buffer.from(data);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

/** Extracts the uv binary from a pinned release archive (zip on Windows, tar.gz on Linux). */
function extractMember(archive, entry) {
  if (entry.url.endsWith(".zip")) {
    const files = unzipSync(archive, { filter: (file) => file.name === entry.member });
    return files[entry.member] ? Buffer.from(files[entry.member]) : undefined;
  }
  return tarMember(gunzipSync(archive), entry.member);
}

/** Fails unless the file at `path` is the pinned uv binary of `entry`. */
export async function checkUvBinary(path, entry) {
  if (sha256(await readFile(path)) !== entry.binarySha256)
    throw new Error(`Packaged uv integrity mismatch: ${entry.binary}`);
}

/**
 * Writes `<destination>/<platform>/<binary>` from the pinned archive only when the archive and the
 * extracted binary match the manifest. The archive is cached in `<destination>/.cache/` and reused
 * once verified; a mismatch fails naming the file and leaves no binary behind.
 */
export async function prepareUv(
  manifest,
  destination,
  { fetchImpl = fetch, platform = uvPlatform(), offline = false } = {},
) {
  const entry = uvEntry(manifest, platform);
  const target = join(destination, platform, entry.binary);
  try {
    await checkUvBinary(target, entry);
    return { version: manifest.version, platform, path: target, sha256: entry.binarySha256 };
  } catch (error) {
    if (error.code !== "ENOENT" && !/integrity/.test(error.message)) throw error;
  }
  await rm(target, { force: true });
  const name = entry.url.split("/").at(-1);
  const cached = join(destination, ".cache", entry.sha256, name);
  let archive;
  try {
    archive = await readFile(cached);
    if (sha256(archive) !== entry.sha256) throw new Error(`uv archive integrity mismatch: ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (offline) throw new Error(`Verified uv archive missing: ${name}`);
    const response = await fetchImpl(entry.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`uv download failed (${response.status}): ${name}`);
    archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) !== entry.sha256) throw new Error(`uv archive integrity mismatch: ${name}`);
    await mkdir(dirname(cached), { recursive: true });
    await writeFile(cached, archive);
  }
  const binary = extractMember(archive, entry);
  if (!binary) throw new Error(`uv archive lacks ${entry.member}: ${name}`);
  if (sha256(binary) !== entry.binarySha256) throw new Error(`uv binary integrity mismatch: ${entry.binary}`);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.partial`;
  try {
    await writeFile(temporary, binary, { flag: "wx", mode: 0o755 });
    await chmod(temporary, 0o755);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return { version: manifest.version, platform, path: target, sha256: entry.binarySha256 };
}

export async function prepareBundledUv(offline = false) {
  const manifest = JSON.parse(await readFile(join(root, "src/uv/uv-manifest.json"), "utf8"));
  return { ...(await prepareUv(manifest, join(root, "src/uv"), { offline })), manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prepared = await prepareBundledUv(process.argv.includes("--offline"));
  console.log(`Pinned uv ${prepared.version} verified: ${prepared.path}`);
}
