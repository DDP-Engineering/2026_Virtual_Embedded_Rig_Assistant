import { execFileSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { checkEmbeddingPayload } from "../release/embedding-payload.mjs";

function run(tool, args, options = {}) {
  try {
    return execFileSync(tool, args, {
      windowsHide: true,
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("Full 7-Zip (7z or 7zz) is required. Set --7zip to its executable path.");
    throw new Error(String(error.stderr ?? "").trim() || error.message, { cause: error });
  }
}

function list(tool, archive, type) {
  const output = run(tool, ["l", "-slt", "-ba", "-sccUTF-8", `-t${type}`, "--", archive]);
  return output
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Path = "))
    .map((line) => line.slice(7).replaceAll("\\", "/"));
}

function extractArgs(archive, type, member) {
  return ["x", "-so", "-spd", "-bso0", "-bsp0", `-t${type}`, "--", archive, ...(member ? [member] : [])];
}

function unpack(tool, archive, type, member, output) {
  const file = openSync(output, "wx");
  try {
    run(tool, extractArgs(archive, type, member), { stdio: ["ignore", file, "pipe"] });
  } finally {
    closeSync(file);
  }
}

function oneMember(members, pattern, description) {
  const matches = members.filter((member) => pattern.test(member));
  if (matches.length !== 1) throw new Error(`Expected one ${description}, found ${matches.length}`);
  return matches[0];
}

/** Inspect only archive members. Installers and executable images are never launched. */
export async function verifyEmbeddingArchive(artifact, files, tool) {
  const scratch = await mkdtemp(join(tmpdir(), "vera-delivery-models-"));
  try {
    let archive = artifact;
    let type;
    let prefix = "";
    switch (extname(artifact)) {
      case ".zip":
        type = "zip";
        break;
      case ".exe": {
        type = "Nsis";
        const members = list(tool, artifact, type);
        const nested = members.filter((member) => /^(?:\$PLUGINSDIR\/)?app-64\.7z$/.test(member));
        if (nested.length) {
          if (nested.length !== 1) throw new Error("Multiple NSIS x64 payloads");
          archive = join(scratch, "app-64.7z");
          unpack(tool, artifact, type, nested[0], archive);
          type = "7z";
        }
        break;
      }
      case ".AppImage":
        type = "SquashFS";
        break;
      case ".deb": {
        const data = oneMember(
          list(tool, artifact, "Ar"),
          /^data\.tar\.(?:gz|xz|zst)$/,
          "Debian data archive",
        );
        const compressed = join(scratch, data);
        unpack(tool, artifact, "Ar", data, compressed);
        archive = join(scratch, "data.tar");
        const compression = { ".gz": "gzip", ".xz": "xz", ".zst": "zstd" }[extname(data)];
        unpack(tool, compressed, compression, undefined, archive);
        type = "tar";
        prefix = "opt/VERA/";
        break;
      }
      default:
        throw new Error("Unsupported desktop artifact");
    }

    const members = list(tool, archive, type);
    const membersByPath = new Map();
    for (const member of members) {
      const path = type === "tar" ? member.replace(/^\.\//, "") : member;
      membersByPath.set(path, membersByPath.has(path) ? null : member);
    }
    await checkEmbeddingPayload(files, (path, bytes) => {
      const member = membersByPath.get(prefix + path);
      if (!member) throw new Error("expected exactly one archive member");
      return run(tool, extractArgs(archive, type, member), { maxBuffer: bytes + 65_536 });
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
