import { Worker } from "node:worker_threads";
import { type DictationTranscript, dictationTranscriptSchema } from "@vera/shared";
import type { LocalDictationModel } from "./models.js";

/** Runs one bounded CPU job and releases its worker before admitting another. */
export async function transcribeInWorker(
  model: LocalDictationModel,
  pcm: Float32Array,
  signal: AbortSignal,
  deadlineMs = 120_000,
): Promise<DictationTranscript> {
  signal.throwIfAborted();
  if (!(pcm.buffer instanceof ArrayBuffer)) throw new Error("Invalid dictation buffer");
  const worker = new Worker(new URL("./whisper-worker.js", import.meta.url), {
    workerData: { model, pcm },
    transferList: [pcm.buffer],
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = new AbortController();
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error("Local dictation worker did not complete"));
      worker.once("message", (message: unknown) => {
        const result = dictationTranscriptSchema.safeParse(message);
        if (result.success) resolve(result.data);
        else fail();
      });
      worker.on("error", fail);
      worker.once("exit", fail);
      signal.addEventListener("abort", fail, { once: true, signal: settled.signal });
      timer = setTimeout(fail, deadlineMs);
    });
  } finally {
    clearTimeout(timer);
    settled.abort();
    await worker.terminate();
  }
}
