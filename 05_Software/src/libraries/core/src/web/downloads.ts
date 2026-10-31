// REQ-FUNC-b975a8b5, REQ-DATA-fd1933a1, REQ-FUNC-4c3f4f0c, REQ-REL-39e8cc78
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DOWNLOAD_MAX_BYTES,
  downloadFilenameSchema,
  downloadIdSchema,
  type ViewerContent,
  veraError,
  type WebDownload,
  webDownloadSchema,
} from "@vera/shared";
import { createPdfExtractor, type PdfExtractor } from "../knowledge/worker-host.js";
import type { WriteQueue } from "../workbench/write-queue.js";
import { DOWNLOAD_DEADLINE_MS, transferFile } from "./download-transfer.js";
import { publicWebUrl } from "./provider.js";

export interface DownloadTarget {
  readonly downloadId: string;
  readonly name: string;
  readonly path: string;
  readonly sourceUrl: string;
}
export interface DownloadAccess {
  withAccess<T>(
    operation: (signal: AbortSignal, assertCurrent: () => void) => Promise<T>,
    caller: AbortSignal,
  ): Promise<T>;
}
const key = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const manifestName = ".vera-download.json";
/** Public document parsing has a disposable worker, a deadline and a bounded JS heap. */
export function createDownloadPdfExtractor(entry: URL): PdfExtractor {
  return createPdfExtractor(entry, DOWNLOAD_DEADLINE_MS, { maxOldGenerationSizeMb: 256 });
}

/** Provider-neutral workbench data. Neither downloaded bytes nor extracted text enter RAG/model results. */
export class WebDownloads {
  private readonly root: string;
  private readonly lifetime = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  constructor(
    root: string,
    private readonly host: {
      access: DownloadAccess;
      pdf: PdfExtractor;
      transfer?: typeof transferFile;
    },
  ) {
    this.root = realpathSync(root);
  }

  allocate(url: string, filename?: string): DownloadTarget {
    const sourceUrl = publicWebUrl(url);
    let candidate = "download.bin";
    try {
      const basename = decodeURIComponent(new URL(sourceUrl).pathname.split("/").at(-1) ?? "");
      if (downloadFilenameSchema.safeParse(basename).success) candidate = basename;
    } catch {
      /* An unusable URL basename uses the ordinary managed default. */
    }
    const name = downloadFilenameSchema.parse(filename ?? candidate);
    const downloadId = randomUUID();
    return Object.freeze({ downloadId, name, sourceUrl, path: `.vera/downloads/${downloadId}/${name}` });
  }

  save(
    target: DownloadTarget,
    context: {
      sessionId: string;
      callId: string;
      now(): string;
      queue: WriteQueue;
      assertWritable(): void;
    },
    caller: AbortSignal,
  ): Promise<WebDownload> {
    return this.track(
      async (lifetime) =>
        this.host.access.withAccess(async (access, assertCurrent) => {
          const signal = AbortSignal.any([lifetime, access, AbortSignal.timeout(DOWNLOAD_DEADLINE_MS)]);
          signal.throwIfAborted();
          assertCurrent();
          context.assertWritable();
          const { data, finalUrl, mime } = await (this.host.transfer ?? transferFile)(
            target.sourceUrl,
            signal,
          );
          signal.throwIfAborted();
          assertCurrent();
          context.assertWritable();
          if (data.length > DOWNLOAD_MAX_BYTES) throw Error("Download exceeds the size limit.");
          const pdfSignature = data.subarray(0, 1024).includes(Buffer.from("%PDF-"));
          const isPdf = mime === "application/pdf" || /\.pdf$/i.test(target.name) || pdfSignature;
          if (isPdf && !pdfSignature) throw Error("The response is not a supported PDF document.");
          const parsed = isPdf ? await this.host.pdf(data, signal) : undefined;
          signal.throwIfAborted();
          if (parsed && !parsed.pages.length) throw Error("The PDF contains no pages.");
          const record = webDownloadSchema.parse({
            ...target,
            sourceUrl: publicWebUrl(target.sourceUrl),
            finalUrl: publicWebUrl(finalUrl),
            sessionId: context.sessionId,
            callId: context.callId,
            mime: isPdf ? "application/pdf" : mime,
            bytes: data.length,
            sha256: hash(data),
            createdAt: context.now(),
            ...(parsed ? { pages: parsed.pages.length } : {}),
          });
          return context.queue.run(async () => {
            signal.throwIfAborted();
            assertCurrent();
            context.assertWritable();
            const parent = await this.directory(true);
            const staging = join(parent, `.pending-${target.downloadId}`);
            const final = join(parent, target.downloadId);
            let created = false,
              renamed = false,
              published = false;
            try {
              await mkdir(staging, { mode: 0o700 });
              created = true;
              await this.ordinaryDirectory(staging);
              for (const [name, bytes] of [
                [target.name, data],
                [manifestName, Buffer.from(JSON.stringify(record))],
              ] as const) {
                signal.throwIfAborted();
                assertCurrent();
                context.assertWritable();
                await this.directory();
                await this.ordinaryDirectory(staging);
                const file = await open(join(staging, name), "wx", 0o600);
                try {
                  await file.writeFile(bytes, { signal });
                  await file.sync();
                } finally {
                  await file.close();
                }
              }
              await this.directory();
              await this.ordinaryDirectory(staging);
              signal.throwIfAborted();
              assertCurrent();
              context.assertWritable();
              try {
                await lstat(final);
                throw veraError("CONFLICT");
              } catch (error) {
                if (!missing(error)) throw error;
              }
              signal.throwIfAborted();
              assertCurrent();
              context.assertWritable();
              await rename(staging, final);
              renamed = true;
              signal.throwIfAborted();
              assertCurrent();
              context.assertWritable();
              published = true;
              return record;
            } finally {
              if (created && !published) {
                const unpublished = renamed ? final : staging;
                await this.cleanup(unpublished, target.name);
              }
            }
          });
        }, lifetime),
      caller,
    );
  }

