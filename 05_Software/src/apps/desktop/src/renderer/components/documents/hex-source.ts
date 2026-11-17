import { type ViewerContent, veraError } from "@vera/shared";
import { api } from "../../api/index.js";

export const HEX_WINDOW_BYTES = 65536;
const QUERY_LIMIT = 4096;
export interface HexFile {
  workbenchId: string;
  path: string;
  size: number;
  modified: string | null;
}
export type HexMode = "hex" | "text";
export const hexByte = (byte: number) => byte.toString(16).toUpperCase().padStart(2, "0");
export function formatHexRow(offset: number, bytes: Uint8Array) {
  return {
    offset: offset.toString(16).toUpperCase().padStart(8, "0"),
    hex: Array.from(bytes, hexByte).join(" "),
    ascii: Array.from(bytes, (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".")).join(
      "",
    ),
  };
}
export function parseHexOffset(value: string, size: number) {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value.trim())) throw veraError("INVALID");
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(1, size)) throw veraError("INVALID");
  return offset;
}
export function hexPattern(value: string, mode: HexMode) {
  if (value.length > QUERY_LIMIT * 3) throw veraError("INVALID");
  const compact = value.replace(/\s/g, "");
  if (mode === "hex" && (!/^(?:[0-9a-f]{2})+$/i.test(compact) || compact.length > QUERY_LIMIT * 2))
    throw veraError("INVALID");
  const bytes =
    mode === "text"
      ? new TextEncoder().encode(value)
      : Uint8Array.from(compact.match(/../g) ?? [], (part) => Number.parseInt(part, 16));
  if (!bytes.length || bytes.length > QUERY_LIMIT) throw veraError("INVALID");
  return bytes;
}
export async function readHexFile(workbenchId: string, path: string) {
  const reply = await api.invoke("docs.stat", { workbenchId, path });
  const { properties } = reply;
  if (reply.workbenchId !== workbenchId) throw veraError("CONFLICT");
  if (
    properties.type !== "file" ||
    properties.size === null ||
    !Number.isSafeInteger(properties.size) ||
    properties.size < 0
  )
    throw veraError("INVALID");
  // The host may replace a newly secret-named raw target with its stable opaque identity.
  const hexFile: HexFile = {
    workbenchId,
    path: properties.path,
    size: properties.size,
    modified: properties.modified,
  };
  const content: Extract<ViewerContent, { kind: "text" }> = {
    kind: "text",
    path,
    displayPath: properties.displayPath ?? path,
    ref: null,
    snippet: "",
    lines: [],
    start: 1,
    end: 1,
  };
  return { workbenchId, content, hexFile };
}

/** Physical Display-masked bytes only; no text decoding/index or citation metadata. */
export class HexSource {
  private cache = new Map<string, Uint8Array>();
  private disposed = false;
  private pending = Promise.resolve();
  constructor(readonly file: HexFile) {}
  get retainedBytes() {
    return [...this.cache.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  }
  dispose() {
    this.disposed = true;
    this.cache.clear();
  }
  private alive(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.disposed) throw new DOMException("Disposed", "AbortError");
  }
  async read(offset: number, length: number, signal: AbortSignal, cache = false): Promise<Uint8Array> {
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
  private async readWindow(
    offset: number,
    length: number,
    signal: AbortSignal,
    cache = false,
  ): Promise<Uint8Array> {
    this.alive(signal);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > this.file.size ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > HEX_WINDOW_BYTES
    )
      throw veraError("INVALID");
    const key = `${offset}:${length}`,
      known = this.cache.get(key);
    if (known) {
      this.cache.delete(key);
      this.cache.set(key, known);
      return known;
    }
    const { workbenchId, path, size } = this.file;
    const reply = await api.invoke("docs.readBytes", { workbenchId, path, offset, length });
    this.alive(signal);
    if (
      reply.workbenchId !== workbenchId ||
      reply.path !== path ||
      reply.offset !== offset ||
      reply.size !== size ||
      reply.data.length > Math.ceil(length / 3) * 4
    )
      throw veraError("CONFLICT");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(reply.data), (char) => char.charCodeAt(0));
    } catch {
      throw veraError("CONFLICT");
    }
    if (bytes.length !== Math.min(length, size - offset)) throw veraError("CONFLICT");
    if (cache) {
      this.cache.set(key, bytes);
      if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value ?? "");
    }
    return bytes;
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
  /** Next match by physical start offset, wrapping once without joining EOF to the beginning. */
  async find(pattern: Uint8Array, start: number, signal: AbortSignal): Promise<number | null> {
    if (
      !pattern.length ||
      pattern.length > QUERY_LIMIT ||
      !Number.isSafeInteger(start) ||
      start < 0 ||
      start > this.file.size
    )
      throw veraError("INVALID");
    await this.verify(signal);
    const prefix = new Uint16Array(pattern.length);
    for (let i = 1, j = 0; i < pattern.length; i++) {
      while (j && pattern[i] !== pattern[j]) j = prefix[j - 1] ?? 0;
      if (pattern[i] === pattern[j]) j++;
      prefix[i] = j;
    }
    const spans: [number, number, number][] = [
      [start, this.file.size, this.file.size],
      [0, Math.min(this.file.size, start + pattern.length - 1), start],
    ];
    for (const [from, end, maxStart] of spans) {
      let matched = 0;
      for (let offset = from; offset < end; offset += HEX_WINDOW_BYTES) {
        const bytes = await this.read(offset, Math.min(HEX_WINDOW_BYTES, end - offset), signal);
        for (let i = 0; i < bytes.length; i++) {
          while (matched && bytes[i] !== pattern[matched]) matched = prefix[matched - 1] ?? 0;
          if (bytes[i] === pattern[matched]) matched++;
          if (matched === pattern.length) {
            const found = offset + i - pattern.length + 1;
            if (found < maxStart) {
              await this.verify(signal);
              return found;
            }
            matched = prefix[matched - 1] ?? 0;
          }
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.alive(signal);
      }
    }
    await this.verify(signal);
    return null;
  }
  async copy(anchor: number, focus: number, mode: HexMode, signal: AbortSignal) {
    const start = Math.min(anchor, focus),
      end = Math.max(anchor, focus),
      length = end - start + 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end >= this.file.size ||
      length > HEX_WINDOW_BYTES
    )
      throw veraError("INVALID");
    await this.verify(signal);
    const bytes = await this.read(start, length, signal);
    await this.verify(signal);
    return mode === "hex" ? Array.from(bytes, hexByte).join(" ") : new TextDecoder("utf-8").decode(bytes);
  }
}
