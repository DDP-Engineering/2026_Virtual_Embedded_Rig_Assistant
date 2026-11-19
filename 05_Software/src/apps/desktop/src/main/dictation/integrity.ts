import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DictationModelSpec } from "./catalog.js";
import { hasFileError } from "./transfer.js";

export async function modelStat(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasFileError(error, "ENOENT", "ENOTDIR")) return undefined;
    throw error;
  }
}

async function entriesMatch(path: string, expected: string[]): Promise<boolean> {
  const entries = await readdir(path);
  return entries.length === expected.length && entries.every((entry) => expected.includes(entry));
}

function identity(info: Stats) {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs];
}

/** Check the complete loader-visible tree, including extra paths that the loader could use. */
export async function modelFingerprint(path: string, spec: DictationModelSpec): Promise<string | null> {
  const rootInfo = await modelStat(path);
  if (!rootInfo?.isDirectory()) return null;
  const onnx = join(path, "onnx");
  const onnxInfo = await modelStat(onnx);
  if (!onnxInfo?.isDirectory()) return null;
  const expected = spec.files.map((file) => file.path);
  const rootFiles = expected.filter((name) => !name.includes("/"));
  const onnxFiles = expected.filter((name) => name.startsWith("onnx/")).map((name) => name.slice(5));
  if (!(await entriesMatch(path, [...rootFiles, "onnx"])) || !(await entriesMatch(onnx, onnxFiles)))
    return null;

  const identities = [identity(rootInfo), identity(onnxInfo)];
  for (const file of spec.files) {
    const info = await modelStat(join(path, file.path));
    if (!info?.isFile() || info.size !== file.bytes) return null;
    identities.push(identity(info));
  }
  return JSON.stringify(identities);
}

export async function modelHashesMatch(
  path: string,
  spec: DictationModelSpec,
  signal?: AbortSignal,
): Promise<boolean> {
  for (const file of spec.files) {
    const hash = createHash("sha256");
    let received = 0;
    for await (const chunk of createReadStream(join(path, file.path), { signal })) {
      received += chunk.length;
      if (received > file.bytes) return false;
      hash.update(chunk);
    }
    if (received !== file.bytes || hash.digest("hex") !== file.sha256) return false;
  }
  return true;
}
