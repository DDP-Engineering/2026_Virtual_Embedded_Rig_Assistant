import { EventEmitter } from "node:events";
import { resolveAdvanced } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { transcribeInWorker } from "./worker-host.js";

const workers = vi.hoisted(() => ({
  launch: vi.fn(),
  terminate: vi.fn<() => Promise<number>>(),
}));

vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    readonly stdout = { resume: vi.fn() };
    readonly stderr = { resume: vi.fn() };
    readonly terminate = workers.terminate;
    constructor(entry: URL, options: unknown) {
      super();
      workers.launch(this, entry, options);
    }
  },
}));

const model = {
  id: "whisper-base",
  directory: "/verified/whisper-base",
  dtype: "q8",
  language: "auto",
} as const;

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("transfers packed PCM and validates the worker reply before returning", async () => {
  const pcm = Float32Array.of(0.2);
  const signal = new AbortController().signal;
  const inference = transcribeInWorker(model, pcm, signal);
  const [worker, entry, options] = workers.launch.mock.calls[0] ?? [];
  expect((entry as URL).pathname).toMatch(/whisper-worker\.js$/);
  expect(options).toMatchObject({ workerData: { model, pcm }, transferList: [pcm.buffer] });
  (worker as EventEmitter).emit("message", { text: "Hello", language: "en" });
  await expect(inference).resolves.toEqual({ text: "Hello", language: "en" });
  expect(workers.terminate).toHaveBeenCalledOnce();
});

it("terminates the worker on abort, deadline, early exit and invalid response", async () => {
  vi.useFakeTimers();
  for (const failure of ["abort", "deadline", "exit", "invalid"] as const) {
    const controller = new AbortController();
    const result = transcribeInWorker(model, Float32Array.of(0.2), controller.signal, 20);
    const settled = expect(result).rejects.toThrow("Local dictation worker did not complete");
    const worker = workers.launch.mock.lastCall?.[0] as EventEmitter;
    if (failure === "abort") controller.abort();
    if (failure === "deadline") await vi.advanceTimersByTimeAsync(20);
    if (failure === "exit") worker.emit("exit", 1);
    if (failure === "invalid") worker.emit("message", { text: "unknown", language: "auto" });
    await settled;
  }
  expect(workers.terminate).toHaveBeenCalledTimes(4);
});

it.each([
  [undefined, 120],
  [45, 45],
] as const)("allows a stalled transcription %s seconds or the inherited limit", async (setting, seconds) => {
  vi.useFakeTimers();
  const deadline =
    setting === undefined
      ? undefined
      : resolveAdvanced("dictationTranscriptionTimeout", { app: { dictationTranscriptionTimeout: setting } })
          .value * 1000;
  const result = transcribeInWorker(model, Float32Array.of(0.2), new AbortController().signal, deadline);
  const failed = expect(result).rejects.toThrow("Local dictation worker did not complete");
  await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
  expect(workers.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await failed;
  expect(workers.terminate).toHaveBeenCalledOnce();
});
