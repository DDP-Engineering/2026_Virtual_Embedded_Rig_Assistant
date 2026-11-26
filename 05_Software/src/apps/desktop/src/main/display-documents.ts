import { extname, posix } from "node:path";
import { rasterThumbnail, scrub, validateRelativePath, type WorkbenchService } from "@vera/core";
import {
  DOCS_BYTE_WINDOW_LIMIT,
  type DocumentRecord,
  formatRef,
  GIT_DIFF_PATCH_LIMIT,
  GIT_HISTORY_AUTHOR_LIMIT,
  GIT_HISTORY_SUBJECT_LIMIT,
  type GitDiffResult,
  type GitHistoryResult,
  type GitStatus,
  MAX_MESSAGE_IMAGE_BYTES,
  parseRef,
  type Response,
  rasterSignature,
  type ViewerContent,
  veraError,
  veraErrorSchema,
  viewerExtensionKind,
  type WorkbenchConfig,
} from "@vera/shared";
import { maskByteWindow } from "./display-bytes.js";
import type { DisplayIdentities } from "./display-identities.js";
import { publicDocument, publicDocumentHit, publicViewer } from "./document-viewer.js";
import { publicGuard } from "./events.js";

const imageAliasPrefix = "__vera_image_alias_";
const imageReadPath = (path: string) => posix.normalize(path).replace(/\/$/, "");

function originalRef(ref: string): string {
  if (ref.length > 8192) throw veraError("INVALID");
  return ref;
}

/** Workbench-owned identities keep presentation out of host path authority. */
export class DisplayDocuments {
  private generation = 0;
  private owner = "";
  constructor(
    /** The workbench the window shows; Desktop keeps other workbenches open in the background. */
    private workbench: () => WorkbenchService,
    private maskingFor: (config: WorkbenchConfig, area: "display") => boolean,
    private redact: (text: string) => string,
    private identities: DisplayIdentities,
    private secrets: () => readonly string[],
  ) {}
  close() {
    this.generation++;
    this.owner = "";
  }
  /** A workbench closed: its identities end, while a background workbench closing leaves the shown one's. */
  closed(id: string) {
    if (!this.owner || this.owner.startsWith(`${id}\n`)) this.close();
  }
  private current(id: string) {
    const snapshot = this.workbench().getSnapshot();
    if (snapshot.config.id !== id) throw veraError("CONFLICT");
    const owner = `${id}\n${snapshot.folder}`;
    if (owner !== this.owner) {
      this.close();
      this.owner = owner;
    }
    return snapshot;
  }
  scrub(id: string, text: string): string {
    return this.maskingFor(this.current(id).config, "display") ? this.redact(text) : text;
  }
  path(id: string, path: string): string {
    this.current(id);
    return this.identities.encode(this.owner, path, (value) => this.redact(value) !== value);
  }
  /** Projects Git labels with the same identities that ordinary Files rows use. */
  gitStatus(id: string, status: GitStatus): GitStatus {
    if (status.state !== "ready") return status;
    const masked = this.maskingFor(this.current(id).config, "display");
    const identity = (path: string) =>
      this.identities.encode(this.owner, path, (value) => this.redact(value) !== value);
    const label = (value: string) => (masked ? this.redact(value) : value);
    return {
      ...status,
      branch: { ...status.branch, name: label(status.branch.name) },
      entries: status.entries.map(({ path, rename, ...entry }) => ({
        ...entry,
        path: identity(path),
        displayPath: label(path),
        ...(rename ? { rename: { ...rename, path: identity(rename.path) } } : {}),
      })),
    };
  }

  /** Applies the current Display policy to path labels and literal patch text. */
  gitDiff(
    id: string,
    path: string,
    value: GitDiffResult,
  ): Pick<Response<"git.diff">, "displayPath" | "result"> {
    const masked = this.maskingFor(this.current(id).config, "display");
    const label = (original: string) => {
      const text = masked ? this.redact(original) : original;
      return text.length > 8192 ? "[REDACTED]" : text;
    };
    const rename = value.rename && { from: label(value.rename.from), to: label(value.rename.to) };
    let result: GitDiffResult = { ...value, ...(rename ? { rename } : {}) };
    if (masked && value.state === "patch") {
      // A patch adds prefixes to each line, breaking any multiline credential into fragments.
      const fragments = this.secrets()
        .filter((secret) => secret.includes("\n"))
        .flatMap((secret) => secret.split(/\r?\n/));
      const patch = scrub(this.redact(value.patch), fragments);
      result =
        Buffer.byteLength(patch) > GIT_DIFF_PATCH_LIMIT
          ? { state: "too-large", base: value.base, ...(rename ? { rename } : {}) }
          : { ...value, patch, ...(rename ? { rename } : {}) };
    }
    return { displayPath: label(path), result };
  }

