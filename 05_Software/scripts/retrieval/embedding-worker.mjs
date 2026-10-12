import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";

async function measure() {
  const { descriptor: manifest, models, chunks, questions } = workerData;
  const descriptor = manifest.embedding;
  // Fail any unexpected network access in addition to Transformers' local-only configuration.
  globalThis.fetch = async () => {
    throw Error("Network forbidden during inference");
  };
  const imported = performance.now();
  const { env, pipeline } = await import("@huggingface/transformers");
  const importMs = performance.now() - imported;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = models;
  env.useFSCache = false;
  env.useBrowserCache = false;
  const sessionOptions = { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential" };
  const loaded = performance.now();
  const extractor = await pipeline("feature-extraction", manifest.modelId, {
    dtype: manifest.dtype,
    device: "cpu",
    local_files_only: true,
    session_options: sessionOptions,
  });
  const loadMs = performance.now() - loaded;
  try {
    const counts = [];
    const inputs = [
      ...chunks.map((c) => descriptor.passagePrefix + c.text),
      ...questions.map((q) => descriptor.queryPrefix + q.query),
    ];
    for (const text of inputs) {
      const tokens = extractor.tokenizer(text, { truncation: false, padding: false }).input_ids;
      const count = Number(tokens.dims.at(-1));
      if (!Number.isSafeInteger(count) || count >= descriptor.maxTokens)
        throw Error(`Input exceeds full prefixed token budget: ${count}`);
      counts.push(count);
    }
    const encode = async (text) => {
      const wall = performance.now(),
        cpu = process.cpuUsage();
      const tensor = await extractor(text, {
        pooling: descriptor.pooling,
        normalize: descriptor.normalize,
      });
      const elapsedMs = performance.now() - wall,
        usage = process.cpuUsage(cpu);
      const values = Array.from(tensor.data, Number);
      const norm = Math.hypot(...values);
      if (
        values.length !== descriptor.dimensions ||
        !values.every(Number.isFinite) ||
        Math.abs(norm - 1) > 0.0001
      )
        throw Error("Embedding dimension/finite/normalization assertion failed");
      return { values, elapsedMs, cpuMs: (usage.user + usage.system) / 1000, norm };
    };
    const cold = await encode(inputs[0]);
    await encode(inputs[0]); // one untimed warm-up, then three complete serial passes
    const samples = [],
      vectors = [];
    for (let pass = 0; pass < 3; pass++) {
      for (let index = 0; index < chunks.length; index++) {
        const result = await encode(inputs[index]);
        samples.push({ pass, chunkId: chunks[index].id, wallMs: result.elapsedMs, cpuMs: result.cpuMs });
        if (pass === 0) vectors.push(result.values);
      }
    }
    const queryVectors = [],
      querySamples = [];
    for (let index = 0; index < questions.length; index++) {
      const result = await encode(inputs[chunks.length + index]);
      queryVectors.push(result.values);
      querySamples.push({ id: questions[index].id, wallMs: result.elapsedMs, cpuMs: result.cpuMs });
    }
    const walls = samples.map((s) => s.wallMs).sort((a, b) => a - b);
    const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;
    const vectorSha256 = createHash("sha256")
      .update(Buffer.from(new Float32Array(vectors.flat()).buffer))
      .digest("hex");
    return {
      vectors,
      queryVectors,
      vectorSha256,
      importMs,
      loadMs,
      firstChunk: {
        wallMs: cold.elapsedMs,
        cpuMs: cold.cpuMs,
      },
      warm: {
        samples,
        meanWallMs: average(walls),
        medianWallMs: walls[Math.floor(walls.length / 2)],
        p95WallMs: walls[Math.ceil(walls.length * 0.95) - 1],
        meanCpuMs: average(samples.map((s) => s.cpuMs)),
      },
      querySamples,
      tokenCounts: counts,
      maxInputTokens: Math.max(...counts),
      backend: "onnxruntime-node",
      device: "cpu",
      dtype: manifest.dtype,
      allowRemoteModels: env.allowRemoteModels,
      sessionOptions,
    };
  } finally {
    await extractor.dispose();
  }
}
void measure().then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (error) => parentPort.postMessage({ ok: false, error: String(error) }),
);
