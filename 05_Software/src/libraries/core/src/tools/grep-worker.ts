import { isAbsolute } from "node:path";
import { parentPort } from "node:worker_threads";
import { formatLineRef, parseLineRef } from "@vera/shared";
import type { GrepFileResult, GrepMatch, WorkerTask } from "../ports.js";
import { PathGuard } from "../workbench/path-guard.js";
import { isBinary, utf16Bom, validUtf8 } from "./binary.js";
import { discoverFilePaths, inspectDiscoveredFile } from "./discovery.js";
import { readGuardedFile, textLines } from "./files.js";
import { grepParams } from "./grep.js";
import { LogFailure } from "./log-failure.js";

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
    for (const [index, candidate] of paths.entries()) {
      const file = await inspectDiscoveredFile(guard, candidate, signal);
      if (!file || reportedFiles?.has(file.path)) continue;
      if (file.size > maxFileBytes) {
        skipped++;
        continue;
      }
      let bytes: Buffer;
      let path: string;
      try {
        const read = await readGuardedFile(guard, file.path, maxFileBytes, signal);
        bytes = read.bytes;
        path = read.target.relative;
      } catch {
        skipped++;
        continue;
      }
      if (reportedFiles?.has(path)) continue;
      const bom = utf16Bom(bytes);
      if (!bom && isBinary(bytes)) {
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
        break;
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
