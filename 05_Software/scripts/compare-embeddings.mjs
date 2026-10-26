import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { prepareModel } from "./prepare-model.mjs";
import { fuse, keywordIndex, semanticRank, summarize, validateFixture } from "./retrieval/evaluation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function embedding(descriptor, models, chunks, questions) {
  const worker = new Worker(new URL("./retrieval/embedding-worker.mjs", import.meta.url), {
    workerData: { descriptor, models, chunks, questions },
  });
  return new Promise((accept, reject) => {
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => (error ? reject(error) : accept(value)), reject);
    };
    const timer = setTimeout(
      () => finish(undefined, Error("Embedding comparison deadline exceeded")),
      600_000,
    );
    worker.once("message", (message) =>
      message.ok ? finish(message.result) : finish(undefined, Error(message.error)),
    );
    worker.once("error", (error) => finish(undefined, error));
    worker.once("exit", () => finish(undefined, Error("Embedding worker exited before result")));
  });
}
async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const value = args[args.indexOf(name) + 1];
    if (!args.includes(name) || !value || value.startsWith("--")) throw Error(`Required ${name}`);
    return resolve(value);
  };
  const scratch = option("--scratch"),
    models = option("--models"),
    output = option("--output");
  const local = relative(resolve(root, "../02_Tools/cache/wp24-TASK-fd4046b2"), scratch);
  if (local.startsWith("..") || isAbsolute(local) || !local)
    throw Error("Use an owned WP24 scratch directory");
  await mkdir(scratch, { recursive: true });
  if (!existsSync(join(scratch, "node_modules")))
    await symlink(
      join(root, "node_modules"),
      join(scratch, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
  await build({
    entryPoints: {
      corpus: join(root, "scripts/retrieval/corpus.mjs"),
      "pdf-worker": join(root, "src/libraries/core/src/knowledge/pdf-worker.ts"),
    },
    outdir: scratch,
    platform: "node",
    format: "esm",
    bundle: true,
    packages: "external",
    outExtension: { ".js": ".mjs" },
    target: "node24",
  });
  const fixtureBytes = await readFile(join(root, "tests/fixtures/retrieval/demo-board.yaml"));
  const { loadCorpus } = await import(pathToFileURL(join(scratch, "corpus.mjs")).href);
  const corpus = await loadCorpus(
    join(root, "tests/fixtures/workbenches/demo-board"),
    pathToFileURL(join(scratch, "pdf-worker.mjs")),
  );
  const fixture = validateFixture(fixtureBytes.toString("utf8"), corpus.chunks);
  const candidates = [];
  for (const file of ["bge-model-manifest.json", "e5-model-manifest.json"]) {
    const bytes = await readFile(join(root, "tests/fixtures/retrieval", file));
    const manifest = JSON.parse(bytes.toString("utf8"));
    await prepareModel(manifest, models, { offline: !args.includes("--prepare") });
    candidates.push({
      manifest,
      manifestSha256: sha(bytes),
      packageBytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
      onnxBytes: manifest.files.filter((f) => f.path.endsWith(".onnx")).reduce((n, f) => n + f.bytes, 0),
    });
  }
  const index = keywordIndex(corpus.chunks);
  const keywordRanks = fixture.questions.map((q) => index.search(q.query));
  index.close();
  const results = [];
  for (const candidate of candidates) {
    const measured = await embedding(candidate.manifest, models, corpus.chunks, fixture.questions);
    const semanticRanks = measured.queryVectors.map((q) =>
      semanticRank(
        q,
        measured.vectors,
        corpus.chunks.map((c) => c.id),
      ),
    );
    const hybridRanks = semanticRanks.map((r, i) => fuse([keywordRanks[i], r]));
    const { vectors: _vectors, queryVectors: _queries, ...timing } = measured;
    results.push({
      ...candidate,
      timing,
      retrieval: {
        keyword: summarize(fixture.questions, corpus.chunks, keywordRanks),
        semantic: summarize(fixture.questions, corpus.chunks, semanticRanks),
        hybrid: summarize(fixture.questions, corpus.chunks, hybridRanks),
      },
    });
    console.log(
      JSON.stringify({
        model: candidate.manifest.modelId,
        packageBytes: candidate.packageBytes,
        warmMs: timing.warm.meanWallMs,
        recall: results.at(-1).retrieval.hybrid.overall,
      }),
    );
  }
  const files = [
    "scripts/compare-embeddings.mjs",
    "scripts/prepare-model.mjs",
    "scripts/retrieval/corpus.mjs",
    "scripts/retrieval/embedding-worker.mjs",
    "scripts/retrieval/evaluation.mjs",
    "src/libraries/core/src/knowledge/chunk.ts",
    "src/libraries/core/src/knowledge/token-budget.ts",
    "src/libraries/core/src/knowledge/extraction.ts",
    "src/libraries/core/src/knowledge/worker-host.ts",
    "src/libraries/core/src/knowledge/pdf-worker.ts",
    "src/libraries/core/src/knowledge/bge-tokenizer.json",
    "src/libraries/core/src/knowledge/bge-tokenizer_config.json",
    "package-lock.json",
  ];
  const sourceHashes = {};
  for (const file of files) sourceHashes[file] = sha(await readFile(join(root, file)));
  const report = {
    schema: 1,
    recordedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      architecture: process.arch,
      release: release(),
      cpu: cpus()[0].model,
      logicalCores: cpus().length,
      totalMemoryBytes: totalmem(),
      node: process.version,
      execPath: process.execPath,
      transformers: "4.3.1",
      onnxruntimeNode: "1.30.0",
    },
    method: {
      k: 5,
      rankLimit: 50,
      rrfConstant: 60,
      warmPasses: 3,
      batchSize: 1,
      cold: "Fresh worker and model session; OS disk cache uncontrolled",
      wall: "performance.now per single chunk, including tokenizer/pooling/normalization",
      cpu: "process.cpuUsage delta, user+system; serial operator, one ORT thread",
      keyword: "Isolated in-memory FTS5 OR words plus digit/underscore trigram terms, RRF60 union",
      recall: "Exact expected path+page/heading in top5 chunks / single-label questions",
    },
    fixtureSha256: sha(fixtureBytes),
    corpusSha256: sha(JSON.stringify(corpus)),
    sourceHashes,
    corpus,
    questions: fixture.questions,
    candidates: results,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
