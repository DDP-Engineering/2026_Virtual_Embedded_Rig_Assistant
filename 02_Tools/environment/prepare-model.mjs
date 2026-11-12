import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { software } from "./software.mjs";

const root = software;

function confinedPath(path) {
  if (
    typeof path !== "string" ||
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid model path: ${path}`);
  }
  return path;
}

function verify(bytes, file) {
  if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new Error(`Model integrity mismatch: ${file.path}`);
  }
}

export async function prepareModel(manifest, destination, { fetchImpl = fetch, offline = false } = {}) {
  const model = join(destination, confinedPath(manifest.modelId));
  if (!/^[a-f0-9]{40}$/.test(manifest.revision)) throw new Error("Model revision must be immutable");
  // Validate the entire manifest before any download or filesystem mutation.
  for (const file of manifest.files) {
    confinedPath(file.path);
    const url = new URL(file.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "huggingface.co" ||
      !url.pathname.includes(`/resolve/${manifest.revision}/`) ||
      !url.pathname.endsWith(`/${file.path}`) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0
    ) {
      throw new Error(`Invalid immutable asset descriptor: ${file.path}`);
    }
  }
  for (const file of manifest.files) {
    const target = join(model, file.path);
    try {
      verify(await readFile(target), file);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (offline) throw new Error(`Verified model asset missing: ${file.path}`);
    const response = await fetchImpl(file.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Model download failed (${response.status}): ${file.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verify(bytes, file);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.partial`;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return model;
}

export async function prepareBundledModel(offline = false) {
  const manifest = JSON.parse(await readFile(join(root, "src/models/model-manifest.json"), "utf8"));
  await prepareModel(manifest, join(root, "src/models"), { offline });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareBundledModel(process.argv.includes("--offline"));
  console.log("Pinned model assets verified");
}
