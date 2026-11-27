import { createHash, randomUUID } from "node:crypto";
import { constants, realpathSync, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  ARTIFACT_MAX_BYTES,
  type ArtifactContent,
  type ArtifactSummary,
  artifactIdSchema,
  artifactSummarySchema,
  formatArtifactRef,
  type SessionEvent,
  sessionIdSchema,
  validArtifactName,
  veraError,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { ulid } from "ulid";
import { type ArtifactRow, ArtifactsRepository } from "../storage/repos/artifacts.js";
import { WriteQueue } from "../workbench/write-queue.js";

export interface ArtifactHost {
  sessionId: string;
  issuedCitationRefs?: () => ReadonlySet<string>;
  store: ArtifactStore;
  queue: WriteQueue;
  now(): string;
  assertWritable(): void;
  record(event: SessionEvent): () => void;
  scrub?(text: string): string;
  scrubContent?(text: string): string;
}

/** An exact structured artifact cannot survive the active export mask. */
export class ArtifactMaskingConflict extends Error {
  constructor() {
    super("Artifact masking changed the content. Retry the save with the current export settings.");
  }
}
const key = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const maxDescriptionCharacters = 1024;

function shortenDescription(text: string): string {
  if (text.length <= maxDescriptionCharacters) return text;
  let characters = 0;
  let end = 0;
  for (const character of text) {
    characters += 1;
    if (characters === maxDescriptionCharacters)
      return end + character.length === text.length ? text : `${text.slice(0, end)}…`;
    end += character.length;
  }
  return text;
}

/**
 * Rename over the stored file. On Windows another program that has the artifact open (a spreadsheet, a
 * preview, a scanner) refuses the rename: a scanner lets go within moments, so the rename is tried again
 * briefly, and a file that stays open is named as the cause instead of the system's message and paths.
 */
export async function replaceFile(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      if (attempt === 2)
        throw Error("The artifact is open in another program. Close it there and save again.");
      await delay(100 * (attempt + 1));
    }
  }
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function sameFile(first: Stats, current: Stats): boolean {
  return (
    current.isFile() &&
    current.nlink === 1 &&
    current.ino === first.ino &&
    current.dev === first.dev &&
    current.size === first.size &&
    current.mtimeMs === first.mtimeMs &&
    current.ctimeMs === first.ctimeMs
  );
}

/** Narrow application-managed namespace. General file tools keep their .vera denial. */
export class ArtifactStore {
  readonly repository: ArtifactsRepository;
  private readonly root: string;
  private readonly access = new Map<string, { queue: WriteQueue; pending: number }>();
  constructor(
    root: string,
    private readonly db: Database.Database,
  ) {
    this.root = realpathSync(root);
    this.repository = new ArtifactsRepository(db);
  }
  private async directory(sessionId: string, create = false): Promise<string> {
    if (!sessionIdSchema.safeParse(sessionId).success) throw veraError("INVALID");
    if (key(await realpath(this.root)) !== key(this.root)) throw veraError("DENIED");
    let directory = this.root;
    for (const segment of [".vera", "artifacts", sessionId]) {
      directory = join(directory, segment);
      if (create && segment !== ".vera") {
        try {
          await mkdir(directory, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || key(await realpath(directory)) !== key(directory))
        throw veraError("DENIED");
    }
    return directory;
  }
  private async path(sessionId: string, name: string, create = false): Promise<string> {
    if (!validArtifactName(name)) throw veraError("INVALID");
    return join(await this.directory(sessionId, create), name);
  }
  private async read(path: string, signal?: AbortSignal): Promise<{ bytes: Buffer; stat: Stats }> {
    signal?.throwIfAborted();
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      key(await realpath(path)) !== key(path)
    )
      throw veraError("DENIED");
    if (before.size > ARTIFACT_MAX_BYTES) throw veraError("INVALID");
    const file = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const opened = await file.stat();
      if (!sameFile(before, opened)) throw veraError("CONFLICT");
      const bytes = Buffer.alloc(before.size + 1);
      let at = 0;
      while (at < bytes.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(bytes, at, bytes.length - at, at);
        if (!bytesRead) break;
        at += bytesRead;
      }
      const after = await file.stat();
      const current = await lstat(path);
      signal?.throwIfAborted();
      if (at !== before.size || !sameFile(before, after) || !sameFile(before, current))
        throw veraError("CONFLICT");
      return { bytes: bytes.subarray(0, at), stat: current };
    } finally {
      await file.close();
    }
  }
  private summary(row: ArtifactRow): ArtifactSummary {
    return artifactSummarySchema.parse({
      artifactId: row.id,
      sessionId: row.session_id,
      name: row.name,
      mime: row.mime,
      bytes: row.bytes,
      sha256: row.sha256,
      description: row.description,
      createdAt: row.created_at,
    });
  }
  list(sessionId: string): ArtifactSummary[] {
    return this.repository.list(sessionId).map((row) => this.summary(row));
  }
  private row(id: string): ArtifactRow {
    if (!artifactIdSchema.safeParse(id).success) throw veraError("INVALID");
    const row = this.repository.get(id);
    if (!row) throw veraError("NOT_FOUND");
    this.summary(row);
    return row;
  }
  /** Readers of an artifact share the rename/metadata boundary, including rollback. */
  private async withArtifact<T>(id: string, run: () => Promise<T>): Promise<T> {
    const access = this.access.get(id) ?? { queue: new WriteQueue(), pending: 0 };
    this.access.set(id, access);
    access.pending++;
    try {
      return await access.queue.run(run);
    } finally {
      if (--access.pending === 0) this.access.delete(id);
    }
  }

