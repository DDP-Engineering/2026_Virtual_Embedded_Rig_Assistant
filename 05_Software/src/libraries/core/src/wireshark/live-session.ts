import { liveCaptureFailureSchema } from "@vera/shared";
import type { ProgramRun } from "../plugins/runner.js";
import type { finalizeLiveCapture, LiveCaptureIdentity } from "./live-evidence.js";
import { liveFailure } from "./live-native.js";
import { CaptureError } from "./native.js";

type Finalize = typeof finalizeLiveCapture;
type FinalCapture = Awaited<ReturnType<Finalize>>;
interface CaptureJob {
  identity: LiveCaptureIdentity;
  phase: "starting" | "running" | "finalizing" | "finished";
  stop: AbortController;
  done?: Promise<Record<string, unknown>>;
  runId?: string;
  result?: Record<string, unknown>;
}

/** Run handles and finalization belong to one workbench service and its individual sessions. */
export class LiveCaptureSessions {
  private readonly jobs = new Map<string, CaptureJob>();

  async start(
    identity: LiveCaptureIdentity,
    launch: (stop: AbortSignal) => Promise<ProgramRun>,
    finalize: (result: Awaited<ProgramRun["done"]>) => Promise<FinalCapture>,
    cleanup: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const active = [...this.jobs.values()].filter((job) => job.phase !== "finished");
    if (active.length >= 4 || active.some((job) => job.identity.sessionId === identity.sessionId)) {
      await cleanup();
      throw new CaptureError(
        "capture_busy",
        "Stop this session's live capture or wait for a workbench slot.",
      );
    }
    const job: CaptureJob = { identity, phase: "starting", stop: new AbortController() };
    this.jobs.set(identity.captureId, job);
    const ready = launch(job.stop.signal).then((run) => {
      job.runId = run.id;
      job.phase = "running";
      return run;
    });
    job.done = ready
      .then(async (run) => {
        const result = await run.done;
        job.phase = "finalizing";
        const evidence = await finalize(result);
        return {
          captureId: identity.captureId,
          runId: run.id,
          status: evidence.manifest.status,
          ...evidence,
        };
      })
      .catch((error: unknown) => {
        const stopped = job.stop.signal.aborted && job.phase === "starting";
        const parsed = liveCaptureFailureSchema.safeParse(
          error instanceof CaptureError ? error.reason : null,
        );
        const reason = parsed.data ?? (job.phase === "finalizing" ? "capture_storage" : "capture_startup");
        return stopped
          ? { captureId: identity.captureId, status: "stopped", reason: "stopped" }
          : { captureId: identity.captureId, status: "failed", reason, error: liveFailure(reason).message };
      })
      .then(async (result) => {
        await cleanup();
        job.result = result;
        job.phase = "finished";
        const completed = [...this.jobs.values()].filter((entry) => entry.phase === "finished");
        for (const old of completed.slice(0, Math.max(0, completed.length - 32))) {
          this.jobs.delete(old.identity.captureId);
        }
        return result;
      });
    if (!identity.limits.rotation) return job.done;
    try {
      await ready;
      return this.view(job);
    } catch {
      return job.done;
    }
  }

  status(sessionId: string, captureId: string) {
    return this.view(this.owned(sessionId, captureId));
  }

  async stop(sessionId: string, captureId: string) {
    const job = this.owned(sessionId, captureId);
    job.stop.abort();
    return (await job.done) ?? this.view(job);
  }

  async stopOwner(sessionId?: string) {
    await Promise.all(
      [...this.jobs.values()]
        .filter(
          (job) =>
            job.phase !== "finished" && (sessionId === undefined || job.identity.sessionId === sessionId),
        )
        .map((job) => {
          job.stop.abort();
          return job.done;
        }),
    );
  }

  forgetOwner(sessionId: string) {
    for (const [captureId, job] of this.jobs)
      if (job.identity.sessionId === sessionId) this.jobs.delete(captureId);
  }

  private owned(sessionId: string, captureId: string) {
    const job = this.jobs.get(captureId);
    if (job?.identity.sessionId !== sessionId)
      throw new CaptureError("capture_not_found", "Use a live capture ID issued in this session.");
    return job;
  }

  private view(job: CaptureJob) {
    return (
      job.result ?? {
        captureId: job.identity.captureId,
        status: job.phase,
        runId: job.runId,
        startedAt: job.identity.startedAt,
        expiresAt: new Date(
          Date.parse(job.identity.startedAt) + job.identity.limits.durationSeconds * 1000,
        ).toISOString(),
      }
    );
  }
}
