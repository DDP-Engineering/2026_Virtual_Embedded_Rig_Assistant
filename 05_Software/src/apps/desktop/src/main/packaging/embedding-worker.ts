import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

async function embed() {
  if (isMainThread || !parentPort) throw new Error("Embedding probe requires a worker thread");
  const imported = performance.now();
  const { env, pipeline } = await import("@huggingface/transformers");
  const importMs = performance.now() - imported;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = workerData.models;
  env.useFSCache = false;
  env.useBrowserCache = false;
  const loaded = performance.now();
  const extractor = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", {
    dtype: "q8",
    device: "cpu",
    local_files_only: true,
  });
  const loadMs = performance.now() - loaded;
  try {
    const chunks = [];
    for (const text of workerData.sentences as string[]) {
      const started = performance.now();
      const tensor = await extractor(text, { pooling: "cls", normalize: true });
      const values = Array.from(tensor.data, Number);
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
      if (values.length !== 384 || !values.every(Number.isFinite) || Math.abs(norm - 1) > 0.0001) {
        throw new Error("Embedding dimension/finite/normalization assertion failed");
      }
      const bytes = Buffer.from(new Float32Array(values).buffer);
      chunks.push({
        text,
        elapsedMs: performance.now() - started,
        dimensions: values.length,
        norm,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sample: values.slice(0, 4),
      });
    }
    return {
      status: "passed",
      worker: !isMainThread,
      backend: "onnxruntime-node",
      device: "cpu",
      dtype: "q8",
      allowRemoteModels: env.allowRemoteModels,
      models: env.localModelPath,
      importMs,
      loadMs,
      chunks,
    };
  } finally {
    await extractor.dispose();
  }
}

void embed().then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (error) => parentPort?.postMessage({ ok: false, error: String(error) }),
);
