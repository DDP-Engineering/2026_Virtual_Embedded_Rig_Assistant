import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
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
import type { WriteQueue } from "../workbench/write-queue.js";

export interface ArtifactHost {
  sessionId: string;
  store: ArtifactStore;
  queue: WriteQueue;
  now(): string;
  assertWritable(): void;
  record(event: SessionEvent): () => void;
  scrub?(text: string): string;
}
const key = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Narrow application-managed namespace. General file tools keep their .vera denial. */
export class ArtifactStore {
  readonly repository: ArtifactsRepository;
  private readonly root: string;
  constructor(
    root: string,
    private readonly db: Database.Database,
  ) {
    this.root = realpathSync(root);
    this.repository = new ArtifactsRepository(db);
  }
  private directory(sessionId: string, create = false): string {
    if (!sessionIdSchema.safeParse(sessionId).success) throw veraError("INVALID");
    if (key(realpathSync(this.root)) !== key(this.root)) throw veraError("DENIED");
    let directory = this.root;
    for (const segment of [".vera", "artifacts", sessionId]) {
      directory = join(directory, segment);
      if (create && segment !== ".vera") {
        try {
          mkdirSync(directory, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || key(realpathSync(directory)) !== key(directory))
        throw veraError("DENIED");
    }
    return directory;
  }
  private path(sessionId: string, name: string, create = false): string {
    if (!validArtifactName(name)) throw veraError("INVALID");
    return join(this.directory(sessionId, create), name);
  }
  private read(path: string): Buffer {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      key(realpathSync(path)) !== key(path)
    )
      throw veraError("DENIED");
    if (before.size > ARTIFACT_MAX_BYTES) throw veraError("INVALID");
    const fd = openSync(path, "r");
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev)
        throw veraError("CONFLICT");
      const bytes = Buffer.alloc(before.size + 1);
      let at = 0;
      while (at < bytes.length) {
        const n = readSync(fd, bytes, at, bytes.length - at, at);
        if (!n) break;
        at += n;
      }
      const after = fstatSync(fd),
        current = lstatSync(path);
      if (
        at !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        current.isSymbolicLink() ||
        current.nlink !== 1
      )
        throw veraError("CONFLICT");
      return bytes.subarray(0, at);
    } finally {
      closeSync(fd);
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
  verified(id: string): { artifact: ArtifactContent; path: string } {
    const row = this.row(id);
    try {
      const path = this.path(row.session_id, row.name),
        bytes = this.read(path);
      this.directory(row.session_id);
      if (
        bytes.length !== row.bytes ||
        hash(bytes) !== row.sha256 ||
        !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)
      )
        throw veraError("CONFLICT");
      return { path, artifact: { ...this.summary(row), content: bytes.toString("utf8") } };
    } catch (error) {
      if (missing(error)) throw veraError("NOT_FOUND");
      throw error;
    }
  }
  exists(sessionId: string, name: string): boolean {
    const row = this.repository.named(sessionId, name);
    if (!row) return false;
    try {
      this.verified(row.id);
      return true;
    } catch {
      return false;
    }
  }
  async save(
    host: ArtifactHost,
    args: { name: string; content: string; description?: string; overwrite?: boolean },
    signal: AbortSignal,
  ) {
    if (!validArtifactName(args.name))
      throw Error(
        "Invalid artifact name. Use a portable file name of1–100 ASCII letters, digits, dot, underscore or hyphen.",
      );
    const bytes = Buffer.from(args.content, "utf8");
    if (bytes.length > ARTIFACT_MAX_BYTES) throw Error("Artifact content exceeds the5MiB UTF8 limit.");
    if (host.scrub && host.scrub(JSON.stringify(args)) !== JSON.stringify(args))
      throw Error("Artifact content contains protected credential data.");
    return host.queue.run(async () => {
      signal.throwIfAborted();
      host.assertWritable();
      const path = this.path(host.sessionId, args.name, true);
      const old = this.repository.named(host.sessionId, args.name);
      let previous: Buffer | undefined;
      try {
        previous = this.read(path);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if ((old || previous) && !args.overwrite)
        throw Error("Artifact name already exists. Set overwrite:true to replace it.");
      if (previous && !old)
        throw Error("Artifact storage contains an untracked file or name alias. Choose another name.");
      const row: ArtifactRow = {
        id: old?.id ?? `art_${ulid()}`,
        session_id: host.sessionId,
        name: args.name,
        mime: /\.(md|markdown)$/i.test(args.name) ? "text/markdown" : "text/plain",
        bytes: bytes.length,
        sha256: hash(bytes),
        description: args.description ?? null,
        created_at: host.now(),
      };
      const temporary = join(this.directory(host.sessionId), `.save-${randomUUID()}.tmp`);
      let renamed = false,
        committed = false;
      try {
        const fd = openSync(temporary, "wx", 0o600);
        try {
          writeFileSync(fd, bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        this.directory(host.sessionId);
        signal.throwIfAborted();
        host.assertWritable();
        renameSync(temporary, path);
        renamed = true;
        const publish = this.db.transaction(() => {
          host.assertWritable();
          this.repository.save(row);
          return host.record({
            type: "artifact.saved",
            artifactId: row.id,
            name: row.name,
            bytes: row.bytes,
          });
        })();
        committed = true;
        publish();
        return { ref: formatArtifactRef(row.name), bytes: row.bytes };
      } catch (error) {
        if (renamed && !committed) {
          host.assertWritable();
          this.directory(host.sessionId);
          if (previous) {
            const fd = openSync(temporary, "wx", 0o600);
            try {
              writeFileSync(fd, previous);
              fsyncSync(fd);
            } finally {
              closeSync(fd);
            }
            this.directory(host.sessionId);
            renameSync(temporary, path);
          } else rmSync(path, { force: true });
        }
        throw error;
      } finally {
        this.directory(host.sessionId);
        rmSync(temporary, { force: true });
      }
    });
  }
  removeSession(id: string): void {
    try {
      const directory = this.directory(id);
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}
