import { isAbsolute } from "node:path";
import { parentPort } from "node:worker_threads";
import { formatLineRef, parseLineRef } from "@vera/shared";
import type { GrepFileResult, GrepMatch, WorkerTask } from "../ports.js";
import { PathGuard } from "../workbench/path-guard.js";
import { isBinary, utf16Bom, validUtf8 } from "./binary.js";
import { discoverFilePaths, inspectDiscoveredFile, resolveDiscoveryPath } from "./discovery.js";
import { readFilePrefix, readGuardedFile, textLines } from "./files.js";
import { grepParams } from "./grep.js";
import { LogFailure } from "./log-failure.js";

/** The sample `isBinary` classifies; files up to this size are simply read. */
const SNIFF_BYTES = 8192;
/** Candidates inspected at once; the same batch size as file discovery. */
const CLASSIFY_BATCH = 16;

/** Dedicated task entry, bundled independently by each host; never called by main-thread tools. */
async function execute(task: WorkerTask) {
  const port = parentPort;
  if (!port) throw Error("Grep requires a dedicated worker.");
  try {
    if (task.kind === "parse_log") {
      const { scanLog } = await import("./parse-log-worker.js");
      const value = await scanLog(
        task.root,
        task.args,
        (value) => port.postMessage({ type: "checkpoint", value }),
        task.excludedRoots,
        task.scope,
      );
      port.postMessage({ type: "done", value });
      return;
    }
    const args = grepParams.parse(task.args);
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.ignoreCase ? "i" : "");
    } catch {
      throw Error("Invalid JavaScript regular expression. Correct the regex pattern.");
    }
    const guard = await PathGuard.create(
      task.root,
      task.root,
      task.scope === "filesystem" ? "filesystem" : "workbench",
      undefined,
      task.excludedRoots,
      task.additionalRoots,
      { allowRunLogs: true },
    );
    const signal = new AbortController().signal;
    const paths = await discoverFilePaths(guard, args.path ?? ".", args.glob ?? "**/*", signal);
    paths.sort((a, b) => a.localeCompare(b));
    const maxResults = args.maxResults ?? 500;
    let returned = 0;
    let truncated = false;
    // Files left unsearched are reported, so "no matches" is never mistaken for "searched and clean".
    let skipped = 0;
    const content = !args.output || args.output === "content";
    const reportedFiles = content ? undefined : new Set<string>();
    const maxFileBytes = task.maxFileBytes ?? 5 * 1024 * 1024;
    // A search of one named file that cannot be searched is an answer the model must not read as "no
    // matches": it says why, and what to use instead. In a folder search such files are only counted.
    const namedFile =
      args.path !== undefined &&
      paths.length === 1 &&
      (await resolveDiscoveryPath(guard, args.path, signal)).info.isFile();
    const megabytes = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
    const unsearchable = (reason: "large" | "binary", size: number) =>
      Error(
        reason === "large"
          ? `This file is ${megabytes(size)}, above the ${megabytes(maxFileBytes)} grep limit. Read it in pages with read (offset and limit), or use parse_log for a log.`
          : "This file is binary; grep searches text files.",
      );
    // Whether a candidate is searched, counted as unsearched (`skip` names why) or dropped. A larger file
    // is classified from its first bytes, so object files, images and archives are never read whole.
    const classify = async (candidate: string) => {
      const file = await inspectDiscoveredFile(guard, candidate, signal);
      if (!file) return undefined;
      if (file.size > maxFileBytes) return { file, skip: "large" as const };
      if (file.size > SNIFF_BYTES)
        try {
          const prefix = await readFilePrefix(file.absolute, SNIFF_BYTES, signal);
          if (!utf16Bom(prefix) && isBinary(prefix)) return { file, skip: "binary" as const };
        } catch {
          return { file, skip: "unreadable" as const };
        }
      return { file, skip: undefined };
    };
    // Classification runs a batch at a time, as file discovery does: a build folder is mostly files to
    // skip, and one at a time their checks alone approached the task deadline. Results keep path order.
    search: for (let start = 0; start < paths.length; start += CLASSIFY_BATCH) {
      const batch = await Promise.all(paths.slice(start, start + CLASSIFY_BATCH).map(classify));
      for (const [offset, item] of batch.entries()) {
        const index = start + offset;
        if (!item || reportedFiles?.has(item.file.path)) continue;
        if (item.skip) {
          if (namedFile && item.skip !== "unreadable") throw unsearchable(item.skip, item.file.size);
          skipped++;
          continue;
        }
        const file = item.file;
        let bytes: Buffer;
        let path: string;
        try {
          const read = await readGuardedFile(guard, file.path, maxFileBytes, signal, { allowGrowth: true });
          bytes = read.bytes;
          path = read.target.relative;
        } catch {
          skipped++;
          continue;
        }
        if (reportedFiles?.has(path)) continue;
        const bom = utf16Bom(bytes);
        if (!bom && isBinary(bytes)) {
          if (namedFile) throw unsearchable("binary", file.size);
          skipped++;
          continue;
        }
        let decoded: string;
        try {
          decoded = bom
            ? new TextDecoder(bom, { fatal: true }).decode(bytes)
            : bytes.toString(validUtf8(bytes) ? "utf8" : "latin1");
        } catch {
          skipped++;
          continue;
        }
        const lines = textLines(decoded);
        let fileMatches = 0;
        for (let i = 0; i < lines.length; i++) {
          const text = lines[i] ?? "";
          if (!regex.test(text)) continue;
          if (!content) {
            fileMatches++;
            if (args.output === "files") break;
            continue;
          }
          const match: GrepMatch = {
            path,
            line: i + 1,
            text: text.slice(0, 16000),
            ...(!isAbsolute(path) || parseLineRef(`${path}#L${i + 1}-L${i + 1}`)
              ? { ref: formatLineRef({ path, start: i + 1, end: i + 1 }) }
              : {}),
          };
          if (match.text.length < text.length) truncated = true;
          const context = args.context;
          if (context)
            match.context = lines.slice(Math.max(0, i - context), i + context + 1).flatMap((line, n) => {
              const number = Math.max(0, i - context) + n + 1;
              if (number === i + 1) return [];
              if (line.length > 2000) truncated = true;
              return [{ line: number, text: line.slice(0, 2000) }];
            });
          port.postMessage({ type: "partial", match });
          if (++returned >= maxResults) break;
        }
        if (reportedFiles && fileMatches) {
          reportedFiles.add(path);
          const file: GrepFileResult = { path, count: fileMatches };
          port.postMessage({ type: "file", file });
          returned++;
        }
        if (returned >= maxResults) {
          truncated ||= content || index + 1 < paths.length;
          break search;
        }
      }
    }
    port.postMessage({ type: "done", truncated, skipped });
  } catch (error) {
    port.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "Worker task failed.",
      ...(error instanceof LogFailure
        ? { failure: { code: error.code, reason: error.reason, message: error.message } }
        : {}),
    });
  }
}
if (parentPort)
  parentPort.once("message", (task: WorkerTask) => {
    void execute(task);
  });
