import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractZip } from "@vera/core";
import type { BrowserRuntimeView } from "@vera/shared";
import { BrowserError, type BrowserFailure } from "./failure.js";
import { browserTreeLimits, verifyBrowserTree } from "./integrity.js";
import { type BrowserRelease, browserRelease } from "./release.js";

export type BrowserRuntimeStatus =
  | { phase: "unknown" | "missing" | "verifying" | "installing" | "cancelled" | "removing" }
  | { phase: "downloading"; received: number; total: number }
  | { phase: "ready"; version: string }
  | { phase: "failed"; failure: BrowserFailure };

const installTimeoutMs = 15 * 60_000;
const remove = (path: string) => rm(path, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });

/** Desktop-owned Chromium installation. Only provision() performs a network transfer. */
export class BrowserRuntime {
  private readonly release: BrowserRelease | undefined;
  private readonly transfer: typeof fetch;
  private current: BrowserRuntimeStatus = { phase: "unknown" };
  private job: { controller: AbortController; done: Promise<BrowserRuntimeStatus> } | undefined;
  private removal: Promise<BrowserRuntimeStatus> | undefined;
  private closed = false;

  constructor(
    private readonly root: string,
    options: { release?: BrowserRelease; transfer?: typeof fetch } = {},
  ) {
    this.release = options.release ?? browserRelease();
    this.transfer = options.transfer ?? fetch;
  }

  status(): BrowserRuntimeStatus {
    return this.current;
  }

  view(): BrowserRuntimeView {
    const status = this.status();
    return status.phase === "failed" ? { phase: "failed", failure: status.failure.code } : status;
  }

  /** Check disk readiness without creating anything or touching the network. */
  async inspect(): Promise<BrowserRuntimeStatus> {
    if (
      this.removal ||
      this.job ||
      this.current.phase === "cancelled" ||
      (this.current.phase === "failed" && this.current.failure.code === "cleanup")
    )
      return this.current;
    const previous = this.current;
    const status = await this.check();
    if (!this.job && this.current === previous) this.current = status;
    return this.current;
  }

  provision(): Promise<BrowserRuntimeStatus> {
    if (this.closed) return Promise.resolve({ phase: "cancelled" });
    if (this.removal) return Promise.resolve(this.current);
    if (this.job) return this.job.done;
    const controller = new AbortController();
    this.current = { phase: "verifying" };
    const done = this.install(controller.signal).then((status) => {
      this.job = undefined;
      this.current = status;
      return status;
    });
    this.job = { controller, done };
    return done;
  }

  async cancel(): Promise<void> {
    const job = this.job;
    if (!job) return;
    job.controller.abort();
    const result = await job.done;
    if (result.phase === "failed" && result.failure.code === "cleanup") throw new BrowserError("cleanup");
  }

  /** Drain browser owners before deleting files, and block provisioning until removal settles. */
  remove(beforeRemove: () => Promise<void>): Promise<BrowserRuntimeStatus> {
    if (this.removal) return this.removal;
    if (this.closed || this.job) return Promise.resolve(this.current);
    this.current = { phase: "removing" };
    this.removal = Promise.resolve()
      .then(async (): Promise<BrowserRuntimeStatus> => {
        try {
          const release = this.getRelease();
          try {
            await beforeRemove();
          } catch (cause) {
            throw new BrowserError("cleanup", { cause });
          }
          await this.cleanStaging(join(this.root, ".installing"));
          await this.cleanStaging(join(this.root, release.version));
          return { phase: "missing" };
        } catch (error) {
          return this.failed(error);
        }
      })
      .then((status) => {
        this.removal = undefined;
        this.current = status;
        return status;
      });
    return this.removal;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await this.cancel();
    await this.removal;
    if (this.current.phase === "failed" && this.current.failure.code === "cleanup")
      await this.cleanStaging(join(this.root, ".installing"));
  }

