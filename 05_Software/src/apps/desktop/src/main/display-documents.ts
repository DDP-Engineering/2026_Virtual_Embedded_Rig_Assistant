import { extname } from "node:path";
import type { WorkbenchService } from "@vera/core";
import {
  type DocumentRecord,
  formatRef,
  parseRef,
  type ViewerContent,
  veraError,
  viewerExtensionKind,
  type WorkbenchConfig,
} from "@vera/shared";
import { maskByteWindow } from "./display-bytes.js";
import type { DisplayIdentities } from "./display-identities.js";
import { publicDocument, publicDocumentHit, publicViewer } from "./document-viewer.js";
import { publicGuard } from "./events.js";

function originalRef(ref: string): string {
  if (ref.length > 8192) throw veraError("INVALID");
  return ref;
}

/** Workbench-owned identities keep presentation out of host path authority. */
export class DisplayDocuments {
  private generation = 0;
  private owner = "";
  constructor(
    private workbench: WorkbenchService,
    private maskingFor: (config: WorkbenchConfig, area: "display") => boolean,
    private redact: (text: string) => string,
    private identities: DisplayIdentities,
    private secrets: () => readonly string[],
  ) {}
  close() {
    this.generation++;
    this.owner = "";
  }
  private current(id: string) {
    const snapshot = this.workbench.getSnapshot();
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
  resolve(id: string, path: string): string {
    this.current(id);
    const original = this.identities.decode(this.owner, path);
    if (original.length > 4096) throw veraError("INVALID");
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
                content.byteSource.revision,
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
    const documents = await this.run(id, () => this.workbench.listDocuments(id));
    return { workbenchId: id, documents: documents.map((doc) => this.document(id, doc)) };
  }
  async tree(id: string, path: string) {
    const listed = await this.run(id, () => this.workbench.listFolder(id, this.resolve(id, path)));
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
    const found = await this.run(id, () => this.workbench.findFiles(id, query));
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
    const content = await this.run(id, () => this.workbench.readText(id, original));
    if (content.path !== original) throw veraError("NOT_FOUND");
    return {
      workbenchId: id,
      ...(requestId === undefined ? {} : { requestId }),
      content: this.viewer(id, content),
    };
  }
  async stat(id: string, path: string) {
    const original = this.resolve(id, path);
    const properties = await this.run(id, () => this.workbench.statEntry(id, original));
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
    const source = await this.run(id, () => this.workbench.readBytes(id, original, offset, length));
    if (source.path !== original || source.offset !== offset) throw veraError("NOT_FOUND");
    if (
      revision !== undefined &&
      this.identities.decode(`${this.owner}\nbyte-source:${original}`, revision) !== source.revision
    )
      throw veraError("CONFLICT");
    const lineEnds: number[] = [];
    if (revision !== undefined) {
      const end = Math.min(source.size, offset + length);
      for (let at = offset; at < end; at++) {
        const byte = source.bytes[at - source.start],
          next = source.bytes[at + 1 - source.start];
        if (byte === 10 || (byte === 13 && next !== 10)) lineEnds.push(at - offset + 1);
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
  async search(id: string, query: string) {
    const results = await this.run(id, () => this.workbench.searchDocuments(id, query));
    return {
      workbenchId: id,
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
    return publicGuard(this.workbench.documentGuard(id), (text) => this.scrub(id, text));
  }
}
