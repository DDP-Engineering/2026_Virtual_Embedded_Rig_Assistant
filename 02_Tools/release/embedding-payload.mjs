import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { embeddingModelIds } from "../../05_Software/src/libraries/shared/src/embedding-models.ts";
import { readBundledModel } from "../environment/prepare-model.mjs";
import { software } from "../environment/software.mjs";

export const modelSource = join(software, "src/models");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Build the package member list using the registered models and source checkout pins. */
export async function embeddingPayload(manifests = undefined) {
  const models = manifests ?? (await Promise.all(embeddingModelIds.map(readBundledModel)));
  const files = [];
  for (const model of models) {
    const path = `resources/models/${model.modelId}`;
    for (const name of ["model-manifest.json", "LICENSE.txt"]) {
      const bytes = await readFile(join(modelSource, model.modelId, name));
      files.push({ path: `${path}/${name}`, bytes: bytes.length, sha256: sha256(bytes) });
    }
    for (const asset of model.files) {
      files.push({ path: `${path}/${asset.path}`, bytes: asset.bytes, sha256: asset.sha256 });
    }
  }
  return files;
}

/** Check installed paths against source pins, independent of any delivered manifest. */
export async function checkEmbeddingPayload(files, readMember) {
  for (const file of files) {
    let bytes;
    try {
      bytes = await readMember(file.path, file.bytes);
    } catch (error) {
      throw new Error(`${file.path}: ${error.message}`, { cause: error });
    }
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
      throw new Error(`${file.path}: embedding payload integrity mismatch`);
  }
}
