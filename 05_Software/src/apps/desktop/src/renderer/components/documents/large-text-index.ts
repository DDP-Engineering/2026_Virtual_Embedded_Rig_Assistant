import {
  forTextNewlines,
  type LargeTextSource,
  TEXT_SCAN_BYTES,
  textUnit,
  yieldTextScan,
} from "./large-text-source.js";
import type { TextEncoding } from "./text-encoding.js";

interface Checkpoint {
  offset: number;
  line: number;
  lineStart: number;
}

/** Sparse physical checkpoints and one progressive cursor, bounded independently of line count. */
export class LargeTextIndex {
  readonly checkpoints: Checkpoint[] = [{ offset: 0, line: 1, lineStart: 0 }];
  cursor: Checkpoint = { offset: 0, line: 1, lineStart: 0 };
  private stride: number;

  constructor(
    readonly source: LargeTextSource,
    readonly encoding: TextEncoding,
  ) {
    this.stride = Math.max(
      TEXT_SCAN_BYTES,
      Math.ceil(source.file.size / 1024 / TEXT_SCAN_BYTES) * TEXT_SCAN_BYTES,
    );
  }

  estimate(offset: number) {
    if (offset === 0) return 1;
    return Math.max(
      1,
      Math.floor((offset * Math.max(1, this.cursor.line - 1)) / Math.max(1, this.cursor.offset)) + 1,
    );
  }

  ingest(offset: number, bytes: Uint8Array) {
    if (offset !== this.cursor.offset) return;
    const next = { ...this.cursor, offset: offset + bytes.length };
    forTextNewlines(bytes, this.encoding, (end) => {
      next.line++;
      next.lineStart = offset + end;
    });
    this.cursor = next;
    const last = this.checkpoints.at(-1);
    if (last && next.offset - last.offset >= this.stride) this.checkpoints.push({ ...next });
  }

  async extend(offset: number, signal: AbortSignal, line = Infinity) {
    while (this.cursor.offset < Math.min(offset, this.source.file.size) && this.cursor.line <= line) {
      const start = this.cursor.offset;
      const bytes = await this.source.read(
        start,
        Math.min(TEXT_SCAN_BYTES, this.source.file.size - start),
        signal,
      );
      this.ingest(start, bytes);
      await yieldTextScan(signal);
    }
  }

  async position(offset: number, signal: AbortSignal) {
    const target = Math.min(this.source.file.size, Math.max(0, offset));
    await this.extend(target, signal);
    const checkpoint = this.checkpoints.findLast((value) => value.offset <= target) ?? this.checkpoints[0];
    const result = { ...(checkpoint ?? this.cursor) };
    while (result.offset < target) {
      const length = Math.min(TEXT_SCAN_BYTES, target - result.offset);
      const bytes = await this.source.read(result.offset, Math.max(1, length), signal);
      forTextNewlines(bytes, this.encoding, (end) => {
        result.line++;
        result.lineStart = result.offset + end;
      });
      result.offset += bytes.length;
      await yieldTextScan(signal);
    }
    return result;
  }

  async goToLine(line: number, signal: AbortSignal) {
    const target = Math.max(1, Math.floor(line));
    await this.extend(this.source.file.size, signal, target);
    const bounded = Math.min(target, this.cursor.line, this.source.file.verified?.lines ?? Infinity);
    const checkpoint = this.checkpoints.findLast((value) => value.line <= bounded) ?? this.checkpoints[0];
    let current = { ...(checkpoint ?? this.cursor) };
    if (current.line === bounded) return { line: bounded, offset: current.lineStart };
    const unit = textUnit(this.encoding);
    while (current.offset < this.source.file.size) {
      const bytes = await this.source.read(
        current.offset,
        Math.min(TEXT_SCAN_BYTES, this.source.file.size - current.offset),
        signal,
      );
      let found: number | undefined;
      forTextNewlines(bytes, this.encoding, (end) => {
        current.line++;
        current.lineStart = current.offset + end;
        if (current.line === bounded && found === undefined) found = current.lineStart;
      });
      if (found !== undefined) return { line: bounded, offset: Math.floor(found / unit) * unit };
      current = { ...current, offset: current.offset + bytes.length };
      await yieldTextScan(signal);
    }
    return { line: current.line, offset: current.lineStart };
  }
}