  list(caller: AbortSignal = new AbortController().signal): Promise<WebDownload[]> {
    return this.track(async (signal) => {
      let parent: string;
      try {
        parent = await this.directory();
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
      const records: WebDownload[] = [];
      for (const name of await readdir(parent)) {
        signal.throwIfAborted();
        if (!downloadIdSchema.safeParse(name).success) continue;
        try {
          records.push(await this.record(name, signal));
        } catch {
          /* Invalid/unfinished entries are not advertised. */
        }
      }
      signal.throwIfAborted();
      return records.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || a.downloadId.localeCompare(b.downloadId),
      );
    }, caller);
  }

  open(
    downloadId: string,
    caller: AbortSignal = new AbortController().signal,
  ): Promise<ViewerContent & { kind: "pdf" }> {
    return this.track(async (signal) => {
      const record = await this.record(downloadId, signal);
      if (record.mime !== "application/pdf") throw veraError("INVALID");
      const directory = join(await this.directory(), record.downloadId);
      await this.ordinaryDirectory(directory);
      const data = await this.read(join(directory, record.name), DOWNLOAD_MAX_BYTES, signal);
      if (data.length !== record.bytes || hash(data) !== record.sha256) throw veraError("CONFLICT");
      const extracted = await this.host.pdf(data, signal);
      signal.throwIfAborted();
      await this.directory();
      await this.ordinaryDirectory(directory);
      if (extracted.pages.length !== record.pages) throw veraError("CONFLICT");
      return {
        kind: "pdf",
        path: record.path,
        ref: null,
        snippet: "",
        data: data.toString("base64"),
        pages: extracted.pages,
        page: 1,
        pageEnd: 1,
      };
    }, caller);
  }

  async close() {
    this.lifetime.abort();
    await Promise.allSettled(this.pending);
  }
  private track<T>(operation: (signal: AbortSignal) => Promise<T>, caller: AbortSignal): Promise<T> {
    const signal = AbortSignal.any([caller, this.lifetime.signal]);
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation(signal);
    });
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
    return pending;
  }
  private async cleanup(directory: string, name: string): Promise<void> {
    // Only our two exact files in an ordinary, unpublished managed directory are eligible.
    try {
      await this.directory();
      await this.ordinaryDirectory(directory);
      for (const file of [name, manifestName]) {
        try {
          await unlink(join(directory, file));
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      await rmdir(directory);
    } catch {
      /* Never follow a substituted filesystem path for cleanup. */
    }
  }
  private async ordinaryDirectory(path: string) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || key(await realpath(path)) !== key(path))
      throw veraError("DENIED");
  }
  private async directory(create = false) {
    await this.ordinaryDirectory(this.root);
    let path = this.root;
    for (const segment of [".vera", "downloads"]) {
      path = join(path, segment);
      if (create && segment === "downloads") {
        try {
          await mkdir(path, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      await this.ordinaryDirectory(path);
    }
    return path;
  }
  private async record(downloadId: string, signal: AbortSignal): Promise<WebDownload> {
    if (!downloadIdSchema.safeParse(downloadId).success) throw veraError("INVALID");
    let path: string;
    try {
      path = join(await this.directory(), downloadId);
      await this.ordinaryDirectory(path);
    } catch (error) {
      if (missing(error)) throw veraError("NOT_FOUND");
      throw error;
    }
    const text = (await this.read(join(path, manifestName), 16_384, signal)).toString("utf8");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw veraError("INVALID");
    }
    const parsed = webDownloadSchema.safeParse(json);
    if (!parsed.success) throw veraError("INVALID");
    const record = parsed.data;
    try {
      if (
        record.downloadId !== downloadId ||
        publicWebUrl(record.sourceUrl) !== record.sourceUrl ||
        publicWebUrl(record.finalUrl) !== record.finalUrl
      )
        throw Error();
    } catch {
      throw veraError("INVALID");
    }
    return record;
  }
  private async read(path: string, limit: number, signal: AbortSignal): Promise<Buffer> {
    try {
      return await this.readOrdinary(path, limit, signal);
    } catch (error) {
      if (missing(error)) throw veraError("NOT_FOUND");
      throw error;
    }
  }
  private async readOrdinary(path: string, limit: number, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    await this.directory();
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size > limit ||
      key(await realpath(path)) !== key(path)
    )
      throw veraError("DENIED");
    const file = await open(path, "r");
    try {
      const opened = await file.stat();
      if (
        opened.ino !== before.ino ||
        opened.dev !== before.dev ||
        opened.size !== before.size ||
        opened.nlink !== 1
      )
        throw veraError("CONFLICT");
      const data = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < data.length) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(data, offset, Math.min(262_144, data.length - offset), offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await file.stat();
      const current = await lstat(path);
      await this.directory();
      if (
        offset !== data.length ||
        after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs ||
        current.ino !== opened.ino ||
        current.dev !== opened.dev ||
        current.isSymbolicLink() ||
        key(await realpath(path)) !== key(path)
      )
        throw veraError("CONFLICT");
      return data;
    } finally {
      await file.close();
    }
  }
}
