import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import definition from "./bge-tokenizer.json";
import configuration from "./bge-tokenizer_config.json";
import type { EmbeddingModel } from "./embedding.js";

export type PassageBudget = (text: string) => boolean;

function canEncode(tokenizer: Tokenizer, prefix: string, limit: number): PassageBudget {
  return (text) => tokenizer.encode(prefix + text, { add_special_tokens: true }).ids.length < limit;
}

// Extraction without model resources uses the pinned BGE snapshot, which has an empty passage prefix.
const tokenizer = new Tokenizer(definition, configuration);
export const defaultPassageBudget = canEncode(tokenizer, "", 512);

/** Load the verified tokenizer files beside the model and count the full passage input. */
export function createPassageBudget(models: string, model: EmbeddingModel): PassageBudget {
  function readTokenizerFile(path: string) {
    const file = model.files.find((file) => file.path === path);
    if (!file) throw Error("Missing tokenizer in local model manifest.");
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(models, model.modelId, path));
    } catch (cause) {
      throw Error(`Local embedding tokenizer unavailable for ${model.modelId} (${path}).`, { cause });
    }
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw Error("Local model tokenizer integrity mismatch.");
    return JSON.parse(bytes.toString("utf8"));
  }

  return canEncode(
    new Tokenizer(readTokenizerFile("tokenizer.json"), readTokenizerFile("tokenizer_config.json")),
    model.embedding.passagePrefix,
    model.embedding.maxTokens,
  );
}
