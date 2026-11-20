import { dictationConnectionMs, dictationPcmSchema } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { CaptureJobs } from "./capture-jobs.js";
import type { LocalDictationModel } from "./models.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const first = "73059b83-6c74-488a-b24e-e515720ed472";
const second = "cbe9baf5-4b01-46d5-b309-62636398d663";
const model: LocalDictationModel = {
  directory: "/verified",
  id: "whisper-base",
  language: "ro",
  dtype: "q8",
};
const audio = () => new Float32Array(16000).fill(0.1);
const fixture = () => {
  const resolveModel = vi.fn<() => Promise<LocalDictationModel | null>>().mockResolvedValue(model);
  const transcribe = vi.fn().mockResolvedValue({ text: "Salut!", language: "ro" });
  const jobs = new CaptureJobs(resolveModel, transcribe);
  return { jobs, resolveModel, transcribe };
};

it("grants exactly one microphone request during opening and pins the model and language", async () => {
  const { jobs, resolveModel, transcribe } = fixture();
  expect(jobs.permitAudio(false)).toBe(false);
  await expect(jobs.begin(first)).resolves.toEqual({ status: "opening" });
  expect(jobs.permitAudio(false)).toBe(true);
  expect(jobs.permitAudio(true)).toBe(true);
  expect(jobs.permitAudio(true)).toBe(false);
  await expect(jobs.begin(second)).resolves.toEqual({ status: "busy" });
  expect(jobs.recording(first)).toEqual({ status: "recording" });
  expect(jobs.permitAudio(false)).toBe(false);
  resolveModel.mockResolvedValue({ ...model, id: "whisper-small", language: "de" });
  const pcm = audio();
  await expect(jobs.finish(first, pcm)).resolves.toEqual({
    status: "complete",
    text: "Salut!",
    language: "ro",
  });
  expect(transcribe).toHaveBeenCalledWith(model, pcm, expect.any(AbortSignal));
  expect(jobs.busy).toBe(false);
});

it("withholds the grant when a model is missing or verification outlives cancellation", async () => {
  const { jobs, resolveModel } = fixture();
  resolveModel.mockResolvedValueOnce(null);
  await expect(jobs.begin(first)).resolves.toEqual({ status: "missing-model" });
  const pending = deferred<LocalDictationModel>();
  resolveModel.mockReturnValueOnce(pending.promise);
  const start = jobs.begin(first);
  expect(jobs.permitAudio(false)).toBe(false);
  jobs.cancel(first);
  pending.resolve(model);
  await expect(start).resolves.toEqual({ status: "cancelled" });
  await expect(jobs.begin(second)).resolves.toEqual({ status: "opening" });
  await jobs.close();
});

it("suppresses a cancelled result and keeps admission until its worker settles", async () => {
  const { jobs, transcribe } = fixture();
  const late = deferred<{ text: string; language: string }>();
  transcribe.mockReturnValueOnce(late.promise);
  await jobs.begin(first);
  jobs.recording(first);
  const stale = jobs.finish(first, audio());
  jobs.cancel(first);
  const signal = transcribe.mock.calls[0]?.[2] as AbortSignal;
  expect(signal.aborted).toBe(true);
  await expect(jobs.begin(second)).resolves.toEqual({ status: "busy" });
  late.resolve({ text: "Stale", language: "en" });
  await expect(stale).resolves.toEqual({ status: "cancelled" });
  await expect(jobs.begin(second)).resolves.toEqual({ status: "opening" });
  jobs.cancel(first);
  expect(jobs.busy).toBe(true);
  await jobs.close();
});

it("rejects oversized, non-finite and out-of-range PCM", () => {
  expect(dictationPcmSchema.safeParse(new Float32Array(480000)).success).toBe(true);
  for (const pcm of [new Float32Array(480001), Float32Array.of(NaN), Float32Array.of(1.1), [0.1]]) {
    expect(dictationPcmSchema.safeParse(pcm).success).toBe(false);
  }
});

it("settles silence, empty transcripts and a failed worker with actionable outcomes", async () => {
  const { jobs, transcribe } = fixture();
  await jobs.begin(first);
  jobs.recording(first);
  await expect(jobs.finish(first, new Float32Array(16000))).resolves.toEqual({ status: "no-speech" });
  expect(transcribe).not.toHaveBeenCalled();
  transcribe.mockResolvedValueOnce({ text: " ", language: "en" });
  await jobs.begin(first);
  jobs.recording(first);
  await expect(jobs.finish(first, audio())).resolves.toEqual({ status: "no-speech" });
  transcribe.mockRejectedValueOnce(new Error("worker failed"));
  await jobs.begin(first);
  jobs.recording(first);
  await expect(jobs.finish(first, audio())).resolves.toEqual({ status: "transcription-failed" });
  expect(jobs.busy).toBe(false);
});

it("expires an opening grant and allows the next capture to proceed", async () => {
  vi.useFakeTimers();
  try {
    const { resolveModel, transcribe } = fixture();
    const expired = vi.fn();
    const jobs = new CaptureJobs(resolveModel, transcribe, expired);
    await jobs.begin(first);
    await vi.advanceTimersByTimeAsync(dictationConnectionMs);
    expect(expired).toHaveBeenCalledExactlyOnceWith(first);
    expect(jobs.permitAudio(true)).toBe(false);
    expect(jobs.recording(first)).toEqual({ status: "cancelled" });
    await expect(jobs.begin(second)).resolves.toEqual({ status: "opening" });
    await jobs.close();
  } finally {
    vi.useRealTimers();
  }
});

it("invalidates in-flight inference on shutdown and waits for the stopped worker", async () => {
  const { jobs, transcribe } = fixture();
  const worker = deferred<{ text: string; language: string }>();
  transcribe.mockReturnValueOnce(worker.promise);
  await jobs.begin(first);
  jobs.recording(first);
  const result = jobs.finish(first, audio());
  const shutdown = jobs.close();
  const signal = transcribe.mock.lastCall?.[2] as AbortSignal | undefined;
  expect(signal?.aborted).toBe(true);
  expect(jobs.busy).toBe(true);
  worker.resolve({ text: "Late shutdown result", language: "en" });
  await expect(result).resolves.toEqual({ status: "cancelled" });
  await shutdown;
  expect(jobs.busy).toBe(false);
  await expect(jobs.begin(second)).resolves.toEqual({ status: "cancelled" });
});
