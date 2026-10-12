import { Tokenizer } from "@huggingface/tokenizers";
import definition from "./bge-tokenizer.json";
import configuration from "./bge-tokenizer_config.json";

// Budget against the existing package's tokenizer, without loading an embedding model.
// Snapshot provenance: resources/model-manifest.json, Xenova/bge-small-en-v1.5
// revision ea104dacec62c0de699686887e3f920caeb4f3e3, MIT license.
const tokenizer = new Tokenizer(definition, configuration);
export const CHUNK_TOKEN_LIMIT = 512;
export function countChunkTokens(text: string): number {
  return tokenizer.encode(text, { add_special_tokens: true }).ids.length;
}
