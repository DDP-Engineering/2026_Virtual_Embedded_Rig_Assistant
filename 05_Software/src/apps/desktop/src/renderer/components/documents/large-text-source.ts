import { DOCS_BYTE_WINDOW_LIMIT, veraError } from "@vera/shared";
import { api } from "../../api/index.js";
import type { TextEncoding } from "./text-encoding.js";

export const TEXT_WINDOW_BYTES = 64 * 1024;
export const TEXT_SCAN_BYTES = 256 * 1024;

/** Transient host-owned identity and opening metadata; never persisted with tabs. */
export interface LargeTextFile {
  workbenchId: string;
  path: string;
  size: number;
  modified: string | null;
  encoding: TextEncoding;
  verified?: { revision: string; lines: number; utf8Log: boolean };
}
export type TextBytes = Uint8Array & { lineEnds?: readonly number[] };

export function checkTextAbort(signal: AbortSignal) {
  signal.throwIfAborted();
}

/** Gives input, paint and cancellation a turn between bounded scan chunks. */
export async function yieldTextScan(signal: AbortSignal) {
  checkTextAbort(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkTextAbort(signal);
}

/** A four-window LRU; scan chunks are transient and never enter the cache. */
export class LargeTextSource {
  private cache = new Map<string, TextBytes>();
  private pending = Promise.resolve();

  constructor(readonly file: LargeTextFile) {}

  get retainedBytes() {
    return [...this.cache.values()].reduce((sum, value) => sum + value.length, 0);
  }

  dispose() {
    this.cache.clear();
  }

  private alive(signal: AbortSignal) {
    checkTextAbort(signal);
  }

  async read(offset: number, length: number, signal: AbortSignal, cache = false) {
    const before = this.pending;
    let release = () => {};
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    try {
      return await this.readWindow(offset, length, signal, cache);
    } finally {
      release();
    }
  }

  private async readWindow(offset: number, length: number, signal: AbortSignal, cache: boolean) {
    this.alive(signal);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > this.file.size ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > DOCS_BYTE_WINDOW_LIMIT
    )
      throw veraError("INVALID");
    const key = `${offset}:${length}`;
    const known = this.cache.get(key);
    if (known) {
      this.cache.delete(key);
      this.cache.set(key, known);
      return known;
    }
    const { workbenchId, path, size } = this.file;
    const revision = this.file.verified?.revision;
    const reply = await api.invoke("docs.readBytes", {
      workbenchId,
      path,
      offset,
      length,
      ...(revision ? { revision } : {}),
    });
    this.alive(signal);
    if (
      reply.workbenchId !== workbenchId ||
      reply.path !== path ||
      reply.offset !== offset ||
      reply.size !== size
    )
      throw veraError("CONFLICT");
    let data: TextBytes;
    try {
      if (reply.data.length > Math.ceil(length / 3) * 4) throw veraError("CONFLICT");
      const binary = atob(reply.data);
      data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    } catch {
      throw veraError("CONFLICT");
    }
    if (data.length !== Math.min(length, size - offset)) throw veraError("CONFLICT");
    if (revision) {
      if (
        reply.revision !== revision ||
        !reply.lineEnds ||
        reply.lineEnds.some(
          (end, i) =>
            !Number.isSafeInteger(end) || end <= (reply.lineEnds?.[i - 1] ?? 0) || end > data.length,
        )
      )
        throw veraError("CONFLICT");
      data.lineEnds = reply.lineEnds;
    }
    if (cache && length <= TEXT_WINDOW_BYTES) {
      this.cache.set(key, data);
      if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value ?? "");
    }
    return data;
  }

  async verify(signal: AbortSignal) {
    this.alive(signal);
    const { workbenchId, path, size, modified } = this.file;
    const reply = await api.invoke("docs.stat", { workbenchId, path });
    this.alive(signal);
    if (
      reply.workbenchId !== workbenchId ||
      reply.properties.path !== path ||
      reply.properties.type !== "file" ||
      reply.properties.size !== size ||
      reply.properties.modified !== modified
    )
      throw veraError("CONFLICT");
  }
}

export function textUnit(encoding: TextEncoding) {
  return encoding.startsWith("utf-16") ? 2 : 1;
}

/** LF byte positions, aligned to UTF16 code units where applicable. */
export function forTextNewlines(bytes: TextBytes, encoding: TextEncoding, visit: (end: number) => void) {
  if (bytes.lineEnds) {
    for (const end of bytes.lineEnds) visit(end);
    return;
  }
  const unit = textUnit(encoding);
  for (let i = 0; i + unit <= bytes.length; i += unit) {
    const lf =
      unit === 1
        ? bytes[i] === 10
        : encoding === "utf-16le"
          ? bytes[i] === 10 && bytes[i + 1] === 0
          : bytes[i] === 0 && bytes[i + 1] === 10;
    if (lf) visit(i + unit);
  }
}
