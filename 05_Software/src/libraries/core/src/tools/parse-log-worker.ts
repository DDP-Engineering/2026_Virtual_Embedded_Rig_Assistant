import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { posix } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  boundLogResult,
  emptyLogResult,
  formatLineRef,
  logProfiles,
  normalizeLogLevel,
  type ParseLogResult,
  parseLogArgsSchema,
} from "@vera/shared";
import { PathGuard } from "../workbench/path-guard.js";

import { LogFailure } from "./log-failure.js";

/** What is kept of one line; a longer line is analysed by this much. */
const LINE_BYTES = 16384;

function patternFor(pattern: string): RegExp {
  try {
    const regex = new RegExp(pattern);
    // Inspect syntax without matching even an empty input: lookaheads can themselves stall.
    const names = new Set<string>();
    let inClass = false;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (!inClass && pattern.startsWith("(?<", i) && !["=", "!"].includes(pattern[i + 3] ?? "")) {
        const end = pattern.indexOf(">", i + 3);
        const name = pattern
          .slice(i + 3, end)
          .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi, (_, a, b) =>
            String.fromCodePoint(Number.parseInt(a ?? b, 16)),
          );
        names.add(name);
      }
    }
    if (!names.has("level") || !names.has("message")) throw Error("Missing named groups.");
    return regex;
  } catch {
    throw new LogFailure(
      "INVALID",
      "invalid_pattern",
      "Use a valid JavaScript pattern with named level and message groups.",
    );
  }
}
/** Streaming scanner called exclusively by the independently bundled task worker. */
export async function scanLog(
  root: string,
  raw: unknown,
  checkpoint: (value: ParseLogResult) => void,
  excludedRoots: readonly string[] = [],
  scope: "filesystem" | "workbench" = "workbench",
): Promise<ParseLogResult> {
  const args = parseLogArgsSchema.parse(raw);
  const regex = args.profile ? logProfiles[args.profile] : patternFor(args.pattern ?? "");
  // Keep the requested, normalized spelling bounded even when it aliases a longer canonical path.
  let sourcePath = posix.normalize(args.path.replaceAll("\\", "/"));
  let local = true;
  let guard: PathGuard;
  let target: Awaited<ReturnType<PathGuard["resolve"]>>;
  try {
    guard = await PathGuard.create(root, root, scope, undefined, excludedRoots, [], { allowRunLogs: true });
    target = await guard.resolve(args.path);
    sourcePath = target.relative;
    local = !sourcePath.startsWith("/") && !/^[A-Za-z]:/.test(sourcePath);
    if (local) formatLineRef({ path: sourcePath, start: 1, end: 1 });
  } catch {
    throw new LogFailure(
      "DENIED",
      "path_denied",
      "Choose a log allowed by the current permission mode, outside VERA application data.",
    );
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    const info = await lstat(target.absolute);
    if (!info.isFile()) throw new LogFailure("DENIED", "path_denied", "Choose an ordinary log file.");
    handle = await open(target.absolute, "r");
  } catch (error) {
    if (error instanceof LogFailure) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new LogFailure("NOT_FOUND", "not_found", "Log not found. Choose an existing file.");
    throw new LogFailure("DENIED", "path_denied", "Cannot open the log. Check its path and permissions.");
  }
  try {
    const before = await handle.stat();
    try {
      const current = await guard.resolve(args.path);
      const info = await lstat(current.absolute);
      if (current.key !== target.key || info.ino !== before.ino || info.dev !== before.dev)
        throw Error("Changed identity.");
    } catch {
      throw new LogFailure("CONFLICT", "source_changed", "Log changed before analysis. Parse it again.");
    }
    if (!before.isFile()) throw new LogFailure("DENIED", "path_denied", "Choose an ordinary log file.");
    if (before.size > 50 * 1024 * 1024)
      throw new LogFailure("INVALID", "file_too_large", "Choose a log no larger than 50 MiB.");
    const result = emptyLogResult({ ...args, path: sourcePath });
    const ref = (line: number) =>
      local ? formatLineRef({ path: sourcePath, start: line, end: line }) : null;
    // A serial capture holds stray bytes (boot output at another baud rate, a reset glitch): they become
    // replacement characters in their line, which then counts as unparsed, and the rest is analysed.
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const hash = createHash("sha256");
    let eligible = 0;
    let offset = 0;
    let pending = Buffer.alloc(0);
    const emit = () => {
      boundLogResult(result);
      checkpoint(structuredClone(result));
    };
    const checkExpectedVersion = async () => {
      const current = await handle.stat();
      if (
        before.size !== current.size ||
        before.mtimeMs !== current.mtimeMs ||
        before.ctimeMs !== current.ctimeMs
      )
        throw new LogFailure("CONFLICT", "source_changed", "Log changed during analysis. Parse it again.");
    };
    emit();
    if (args.expectedSha256) {
      // Refuse the previous version before any agent regex can stall and publish its data.
      const expectedHash = createHash("sha256");
      const chunk = Buffer.alloc(65536);
      let position = 0;
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        if (position > 50 * 1024 * 1024)
          throw new LogFailure("INVALID", "file_too_large", "Choose a log no larger than 50 MiB.");
        expectedHash.update(chunk.subarray(0, bytesRead));
      }
      if (position !== before.size || expectedHash.digest("hex") !== args.expectedSha256.toLowerCase())
        throw new LogFailure(
          "CONFLICT",
          "source_changed",
          "Log changed. Parse the current file before comparing results.",
        );
      await checkExpectedVersion();
    }
    const line = (bytes: Buffer, consumed: number, clipped = false) => {
      if (bytes.at(-1) === 13) bytes = bytes.subarray(0, -1);
      if (result.scan.lines === 0 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
        bytes = bytes.subarray(3);
      // One overlong line (a hex dump, a blob) is analysed by its first 16 KiB; the log is not refused.
      if (bytes.length > LINE_BYTES) {
        bytes = bytes.subarray(0, LINE_BYTES);
        clipped = true;
      }
      if (clipped) result.preview.truncated = true;
      const text = stripVTControlCharacters(decoder.decode(bytes));
      const number = result.scan.lines + 1;
      const groups = text.trim() ? regex.exec(text)?.groups : undefined;
      if (!text.trim()) result.counts.blank++;
      else if (!groups || groups.level === undefined || groups.message === undefined) {
        result.counts.unparsed++;
        if (result.unparsedSamples.length < 5)
          result.unparsedSamples.push({ line: number, text: text.slice(0, 256), ref: ref(number) });
        if (text.length > 256) result.preview.truncated = true;
      } else {
        const level = normalizeLogLevel(groups.level);
        result.counts[level]++;
        if (
          number >= args.fromLine &&
          (!args.levels || args.levels.includes(level)) &&
          (!args.contains || groups.message.toLowerCase().includes(args.contains.toLowerCase()))
        ) {
          eligible++;
          if (result.events.length < args.maxEvents && result.preview.omitted === 0) {
            result.events.push({
              line: number,
              level,
              message: groups.message.slice(0, 256),
              ref: ref(number),
              ...(groups.time !== undefined ? { time: groups.time.slice(0, 256) } : {}),
              ...(groups.source !== undefined ? { source: groups.source.slice(0, 256) } : {}),
            });
            if ([groups.message, groups.time, groups.source].some((value) => value && value.length > 256))
              result.preview.truncated = true;
          }
        }
      }
      result.scan.lines = number;
      result.scan.bytes += consumed;
      result.source.ref = local ? formatLineRef({ path: sourcePath, start: 1, end: number }) : null;
      result.preview.omitted = eligible - result.events.length;
      if (result.preview.omitted) result.preview.truncated = true;
      if (number % 1000 === 0) emit();
    };
    const buffer = Buffer.alloc(65536);
    // Bytes of the current line beyond what is kept of an overlong line.
    let dropped = 0;
    // A capture saved by Windows PowerShell is UTF-16: it is read as the same text, line by line.
    let utf16: InstanceType<typeof TextDecoder> | undefined;
    const split = (chunk: Buffer) => {
      let start = 0;
      for (let i = 0; i < chunk.length; i++)
        if (chunk[i] === 10) {
          const bytes = pending.length
            ? Buffer.concat([pending, chunk.subarray(start, i)])
            : chunk.subarray(start, i);
          line(bytes, bytes.length + 1 + dropped, dropped > 0);
          pending = Buffer.alloc(0);
          dropped = 0;
          start = i + 1;
        }
      pending = Buffer.concat([pending, chunk.subarray(start)]);
      if (pending.length > LINE_BYTES + 4) {
        dropped += pending.length - LINE_BYTES;
        pending = pending.subarray(0, LINE_BYTES);
      }
    };
    while (offset < before.size) {
      // Only the bytes the log had when it was opened: one that is still written is read as a snapshot.
      const read = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!read.bytesRead) break;
      const chunk = buffer.subarray(0, read.bytesRead);
      if (!offset) {
        const mark = chunk.subarray(0, 2);
        if (mark.equals(Buffer.from([0xff, 0xfe]))) utf16 = new TextDecoder("utf-16le", { ignoreBOM: true });
        else if (mark.equals(Buffer.from([0xfe, 0xff])))
          utf16 = new TextDecoder("utf-16be", { ignoreBOM: true });
      }
      offset += read.bytesRead;
      if (offset > 50 * 1024 * 1024)
        throw new LogFailure("INVALID", "file_too_large", "Choose a log no larger than 50 MiB.");
      if (args.expectedSha256) await checkExpectedVersion();
      hash.update(chunk);
      split(
        utf16 ? Buffer.from(utf16.decode(chunk, { stream: true }).replace(/^\uFEFF/, ""), "utf8") : chunk,
      );
    }
    if (result.scan.lines === 0 && pending.equals(Buffer.from([0xef, 0xbb, 0xbf])))
      result.scan.bytes = pending.length;
    else if (pending.length) line(pending, pending.length + dropped, dropped > 0);
    // The count is of the source's bytes, whatever its encoding.
    if (utf16) result.scan.bytes = offset;
    const after = await handle.stat();
    let current: Awaited<ReturnType<PathGuard["resolve"]>>;
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      current = await guard.resolve(args.path);
      info = await lstat(current.absolute);
    } catch {
      throw new LogFailure("CONFLICT", "source_changed", "Log changed during analysis. Parse it again.");
    }
    const sha256 = hash.digest("hex");
    // A log that only grew (a device still logging into its capture) is accepted as the snapshot read;
    // a caller that pinned a version, or a file rewritten in place, is still refused.
    const growing =
      !args.expectedSha256 &&
      // The growth may land between the two looks at the file.
      after.size >= before.size &&
      info.size >= after.size &&
      info.size > before.size &&
      offset === before.size &&
      before.ino === info.ino &&
      before.dev === info.dev &&
      target.key === current.key;
    if (growing) result.scan.growing = true;
    else if (
      offset !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== info.ino ||
      before.dev !== info.dev ||
      before.size !== info.size ||
      before.mtimeMs !== info.mtimeMs ||
      before.ctimeMs !== info.ctimeMs ||
      target.key !== current.key ||
      (args.expectedSha256 && args.expectedSha256.toLowerCase() !== sha256)
    )
      throw new LogFailure(
        "CONFLICT",
        "source_changed",
        "Log changed. Parse the current file before comparing results.",
      );
    result.source.sha256 = sha256;
    result.scan.complete = true;
    result.scan.stopReason = "eof";
    return boundLogResult(result);
  } finally {
    await handle.close();
  }
}
