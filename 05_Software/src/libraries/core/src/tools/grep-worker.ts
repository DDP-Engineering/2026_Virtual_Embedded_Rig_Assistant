import { isAbsolute } from "node:path";
import { parentPort } from "node:worker_threads";
import { formatLineRef, parseLineRef } from "@vera/shared";
import type { GrepMatch, WorkerTask } from "../ports.js";
import { PathGuard } from "../workbench/path-guard.js";
import { isBinary } from "./binary.js";
import { discoverFiles } from "./discovery.js";
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
    );
    const signal = new AbortController().signal;
    const files = await discoverFiles(guard, args.path ?? ".", args.glob ?? "**/*", signal);
    files.sort((a, b) => a.path.localeCompare(b.path));
    let count = 0;
    let truncated = false;
    let limitReached = false;
    // Files left unsearched are reported, so "no matches" is never mistaken for "searched and clean".
    let skipped = 0;
    const content = !args.output || args.output === "content";
    const maxFileBytes = task.maxFileBytes ?? 5 * 1024 * 1024;
    for (const file of files) {
      if (file.size > maxFileBytes) {
        skipped++;
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = (await readGuardedFile(guard, file.path, maxFileBytes, signal)).bytes;
      } catch {
        skipped++;
        continue;
      }
      if (isBinary(bytes)) {
        skipped++;
        continue;
      }
      const lines = textLines(bytes.toString("utf8"));
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? "";
        if (!regex.test(text)) continue;
        const match: GrepMatch = {
          path: file.path,
          line: i + 1,
          text: content ? text.slice(0, 16000) : "",
          ...(!isAbsolute(file.path) || parseLineRef(`${file.path}#L${i + 1}-L${i + 1}`)
            ? { ref: formatLineRef({ path: file.path, start: i + 1, end: i + 1 }) }
            : {}),
        };
        if (content && match.text.length < text.length) truncated = true;
        const context = args.context;
        if (content && context)
          match.context = lines.slice(Math.max(0, i - context), i + context + 1).flatMap((line, n) => {
            const number = Math.max(0, i - context) + n + 1;
            if (number === i + 1) return [];
            if (line.length > 2000) truncated = true;
            return [{ line: number, text: line.slice(0, 2000) }];
          });
        port.postMessage({ type: "partial", match });
        count++;
        if (count >= (args.maxResults ?? 500)) {
          truncated = true;
          limitReached = true;
          break;
        }
      }
      if (limitReached) break;
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
