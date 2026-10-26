import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { env, pipeline } from "@huggingface/transformers";
import { modelSchema, type VectorRow } from "./embedding.js";

if (isMainThread || !parentPort) throw Error("Embeddings require a worker.");
const model = modelSchema.parse(workerData.model);
globalThis.fetch = async () => {
  throw Error("Network forbidden during local inference.");
};
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = workerData.models;
env.useFSCache = false;
env.useBrowserCache = false;
const loaded = (async () => {
  for (const file of model.files) {
    const bytes = await readFile(join(workerData.models, model.modelId, file.path));
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw Error("Local model integrity mismatch.");
  }
  return pipeline("feature-extraction", model.modelId, {
    dtype: model.dtype,
    device: "cpu",
    local_files_only: true,
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential" },
  });
})();
// Keep initialization failures handled until the first request consumes them.
void loaded.catch(() => {});
let cache: VectorRow[] = [],
  epoch = "";
async function encode(texts: string[], query = false) {
  const extractor = await loaded,
    descriptor = model.embedding;
  const inputs = texts.map((text) => (query ? descriptor.queryPrefix : descriptor.passagePrefix) + text);
  for (const text of inputs) {
    const count = Number(
      extractor.tokenizer(text, { truncation: false, padding: false }).input_ids.dims.at(-1),
    );
    if (!Number.isSafeInteger(count) || count >= descriptor.maxTokens)
      throw Error("Full prefixed input exceeds token budget.");
  }
  const vectors: number[][] = [];
  for (let at = 0; at < inputs.length; at += 32) {
    const batch = inputs.slice(at, at + 32);
    const tensor = await extractor(batch, { pooling: descriptor.pooling, normalize: true });
    const data = Array.from(tensor.data, Number);
    if (data.length !== batch.length * descriptor.dimensions || !data.every(Number.isFinite))
      throw Error("Invalid vector dimensions.");
    for (let index = 0; index < batch.length; index++) {
      const values = data.slice(index * 384, (index + 1) * 384);
      if (Math.abs(Math.hypot(...values) - 1) > 0.0001) throw Error("Invalid vector normalization.");
      vectors.push(values);
    }
  }
  return vectors;
}
parentPort.on(
  "message",
  async (task: { type: string; texts: string[]; query: string; epoch: string; rows?: VectorRow[] }) => {
    try {
      if (task.type === "embed") {
        parentPort?.postMessage({ ok: true, result: await encode(task.texts) });
        return;
      }
      if (task.type !== "rank") throw Error("Unknown embedding request.");
      if (epoch !== task.epoch) {
        if (!task.rows) throw Error("Vector cache requires a refresh.");
        for (const row of task.rows)
          if (
            row.vector.length !== 384 ||
            !Array.from(row.vector).every(Number.isFinite) ||
            Math.abs(Math.hypot(...row.vector) - 1) > 0.0001
          )
            throw Error("Invalid cached vector.");
        cache = task.rows;
        epoch = task.epoch;
      }
      const query = (await encode([task.query], true))[0];
      if (!query) throw Error("Missing query vector.");
      const result = cache
        .map((row) => ({ id: row.id, score: row.vector.reduce((sum, x, n) => sum + x * (query[n] ?? 0), 0) }))
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .slice(0, 50);
      parentPort?.postMessage({ ok: true, result });
    } catch {
      parentPort?.postMessage({ ok: false });
    }
  },
);
