import {
  type DictationOutcome,
  dictationConnectionMs,
  dictationMaxSeconds,
  type VeraBridge,
  veraErrorSchema,
} from "@vera/shared";
import { type Microphone, openMicrophone } from "./microphone.js";

export type DictationPhase = "idle" | "opening" | "recording" | "transcribing";

type Complete = Extract<DictationOutcome, { status: "complete" }>;
export type DictationCaptureResult = Exclude<DictationOutcome, Complete> | (Complete & { session: string });

interface CaptureOwner {
  session: string;
}

interface Capture {
  id: string;
  owner: CaptureOwner;
  phase: Exclude<DictationPhase, "idle"> | "flushing";
  controller: AbortController;
  complete: (result: DictationCaptureResult) => void;
  timer?: ReturnType<typeof setTimeout>;
  input?: Awaited<ReturnType<Microphone>>;
}

/** Bind the active composer session before invoking start from a trusted input event. */
export class DictationCapture {
  private owner: CaptureOwner | undefined;
  private active: Capture | undefined;

  constructor(
    private readonly invoke: VeraBridge["invoke"],
    private readonly onPhase: (phase: DictationPhase) => void,
    private readonly open: Microphone = openMicrophone,
  ) {}

  setSession(session: string | null): void {
    if (session === (this.owner?.session ?? null)) return;
    this.owner = session === null ? undefined : { session };
    this.cancel();
  }

  start(): Promise<DictationCaptureResult> {
    const owner = this.owner;
    if (!owner) return Promise.resolve({ status: "cancelled" });
    if (this.active) return Promise.resolve({ status: "busy" });
    return new Promise((complete) => {
      const job: Capture = {
        id: crypto.randomUUID(),
        owner,
        phase: "opening",
        controller: new AbortController(),
        complete,
      };
      this.active = job;
      this.timeout(job, dictationConnectionMs, { status: "microphone-unavailable" });
      void this.acquire(job);
      this.onPhase("opening");
    });
  }

  private timeout(job: Capture, ms: number, outcome: DictationOutcome): void {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => this.settle(job, outcome, true), ms);
  }

  private async acquire(job: Capture): Promise<void> {
    const { id, controller } = job;
    try {
      const begin = await this.invoke("dictation.begin", { id });
      if (this.active !== job) return;
      if (begin.status !== "opening") {
        this.settle(job, { status: begin.status });
        return;
      }
      this.timeout(job, dictationConnectionMs, { status: "microphone-unavailable" });
      const input = await this.open(
        controller.signal,
        (pcm) => void this.submit(job, pcm),
        () => this.settle(job, { status: "microphone-disconnected" }, true),
        () => this.settle(job, { status: "microphone-unavailable" }, true),
      );
      if (this.active !== job) {
        input.close();
        return;
      }
      job.input = input;
      const result = await this.invoke("dictation.recording", { id });
      if (this.active !== job) return;
      if (result.status !== "recording") {
        this.settle(job, { status: result.status }, true);
        return;
      }
      job.input.start();
      job.phase = "recording";
      clearTimeout(job.timer);
      job.timer = setTimeout(() => this.stop(), dictationMaxSeconds * 1000);
      this.onPhase("recording");
    } catch (error) {
      const denied =
        (error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "SecurityError")) ||
        veraErrorSchema.safeParse(error).data?.code === "DENIED";
      this.settle(job, { status: denied ? "permission-denied" : "microphone-unavailable" }, true);
    }
  }

  stop(): void {
    const job = this.active;
    if (job?.phase === "opening") {
      this.cancel();
    } else if (job?.phase === "recording") {
      job.phase = "flushing";
      this.timeout(job, 2_000, { status: "microphone-unavailable" });
      job.input?.stop();
    }
  }

  cancel(id = this.active?.id): void {
    if (this.active && id === this.active.id) this.settle(this.active, { status: "cancelled" }, true);
  }

  private async submit(job: Capture, pcm: Float32Array): Promise<void> {
    if (this.active !== job || (job.phase !== "recording" && job.phase !== "flushing")) return;
    clearTimeout(job.timer);
    job.input?.close();
    delete job.input;
    job.phase = "transcribing";
    this.onPhase("transcribing");
    try {
      this.settle(job, await this.invoke("dictation.finish", { id: job.id, pcm }));
    } catch {
      this.settle(job, { status: "transcription-failed" }, true);
    }
  }

  private settle(job: Capture, outcome: DictationOutcome, cancel = false): void {
    if (this.active !== job) return;
    this.active = undefined;
    clearTimeout(job.timer);
    job.controller.abort();
    job.input?.close();
    delete job.input;
    if (cancel) void this.invoke("dictation.cancel", { id: job.id }).catch(() => {});
    this.onPhase("idle");
    if (this.owner !== job.owner) job.complete({ status: "cancelled" });
    else if (outcome.status === "complete") job.complete({ ...outcome, session: job.owner.session });
    else job.complete(outcome);
  }
}

/** Creates a capture controller with native and renderer lifetime notifications. */
export function createDictationCapture(
  api: VeraBridge,
  onPhase: (phase: DictationPhase) => void,
): { capture: DictationCapture; dispose: () => void } {
  const capture = new DictationCapture(api.invoke, onPhase);
  const cancel = () => capture.cancel();
  const onVisibility = () => {
    if (document.hidden) cancel();
  };
  const unsubscribe = api.subscribe("app", (event) => {
    if (event.type === "dictation.interrupted") capture.cancel(event.id);
  });
  window.addEventListener("blur", cancel);
  window.addEventListener("pagehide", cancel);
  document.addEventListener("visibilitychange", onVisibility);
  return {
    capture,
    dispose() {
      capture.setSession(null);
      unsubscribe();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
