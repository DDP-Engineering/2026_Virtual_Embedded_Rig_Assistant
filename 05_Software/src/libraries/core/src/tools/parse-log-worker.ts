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
): Promise<ParseLogResult> {
  const args = parseLogArgsSchema.parse(raw);
  const regex = args.profile ? logProfiles[args.profile] : patternFor(args.pattern ?? "");
  // Keep the requested, normalized spelling bounded even when it aliases a longer canonical path.
  const sourcePath = posix.normalize(args.path.replaceAll("\\", "/"));
  let guard: PathGuard;
  let target: Awaited<ReturnType<PathGuard["resolve"]>>;
  try {
    guard = await PathGuard.create(root);
    target = await guard.resolve(args.path);
    formatLineRef({ path: sourcePath, start: 1, end: 1 });
  } catch {
    throw new LogFailure(
      "DENIED",
      "path_denied",
      "Choose an allowed workbench log outside ignored paths and .vera.",
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
    const ref = (line: number) => formatLineRef({ path: sourcePath, start: line, end: line });
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
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
    const line = (bytes: Buffer, consumed: number) => {
      if (bytes.at(-1) === 13) bytes = bytes.subarray(0, -1);
      if (result.scan.lines === 0 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
        bytes = bytes.subarray(3);
      if (bytes.length > 16384)
        throw new LogFailure("INVALID", "line_too_large", "Choose a log with lines no larger than 16 KiB.");
      let text: string;
      try {
        text = decoder.decode(bytes);
      } catch {
        throw new LogFailure("INVALID", "invalid_utf8", "Save the log as valid UTF-8.");
      }
      text = stripVTControlCharacters(text);
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
      result.source.ref = formatLineRef({ path: sourcePath, start: 1, end: number });
      result.preview.omitted = eligible - result.events.length;
      if (result.preview.omitted) result.preview.truncated = true;
      if (number % 1000 === 0) emit();
    };
    const buffer = Buffer.alloc(65536);
    for (;;) {
      const read = await handle.read(buffer, 0, buffer.length, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
      if (offset > 50 * 1024 * 1024)
        throw new LogFailure("INVALID", "file_too_large", "Choose a log no larger than 50 MiB.");
      const chunk = buffer.subarray(0, read.bytesRead);
      if (args.expectedSha256) await checkExpectedVersion();
      hash.update(chunk);
      let start = 0;
      for (let i = 0; i < chunk.length; i++)
        if (chunk[i] === 10) {
          const bytes = pending.length
            ? Buffer.concat([pending, chunk.subarray(start, i)])
            : chunk.subarray(start, i);
          line(bytes, bytes.length + 1);
          pending = Buffer.alloc(0);
          start = i + 1;
        }
      pending = Buffer.concat([pending, chunk.subarray(start)]);
      const bomBytes =
        result.scan.lines === 0 && pending.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
      if (pending.length > 16385 + bomBytes)
        throw new LogFailure("INVALID", "line_too_large", "Choose a log with lines no larger than 16 KiB.");
    }
    if (result.scan.lines === 0 && pending.equals(Buffer.from([0xef, 0xbb, 0xbf])))
      result.scan.bytes = pending.length;
    else if (pending.length) line(pending, pending.length);
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
    if (
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