  verified(id: string, signal?: AbortSignal): Promise<{ artifact: ArtifactContent; path: string }> {
    return this.withArtifact(id, async () => {
      signal?.throwIfAborted();
      const row = this.row(id);
      try {
        const path = await this.path(row.session_id, row.name);
        const { bytes } = await this.read(path, signal);
        await this.directory(row.session_id);
        signal?.throwIfAborted();
        const content = bytes.toString("utf8");
        if (
          bytes.length !== row.bytes ||
          hash(bytes) !== row.sha256 ||
          !Buffer.from(content, "utf8").equals(bytes)
        )
          throw veraError("CONFLICT");
        return { path, artifact: { ...this.summary(row), content } };
      } catch (error) {
        if (missing(error)) throw veraError("NOT_FOUND");
        throw error;
      }
    });
  }
  async openNamed(sessionId: string, name: string, signal?: AbortSignal): Promise<ArtifactContent> {
    const row = this.repository.named(sessionId, name);
    if (!row) throw veraError("NOT_FOUND");
    return (await this.verified(row.id, signal)).artifact;
  }

  async exists(sessionId: string, name: string): Promise<boolean> {
    try {
      await this.openNamed(sessionId, name);
      return true;
    } catch {
      return false;
    }
  }
  async save(
    host: ArtifactHost,
    args: { name: string; content: string; description?: string; overwrite?: boolean },
    signal: AbortSignal,
    options: { authorize?: () => Promise<unknown>; exactContent?: boolean } = {},
  ) {
    if (!validArtifactName(args.name))
      throw Error(
        "Invalid artifact name. Use a portable file name of 1–100 ASCII letters, digits, dot, underscore or hyphen.",
      );
    if (Buffer.byteLength(args.content, "utf8") > ARTIFACT_MAX_BYTES)
      throw Error("Artifact content exceeds the 5 MiB UTF8 limit.");
    if (host.scrub && host.scrub(args.name) !== args.name)
      throw Error("Artifact name contains protected credential data.");
    return host.queue.run(async () => {
      signal.throwIfAborted();
      host.assertWritable();
      if (options.authorize) {
        await options.authorize();
        signal.throwIfAborted();
        host.assertWritable();
      }
      // A name that differs only in letter case names the artifact that exists: one file on Windows and
      // macOS, and the same artifact everywhere.
      const old = this.repository.aliased(host.sessionId, args.name);
      const name = old?.name ?? args.name;
      const path = await this.path(host.sessionId, name, true);
      let previous: Awaited<ReturnType<ArtifactStore["read"]>> | undefined;
      try {
        previous = await this.read(path, signal);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (previous && !old)
        throw Error("Artifact storage contains an untracked file of that name. Choose another name.");
      const project = (text: string) => host.scrubContent?.(text) ?? host.scrub?.(text) ?? text;
      const projectedDescription = () =>
        args.description === undefined ? null : shortenDescription(project(args.description));
      const assertName = () => {
        if (host.scrub && host.scrub(args.name) !== args.name)
          throw Error("Artifact name contains protected credential data.");
      };
      assertName();
      signal.throwIfAborted();
      const content = project(args.content);
      const description = projectedDescription();
      if (options.exactContent && content !== args.content) throw new ArtifactMaskingConflict();
      const bytes = Buffer.from(content, "utf8");
      if (bytes.length > ARTIFACT_MAX_BYTES) throw Error("Artifact content exceeds the 5 MiB UTF8 limit.");
      const sha256 = hash(bytes);
      const mime = /\.(md|markdown)$/i.test(name) ? "text/markdown" : "text/plain";
      const result = { ref: formatArtifactRef(name), bytes: bytes.length };
      if (
        old?.sha256 === sha256 &&
        old.bytes === bytes.length &&
        old.description === description &&
        old.mime === mime &&
        previous?.bytes.equals(bytes)
      ) {
        // Nothing to replace: saving what is already stored succeeds, with or without overwrite.
        host.assertWritable();
        return result;
      }
      if (old && !args.overwrite)
        throw Error(`Artifact ${name} already exists. Set overwrite:true to replace it.`);
      const row: ArtifactRow = {
        id: old?.id ?? `art_${ulid()}`,
        session_id: host.sessionId,
        name,
        mime,
        bytes: bytes.length,
        sha256,
        description,
        created_at: host.now(),
      };
      const temporary = join(await this.directory(host.sessionId), `.save-${randomUUID()}.tmp`);
      let ownsTemporary = false;
      const stage = async (data: Buffer, pending?: AbortSignal) => {
        pending?.throwIfAborted();
        const file = await open(temporary, "wx", 0o600);
        ownsTemporary = true;
        try {
          await file.writeFile(data, pending ? { signal: pending } : {});
          pending?.throwIfAborted();
          await file.sync();
        } finally {
          await file.close();
        }
      };
      try {
        await stage(bytes, signal);
        return await this.withArtifact(row.id, async () => {
          signal.throwIfAborted();
          await this.directory(host.sessionId);
          const current = await lstat(path).catch((error: unknown) => {
            if (missing(error)) return undefined;
            throw error;
          });
          if (previous ? !current || !sameFile(previous.stat, current) : current) throw veraError("CONFLICT");
          signal.throwIfAborted();
          host.assertWritable();
          await replaceFile(temporary, path);
          ownsTemporary = false;

          let publish: () => void;
          try {
            signal.throwIfAborted();
            assertName();
            if (project(args.content) !== content || projectedDescription() !== description)
              throw new ArtifactMaskingConflict();
            publish = this.db.transaction(() => {
              host.assertWritable();
              this.repository.save(row);
              return host.record({
                type: "artifact.saved",
                artifactId: row.id,
                name: row.name,
                bytes: row.bytes,
              });
            })();
          } catch (error) {
            host.assertWritable();
            await this.directory(host.sessionId);
            if (previous) {
              await stage(previous.bytes);
              await this.directory(host.sessionId);
              host.assertWritable();
              await replaceFile(temporary, path);
              ownsTemporary = false;
            } else await rm(path, { force: true });
            throw error;
          }
          publish();
          return result;
        });
      } finally {
        if (ownsTemporary) {
          await this.directory(host.sessionId);
          await rm(temporary, { force: true });
        }
      }
    });
  }
  async removeSession(id: string): Promise<void> {
    try {
      const directory = await this.directory(id);
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}