  async executable(signal: AbortSignal = new AbortController().signal): Promise<string> {
    if (this.removal) throw new BrowserError("cancelled");
    const previous = this.current;
    try {
      return await this.verify(signal);
    } catch (error) {
      if (
        !signal.aborted &&
        this.current === previous &&
        !this.job &&
        !this.removal &&
        error instanceof BrowserError
      ) {
        if (error.code === "runtime-missing") this.current = { phase: "missing" };
        if (error.code === "integrity") this.current = this.failed(error);
      }
      throw error;
    }
  }

  private async verify(signal: AbortSignal): Promise<string> {
    const release = this.getRelease();
    return verifyBrowserTree(join(this.root, release.version), release, signal);
  }

  private getRelease(): BrowserRelease {
    if (!this.release) throw new BrowserError("unsupported-platform");
    return this.release;
  }

  private async check(): Promise<BrowserRuntimeStatus> {
    try {
      await this.verify(AbortSignal.timeout(30_000));
      return { phase: "ready", version: this.getRelease().version };
    } catch (error) {
      return error instanceof BrowserError && error.code === "runtime-missing"
        ? { phase: "missing" }
        : this.failed(error);
    }
  }

  private async install(cancellation: AbortSignal): Promise<BrowserRuntimeStatus> {
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(installTimeoutMs)]);
    const staging = join(this.root, ".installing");
    try {
      const release = this.getRelease();
      const destination = join(this.root, release.version);
      // Clear residue left by an interrupted process only inside this runtime's dedicated folder.
      await this.cleanStaging(staging);
      try {
        await this.verify(signal);
        signal.throwIfAborted();
        return { phase: "ready", version: release.version };
      } catch (error) {
        if (!(error instanceof BrowserError) || !["runtime-missing", "integrity"].includes(error.code))
          throw error;
      }
      try {
        signal.throwIfAborted();
        await mkdir(staging, { recursive: true, mode: 0o700 });
        const archive = join(staging, "chrome.zip");
        await this.download(release, archive, signal);
        this.current = { phase: "installing" };
        const tree = join(staging, "runtime");
        await mkdir(tree);
        await extractZip(archive, tree, signal, browserTreeLimits);
        for (const file of release.executables) await chmod(join(tree, file), 0o755);
        await verifyBrowserTree(tree, release, signal);
        signal.throwIfAborted();
        await remove(destination);
        signal.throwIfAborted();
        await rename(tree, destination);
      } finally {
        await this.cleanStaging(staging);
      }
      return { phase: "ready", version: release.version };
    } catch (error) {
      if (error instanceof BrowserError && error.code === "cleanup") return this.failed(error);
      if (cancellation.aborted) return { phase: "cancelled" };
      return this.failed(signal.aborted ? new BrowserError("download", { cause: error }) : error);
    }
  }

  private async cleanStaging(path: string): Promise<void> {
    try {
      await remove(path);
    } catch (error) {
      throw new BrowserError("cleanup", { cause: error });
    }
  }

  private failed(error: unknown): BrowserRuntimeStatus {
    const failure = error instanceof BrowserError ? error : new BrowserError("storage", { cause: error });
    return { phase: "failed", failure: failure.failure() };
  }

  private async download(release: BrowserRelease, destination: string, signal: AbortSignal): Promise<void> {
    const total = release.archiveBytes;
    let received = 0;
    this.current = { phase: "downloading", received, total };
    let response: Response;
    try {
      response = await this.transfer(release.url, { signal, redirect: "error", credentials: "omit" });
    } catch (error) {
      throw new BrowserError("download", { cause: error });
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new BrowserError("download");
    }

    const hash = createHash("sha256");
    const verify = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.length;
        if (received > total) return callback(new BrowserError("integrity"));
        hash.update(chunk);
        this.current = { phase: "downloading", received, total };
        callback(null, chunk);
      },
    });
    const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    let interrupted = false;
    source.on("error", (error) => {
      interrupted = error instanceof TypeError;
    });
    try {
      await pipeline(source, verify, createWriteStream(destination, { flags: "wx", mode: 0o600 }), {
        signal,
      });
    } catch (error) {
      if (interrupted) throw new BrowserError("download", { cause: error });
      throw error;
    }
    if (received !== total || hash.digest("hex") !== release.archiveSha256)
      throw new BrowserError("integrity");
  }
}
