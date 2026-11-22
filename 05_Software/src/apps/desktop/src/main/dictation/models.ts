import { mkdir, rename, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { SettingsService } from "@vera/core";
import {
  type DictationChange,
  type DictationDownloadFailure,
  type DictationLanguage,
  type DictationModelId,
  type DictationModelState,
  type DictationSnapshot,
  dictationDefaults,
  veraError,
} from "@vera/shared";
import { extractModelArchive } from "./archive.js";
import { type DictationModelSpec, dictationCatalog } from "./catalog.js";
import { modelFingerprint, modelHashesMatch, modelStat } from "./integrity.js";
import { downloadModelFile, hasFileError, ModelDownloadError } from "./transfer.js";

interface Download {
  spec: DictationModelSpec;
  bytes: number;
  receivedBytes: number;
  controller: AbortController;
  /** A picked local archive; without it the files come from the pinned model source. */
  file?: string;
  publishing: boolean;
  done: Promise<void>;
}

/** Verified inputs for the trusted local transcription host. */
export interface LocalDictationModel {
  id: DictationModelId;
  directory: string;
  dtype: DictationModelSpec["dtype"];
  language: DictationLanguage;
}

type Availability = "missing" | "corrupt" | "installed";

async function diskBytes(directory: string): Promise<number> {
  const { bavail, bsize } = await statfs(directory);
  return bavail * bsize;
}

export class DictationModels {
  private readonly root: string;
  private readonly catalog: readonly DictationModelSpec[];
  private readonly transfer: typeof fetch;
  private readonly availableBytes: (directory: string) => Promise<number>;
  private readonly failures = new Map<DictationModelId, DictationDownloadFailure>();
  private readonly verified = new Map<DictationModelId, { fingerprint: string; valid: boolean }>();
  private queue = Promise.resolve();
  private initialized = false;
  private closed = false;
  private job: Download | undefined;

  constructor(
    userData: string,
    private readonly settings: SettingsService,
    options: {
      catalog?: readonly DictationModelSpec[];
      transfer?: typeof fetch;
      availableBytes?: (directory: string) => Promise<number>;
    } = {},
  ) {
    this.root = join(userData, "dictation-models");
    this.catalog = options.catalog ?? dictationCatalog;
    this.transfer = options.transfer ?? fetch;
    this.availableBytes = options.availableBytes ?? diskBytes;
  }

  private directory(id: DictationModelId) {
    return join(this.root, id);
  }

  private temporary(id: DictationModelId, kind: "stage" | "removed") {
    return join(this.root, `.${id}.${kind}`);
  }

  private async initialize() {
    if (!(await modelStat(this.root))) await mkdir(this.root);
    if (!(await modelStat(this.root))?.isDirectory()) throw veraError("DENIED");
    await this.settings.load();
    if (this.initialized) return;
    for (const { id } of this.catalog) {
      await rm(this.temporary(id, "stage"), { recursive: true, force: true });
      const removed = this.temporary(id, "removed");
      if (!(await modelStat(removed))) continue;
      if (!(await modelStat(this.directory(id)))) await this.clearSelection(id);
      await this.cleanRemoved(id);
    }
    this.initialized = true;
  }

  private run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(veraError("DENIED"));
    const result = this.queue.then(async () => {
      await this.initialize();
      return operation();
    });
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async availability(spec: DictationModelSpec, force = false): Promise<Availability> {
    const directory = this.directory(spec.id);
    try {
      if (!(await modelStat(directory))) {
        this.verified.delete(spec.id);
        return "missing";
      }
      const fingerprint = await modelFingerprint(directory, spec);
      if (!fingerprint) {
        this.verified.delete(spec.id);
        return "corrupt";
      }
      const cached = this.verified.get(spec.id);
      if (!force && cached?.fingerprint === fingerprint) return cached.valid ? "installed" : "corrupt";
      const valid =
        (await modelHashesMatch(directory, spec)) &&
        fingerprint === (await modelFingerprint(directory, spec));
      this.verified.set(spec.id, { fingerprint, valid });
      return valid ? "installed" : "corrupt";
    } catch (error) {
      if (!hasFileError(error, "ENOENT", "ENOTDIR", "ELOOP")) throw error;
      this.verified.delete(spec.id);
      return "corrupt";
    }
  }

  private async snapshot(): Promise<DictationSnapshot> {
    const { selectedModel, language } = this.settings.get().settings.dictation ?? dictationDefaults;
    const models = await Promise.all(
      this.catalog.map(async (spec): Promise<DictationModelState> => {
        const job = this.job;
        if (job?.spec.id === spec.id) {
          return {
            id: spec.id,
            bytes: job.bytes,
            status: "downloading",
            receivedBytes: job.receivedBytes,
            ...(job.file ? { fromFile: true as const } : {}),
          };
        }
        const bytes = spec.files.reduce((sum, file) => sum + file.bytes, 0);
        const status = await this.availability(spec);
        if (status !== "installed" && (await modelStat(this.temporary(spec.id, "removed"))))
          return { id: spec.id, bytes, status: "removal-failed" };
        const failure = this.failures.get(spec.id);
        if (failure && status !== "installed")
          return { id: spec.id, bytes, status: "failed", failure, canRemove: status === "corrupt" };
        return { id: spec.id, bytes, status };
      }),
    );
    return {
      models,
      language,
      selectedModel: models.some((model) => model.id === selectedModel && model.status === "installed")
        ? selectedModel
        : null,
    };
  }

  /** Recover abandoned staging and removal directories without loading any model weights. */
  recover(): Promise<void> {
    return this.run(() => undefined);
  }

  get(): Promise<DictationSnapshot> {
    return this.run(() => this.snapshot());
  }

  change(change: DictationChange): Promise<DictationSnapshot> {
    return this.run(async () => {
      if (change.action === "language") {
        await this.settings.update({ dictation: { language: change.language } });
      } else {
        const spec = this.catalog.find(({ id }) => id === change.id);
        if (!spec) throw veraError("INVALID");
        if (change.action === "cancel") {
          const job = this.job;
          if (job?.spec.id === spec.id) {
            if (!job.publishing) job.controller.abort();
            await job.done;
          }
        } else {
          if (this.job) throw veraError("BUSY");
          if (change.action === "select") {
            if ((await this.availability(spec, true)) !== "installed") throw veraError("NOT_FOUND");
            await this.settings.update({ dictation: { selectedModel: spec.id } });
          } else if (change.action === "remove") {
            await this.remove(spec.id);
          } else {
            await this.begin(spec);
          }
        }
      }
      return this.snapshot();
    });
  }

  /** Install a model from a local archive the user picked, with the same checks as a download and no network. */
  installArchive(id: DictationModelId, file: string): Promise<DictationSnapshot> {
    return this.run(async () => {
      const spec = this.catalog.find((item) => item.id === id);
      if (!spec) throw veraError("INVALID");
      if (this.job) throw veraError("BUSY");
      await this.begin(spec, file);
      return this.snapshot();
    });
  }

  resolveSelected(): Promise<LocalDictationModel | null> {
    return this.run(async () => {
      const { selectedModel, language } = this.settings.get().settings.dictation ?? dictationDefaults;
      const spec = this.catalog.find(({ id }) => id === selectedModel);
      if (!spec || this.job?.spec.id === spec.id || (await this.availability(spec, true)) !== "installed")
        return null;
      return { id: spec.id, directory: this.directory(spec.id), dtype: spec.dtype, language };
    });
  }

  /** Start an installation of a model that is not installed; an installed model stays as it is. */
  private async begin(spec: DictationModelSpec, file?: string) {
    if ((await this.availability(spec)) === "installed") return;
    if (await modelStat(this.temporary(spec.id, "removed"))) throw veraError("BUSY");
    await this.clearSelection(spec.id);
    this.start(spec, file);
  }

  private start(spec: DictationModelSpec, file?: string) {
    const job: Download = {
      spec,
      bytes: spec.files.reduce((sum, item) => sum + item.bytes, 0),
      receivedBytes: 0,
      controller: new AbortController(),
      ...(file ? { file } : {}),
      publishing: false,
      done: Promise.resolve(),
    };
    this.failures.delete(spec.id);
    this.job = job;
    job.done = this.install(job);
  }

  private async install(job: Download): Promise<void> {
    const {
      spec,
      controller: { signal },
    } = job;
    const staging = this.temporary(spec.id, "stage");
    try {
      if ((await this.availableBytes(this.root)) < job.bytes) throw new ModelDownloadError("space");
      signal.throwIfAborted();
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging);
      if (job.file) await extractModelArchive(job.file, spec, staging, signal);
      else {
        await mkdir(join(staging, "onnx"));
        for (const file of spec.files) {
          signal.throwIfAborted();
          await downloadModelFile(spec, file, join(staging, file.path), signal, this.transfer, (bytes) => {
            job.receivedBytes += bytes;
          });
        }
      }
      const fingerprint = await modelFingerprint(staging, spec);
      if (
        !fingerprint ||
        !(await modelHashesMatch(staging, spec, signal)) ||
        fingerprint !== (await modelFingerprint(staging, spec))
      ) {
        throw new ModelDownloadError("integrity");
      }
      signal.throwIfAborted();
      job.publishing = true;
      const installed = this.directory(spec.id);
      await rm(installed, { force: true, recursive: true });
      await rename(staging, installed);
      this.verified.delete(spec.id);
    } catch (error) {
      if (!signal.aborted) {
        const failure =
          error instanceof ModelDownloadError
            ? error.failure
            : hasFileError(error, "ENOSPC", "EDQUOT")
              ? "space"
              : "storage";
        this.failures.set(spec.id, failure);
      }
    } finally {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch {
        this.failures.set(spec.id, "storage");
      }
      this.job = undefined;
    }
  }

  private async clearSelection(id: DictationModelId) {
    await this.settings.update(
      { dictation: { selectedModel: null } },
      (current) => current.settings.dictation?.selectedModel === id,
    );
  }

  private async cleanRemoved(id: DictationModelId) {
    const removed = this.temporary(id, "removed");
    if (!(await modelStat(removed))) return true;
    try {
      await rm(removed, { recursive: true, force: true });
      return true;
    } catch {
      // A locked directory stays in the removal state so Settings can retry cleanup.
      return false;
    }
  }

  private async remove(id: DictationModelId) {
    const installed = this.directory(id);
    const removed = this.temporary(id, "removed");
    const moved = !!(await modelStat(installed));
    if (moved) {
      if (!(await this.cleanRemoved(id))) throw veraError("BUSY");
      await rename(installed, removed);
    }
    try {
      await this.clearSelection(id);
    } catch (error) {
      if (moved) await rename(removed, installed);
      throw error;
    }
    await this.cleanRemoved(id);
    this.verified.delete(id);
    this.failures.delete(id);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.job && !this.job.publishing) this.job.controller.abort();
    await this.queue;
    if (this.job && !this.job.publishing) this.job.controller.abort();
    await this.job?.done;
  }
}