  /** Applies the live Display policy before shortening Git commit metadata. */
  gitHistory(
    id: string,
    path: string,
    result: GitHistoryResult,
  ): Pick<Response<"git.history">, "displayPath" | "result"> {
    const masked = this.maskingFor(this.current(id).config, "display");
    const fragments = masked
      ? this.secrets()
          .filter((secret) => secret.includes("\n"))
          .flatMap((secret) => secret.split(/\r?\n/))
      : [];
    const redact = (value: string) => (masked ? scrub(this.redact(value), fragments) : value);
    const label = redact(path);
    const shorten = (value: string, limit: number) => {
      const text = redact(value)
        .replace(/\p{Cc}/gu, " ")
        .trim();
      if (text.length <= limit) return text;
      return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
    };
    return {
      displayPath: label.length > 8192 ? "[REDACTED]" : label,
      result:
        result.state === "ready"
          ? {
              ...result,
              commits: result.commits.map((commit) => ({
                ...commit,
                author: shorten(commit.author, GIT_HISTORY_AUTHOR_LIMIT),
                subject: shorten(commit.subject, GIT_HISTORY_SUBJECT_LIMIT),
              })),
            }
          : result,
    };
  }

  resolve(id: string, path: string): string {
    this.current(id);
    const original = this.identities.decode(this.owner, path);
    if (original.length > 4096) throw veraError("INVALID");
    return original;
  }
  /**
   * The identity of a session message's image, for the workbench that holds the session: a background
   * workbench's identities resolve only once it is shown again. Alias tokens preserve the saved spelling
   * even when it contains dot or empty segments.
   */
  sessionImagePath(owner: { config: { id: string }; folder: string }, path: string): string {
    const key = `${owner.config.id}\n${owner.folder}`;
    if (imageReadPath(path) === path)
      return this.identities.encode(key, path, (value) => this.redact(value) !== value);
    const payload = Buffer.from(path, "utf8").toString("base64url");
    return this.identities
      .encode(`${key}\nimage-alias`, payload)
      .replace(/^__vera_display_/, imageAliasPrefix);
  }
  resolveSessionImagePath(id: string, path: string): string {
    if (!path.startsWith(imageAliasPrefix) || !path.endsWith(".")) return this.resolve(id, path);
    this.current(id);
    const payload = this.identities.decode(
      `${this.owner}\nimage-alias`,
      path.replace(imageAliasPrefix, "__vera_display_"),
    );
    const original = Buffer.from(payload, "base64url").toString("utf8");
    if (
      !original ||
      original.length > 4096 ||
      Buffer.from(original, "utf8").toString("base64url") !== payload
    )
      throw veraError("INVALID");
    return original;
  }
  ref(id: string, ref: string): string {
    this.current(id);
    originalRef(ref);
    const parsed = parseRef(ref);
    if (!parsed || !("path" in parsed)) return this.scrub(id, ref);
    const path = this.path(id, parsed.path);
    const token = this.identities
      .encode(`${this.owner}\nreference:${parsed.path}`, Buffer.from(ref, "utf8").toString("base64url"))
      .replace(/^__vera_display_/, "__vera_reference_");
    return formatRef({ kind: "lines", path: `${path}/${token}`, start: 1, end: 1 });
  }
  resolveRef(id: string, ref: string): string {
    this.current(id);
    const parsed = parseRef(ref);
    if (!parsed || !("path" in parsed)) return originalRef(ref);
    const opaque = /^(.*)\/(__vera_reference_[A-Za-z0-9_-]+\.)$/.exec(parsed.path);
    if (!opaque) return originalRef(formatRef({ ...parsed, path: this.resolve(id, parsed.path) }));
    if (parsed.kind !== "lines" || parsed.start !== 1 || parsed.end !== 1) throw veraError("NOT_FOUND");
    const path = this.resolve(id, opaque[1] as string);
    const token = (opaque[2] as string).replace(/^__vera_reference_/, "__vera_display_");
    const payload = this.identities.decode(`${this.owner}\nreference:${path}`, token);
    const original = Buffer.from(payload, "base64url").toString("utf8");
    const source = parseRef(original);
    if (
      Buffer.from(original, "utf8").toString("base64url") !== payload ||
      !source ||
      !("path" in source) ||
      source.path !== path ||
      original.length > 8192
    )
      throw veraError("NOT_FOUND");
    return original;
  }
  document(id: string, document: DocumentRecord) {
    return publicDocument(
      document,
      (text) => this.scrub(id, text),
      (path) => this.path(id, path),
    );
  }
  viewer(id: string, content: ViewerContent): ViewerContent {
    const shown = publicViewer(content, (text) => this.scrub(id, text));
    return {
      ...shown,
      path: this.path(id, content.path),
      displayPath: this.scrub(id, content.path),
      ref: content.ref === null ? null : this.ref(id, content.ref),
      ...(content.kind === "text" && content.byteSource
        ? {
            byteSource: {
              ...content.byteSource,
              revision: this.identities.encode(
                `${this.owner}\nbyte-source:${content.path}`,
                `${content.byteSource.revision}\n${content.byteSource.encoding ?? "utf-8"}`,
              ),
            },
          }
        : {}),
    } as ViewerContent;
  }
  private async run<T>(id: string, read: () => Promise<T>) {
    this.current(id);
    const generation = this.generation;
    const value = await read();
    this.current(id);
    if (generation !== this.generation) throw veraError("CONFLICT");
    return value;
  }
  async list(id: string) {
    const documents = await this.run(id, () => this.workbench().listDocuments(id));
    return { workbenchId: id, documents: documents.map((doc) => this.document(id, doc)) };
  }
  async tree(id: string, path: string) {
    const listed = await this.run(id, () => this.workbench().listFolder(id, this.resolve(id, path)));
    return {
      workbenchId: id,
      path: this.path(id, this.resolve(id, path)),
      entries: listed.entries.map((entry) => ({
        ...entry,
        name: this.scrub(id, entry.name),
        path: this.path(id, entry.path),
        displayPath: this.scrub(id, entry.path),
      })),
      truncated: listed.truncated,
    };
  }
  async find(id: string, query: string) {
    const found = await this.run(id, () => this.workbench().findFiles(id, query));
    const paths = found.paths.map((path) => this.path(id, path));
    const labels: Record<string, string> = {};
    found.paths.forEach((path, i) => {
      const identity = paths[i] as string;
      const original = path.split("/");
      const parts = identity.split("/");
      for (let n = 1; n <= parts.length; n++)
        labels[parts.slice(0, n).join("/")] = this.scrub(id, original.slice(0, n).join("/"));
    });
    return { workbenchId: id, paths, labels, truncated: found.truncated };
  }
  async read(id: string, path: string, requestId?: string) {
    const original = this.resolve(id, path);
    const content = await this.run(id, () => this.workbench().readText(id, original));
    if (content.path !== original) throw veraError("NOT_FOUND");
    return {
      workbenchId: id,
      ...(requestId === undefined ? {} : { requestId }),
      content: this.viewer(id, content),
    };
  }
  async stat(id: string, path: string) {
    const original = this.resolve(id, path);
    const properties = await this.run(id, () => this.workbench().statEntry(id, original));
    if (properties.path !== original) throw veraError("NOT_FOUND");
    const extension = extname(original).toLowerCase();
    return {
      workbenchId: id,
      properties: {
        ...properties,
        extension:
          viewerExtensionKind(extension) === "unknown"
            ? this.identities.encode("viewer-extension", extension)
            : extension,
        path: this.path(id, properties.path),
        displayPath: this.scrub(id, properties.path),
      },
    };
  }
  async readBytes(id: string, path: string, offset: number, length: number, revision?: string) {
    const original = this.resolve(id, path);
    if (revision !== undefined && !/^__vera_display_[A-Za-z0-9_-]+\.$/.test(revision))
      throw veraError("DENIED");
    const source = await this.run(id, () => this.workbench().readBytes(id, original, offset, length));
    if (source.path !== original || source.offset !== offset) throw veraError("NOT_FOUND");
    const lineEnds: number[] = [];
    if (revision !== undefined) {
      const [originalRevision, encoding] = this.identities
        .decode(`${this.owner}\nbyte-source:${original}`, revision)
        .split("\n");
      if (originalRevision !== source.revision) throw veraError("CONFLICT");
      const width = encoding?.startsWith("utf-16") ? 2 : 1;
      const codeUnit = (at: number) => {
        const i = at - source.start;
        const byte = source.bytes[i];
        if (width === 1) return byte;
        const second = source.bytes[i + 1];
        if (byte === undefined || second === undefined) return undefined;
        return encoding === "utf-16le" ? byte + second * 256 : byte * 256 + second;
      };
      const end = Math.min(source.size, offset + length);
      for (let at = Math.ceil(offset / width) * width; at + width <= end; at += width) {
        const code = codeUnit(at);
        if (code === 10 || (code === 13 && codeUnit(at + width) !== 10)) lineEnds.push(at - offset + width);
      }
    }
    const masked = this.maskingFor(this.current(id).config, "display");
    const bytes = masked
      ? maskByteWindow(source, length, this.secrets())
      : source.bytes.subarray(
          offset - source.start,
          offset - source.start + Math.min(length, Math.max(0, source.size - offset)),
        );
    return {
      workbenchId: id,
      path: this.path(id, original),
      displayPath: this.scrub(id, original),
      offset,
      size: source.size,
      data: bytes.toString("base64"),
      ...(revision === undefined ? {} : { revision, lineEnds }),
    };
  }
  /** Read a small preview through the same workbench ownership and Display policy as the file viewer. */
  async imageThumbnail(id: string, path: string): Promise<Response<"docs.imageThumbnail">> {
    const original = this.resolveSessionImagePath(id, path);
    let sourcePath: string;
    try {
      sourcePath = imageReadPath(validateRelativePath(original));
    } catch {
      throw veraError("DENIED");
    }
    return this.run(id, async () => {
      let preview: Response<"docs.imageThumbnail">["preview"];
      try {
        const first = await this.workbench().readBytes(id, sourcePath, 0, DOCS_BYTE_WINDOW_LIMIT);
        const { size } = first;
        if (size > MAX_MESSAGE_IMAGE_BYTES) throw veraError("IMAGE_TOO_LARGE");
        if (first.path !== sourcePath || first.offset !== 0 || first.revision === undefined)
          throw veraError("CONFLICT");
        const bytes = Buffer.alloc(size);
        for (let offset = 0; offset < size; offset += DOCS_BYTE_WINDOW_LIMIT) {
          const length = Math.min(DOCS_BYTE_WINDOW_LIMIT, size - offset);
          const part =
            offset === 0 ? first : await this.workbench().readBytes(id, sourcePath, offset, length);
          const start = offset - part.start;
          if (
            part.path !== sourcePath ||
            part.offset !== offset ||
            part.size !== size ||
            part.revision !== first.revision ||
            start < 0 ||
            start + length > part.bytes.length
          )
            throw veraError("CONFLICT");
          part.bytes.copy(bytes, offset, start, start + length);
        }
        const secretsForPreview = () =>
          this.maskingFor(this.current(id).config, "display") ? this.secrets() : [];
        const secrets = [...secretsForPreview()];
        const image = secrets.length ? maskByteWindow({ ...first, bytes }, size, secrets) : bytes;
        const format = rasterSignature(image);
        if (format && !/\.svgz?$/i.test(original)) {
          const thumbnail = await rasterThumbnail(image, format);
          const latest = secretsForPreview();
          if (latest.length === secrets.length && latest.every((secret, index) => secret === secrets[index]))
            preview = { format, thumbnail };
        }
      } catch (error) {
        if (!veraErrorSchema.safeParse(error).success) throw error;
      }
      return {
        workbenchId: id,
        path: this.path(id, sourcePath),
        displayPath: this.scrub(id, original),
        ...(preview && { preview }),
      };
    });
  }
  async search(id: string, query: string) {
    const { coverage, usage, results } = await this.run(id, () =>
      this.workbench().searchDocuments(id, query),
    );
    return {
      workbenchId: id,
      coverage,
      usage,
      results: results.map((hit) =>
        publicDocumentHit(
          hit,
          (text) => this.scrub(id, text),
          (path) => this.path(id, path),
          (ref) => this.ref(id, ref),
        ),
      ),
    };
  }
  async open(
    id: string,
    read: () => Promise<ViewerContent>,
    target: { path: string } | { ref: string; sessionId?: string },
    requestId?: string,
  ) {
    const original =
      "path" in target
        ? this.resolve(id, target.path)
        : "sessionId" in target
          ? originalRef(target.ref)
          : this.resolveRef(id, target.ref);
    const content = await this.run(id, read);
    if (("path" in target ? content.path : content.ref) !== original) throw veraError("NOT_FOUND");
    return {
      workbenchId: id,
      ...(requestId === undefined ? {} : { requestId }),
      content: this.viewer(id, content),
    };
  }
  guard(id: string) {
    return publicGuard(this.workbench().documentGuard(id), (text) => this.scrub(id, text));
  }
}
