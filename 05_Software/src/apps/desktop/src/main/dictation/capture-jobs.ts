import {
  type DictationBegin,
  type DictationOutcome,
  type DictationRecording,
  type DictationTranscript,
  dictationConnectionMs,
  dictationMaxSeconds,
} from "@vera/shared";
import type { LocalDictationModel } from "./models.js";

interface Job {
  id: string;
  phase: "verifying" | "opening" | "recording" | "transcribing";
  model?: LocalDictationModel;
  requested: boolean;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  result?: Promise<DictationOutcome>;
}

function isSilent(pcm: Float32Array): boolean {
  let energy = 0;
  for (const sample of pcm) energy += sample * sample;
  return pcm.length === 0 || energy / pcm.length < 0.000001;
}

/** Owns the single desktop microphone lease through final worker cleanup. */
export class CaptureJobs {
  private active: Job | undefined;
  private closed = false;

  constructor(
    private readonly resolveModel: () => Promise<LocalDictationModel | null>,
    private readonly transcribe: (
      model: LocalDictationModel,
      pcm: Float32Array,
      signal: AbortSignal,
    ) => Promise<DictationTranscript>,
    private readonly onExpired: (id: string) => void = () => {},
  ) {}

  get busy(): boolean {
    return this.active !== undefined;
  }

  private expire(job: Job, ms: number): void {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      this.cancel(job.id);
      this.onExpired(job.id);
    }, ms);
    job.timer.unref();
  }

  async begin(id: string): Promise<DictationBegin> {
    if (this.closed) return { status: "cancelled" };
    if (this.active) return { status: "busy" };
    const job: Job = {
      id,
      phase: "verifying",
      requested: false,
      controller: new AbortController(),
    };
    this.active = job;
    this.expire(job, dictationConnectionMs);
    const model = await this.resolveModel().catch(() => null);
    if (this.active !== job) return { status: "cancelled" };
    if (!model) {
      this.cancel(id);
      return { status: "missing-model" };
    }
    job.model = model;
    job.phase = "opening";
    this.expire(job, dictationConnectionMs);
    return { status: "opening" };
  }

  permitAudio(request: boolean): boolean {
    const job = this.active;
    if (job?.phase !== "opening" || (request && job.requested)) return false;
    if (request) job.requested = true;
    return true;
  }

  recording(id: string): DictationRecording {
    const job = this.active;
    if (job?.id !== id || job.phase !== "opening") return { status: "cancelled" };
    job.phase = "recording";
    this.expire(job, (dictationMaxSeconds + 5) * 1000);
    return { status: "recording" };
  }

  async finish(id: string, pcm: Float32Array): Promise<DictationOutcome> {
    const job = this.active;
    if (job?.id !== id || job.phase !== "recording" || !job.model) return { status: "cancelled" };
    if (isSilent(pcm)) {
      this.cancel(id);
      return { status: "no-speech" };
    }
    clearTimeout(job.timer);
    job.phase = "transcribing";
    job.result = this.infer(job, job.model, pcm);
    return job.result;
  }

  private async infer(job: Job, model: LocalDictationModel, pcm: Float32Array): Promise<DictationOutcome> {
    const signal = job.controller.signal;
    try {
      const result = await this.transcribe(model, pcm, signal);
      if (signal.aborted) return { status: "cancelled" };
      return result.text.trim() ? { status: "complete", ...result } : { status: "no-speech" };
    } catch {
      return { status: signal.aborted ? "cancelled" : "transcription-failed" };
    } finally {
      this.active = undefined;
    }
  }

  cancel(id = this.active?.id): void {
    const job = this.active;
    if (!job || id !== job.id) return;
    clearTimeout(job.timer);
    job.controller.abort();
    if (job.phase !== "transcribing") this.active = undefined;
  }

  interrupt(): void {
    const id = this.active?.id;
    if (!id) return;
    this.cancel(id);
    this.onExpired(id);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.interrupt();
    await this.active?.result;
  }
}
