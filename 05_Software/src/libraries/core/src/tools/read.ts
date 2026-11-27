import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { advancedSettings, formatLineRef, parseArtifactRef, parseLineRef, veraError } from "@vera/shared";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "./context.js";
import { toolLimit, toolPathGuard } from "./context.js";
import { entryDisappeared } from "./discovery.js";
import { readWindow } from "./read-window.js";

function readArtifact(
  host: NonNullable<ToolContext["artifacts"]>,
  path: string,
  offset: number,
  limit: number,
  maxChars: number,
  signal: AbortSignal,
) {
  const ref = parseArtifactRef(path);
  if (!ref) throw veraError("INVALID");
  signal.throwIfAborted();
  const { content, sha256 } = host.store.openNamed(host.sessionId, ref.name);
  const lines = content.split(/\r\n|[\r\n]/);
  if (lines.at(-1) === "") lines.pop();
  const selected: string[] = [];
  let index = offset - 1;
  let remaining = maxChars;
  let lineClipped = false;
  for (const line of lines.slice(index, index + limit)) {
    const numbered = `${index + 1}: ${line}`;
    const available = remaining - (selected.length ? 1 : 0);
    if (numbered.length > available) {
      if (selected.length === 0) {
        selected.push(numbered.slice(0, available).replace(/[\uD800-\uDBFF]$/, ""));
        lineClipped = true;
        index++;
      }
      break;
    }
    selected.push(numbered);
    remaining = available - numbered.length;
    index++;
  }
  signal.throwIfAborted();
  return {
    text: selected.join("\n"),
    totalLines: lines.length,
    truncated: lineClipped || index < lines.length,
    ...(lineClipped ? { lineClipped } : {}),
    ...(index < lines.length ? { nextOffset: index + 1 } : {}),
    ref: path,
    sha256,
  };
}

export const readTool: ToolDefinition = {
  name: "read",
  class: "read",
  description:
    "Read numbered text from a workbench file or exact current-session artifact:<name>. Continue at nextOffset when present; lineClipped means the last line is partial; growing means the file was being appended to, so read again for newer lines. Artifact reads return a verified SHA-256. Use read_doc for PDFs.",
  params: z.strictObject({
    path: z
      .string()
      .min(1)
      .describe("Workbench-relative file path or exact current-session artifact reference."),
    offset: z.number().int().min(1).optional().describe("First line to read, starting at 1."),
    // Up to the setting's largest value; the session's Read window lines caps it (REQ-FUNC-150dcb0b).
    limit: z
      .number()
      .int()
      .min(1)
      .max(advancedSettings.readLines.max)
      .optional()
      .describe("Number of lines to read."),
  }),
  async execute(ctx, raw, signal) {
    const args = readTool.params.parse(raw) as { path: string; offset?: number; limit?: number };
    const offset = args.offset ?? 1;
    const lines = toolLimit(ctx, "readLines");
    const limit = Math.min(args.limit ?? lines, lines);
    const maxChars = toolLimit(ctx, "readChars");
    if (args.path.startsWith("artifact:")) {
      if (!ctx.artifacts) throw veraError("NOT_FOUND");
      return readArtifact(ctx.artifacts, args.path, offset, limit, maxChars, signal);
    }
    const guard = await toolPathGuard(ctx, true, { allowRunLogs: true });
    const target = await guard.resolve(args.path);
    if (/\.pdf$/i.test(target.relative))
      throw Error(
        "Use read_doc to read PDF documents. A PDF that read_doc reports as not indexed cannot be read yet: tell the user to add its folder under Edit workbench > Documents, or wait for indexing to finish.",
      );
    // A missing path or a folder gets its own sentence: the system error names neither, and carries the
    // absolute path of the workbench.
    const missing = () => Error(`File not found: ${args.path}. Check the path with list or glob.`);
    const entry = await lstat(target.absolute).catch((error) => {
      if (entryDisappeared(error)) throw missing();
      throw error;
    });
    if (entry.isDirectory()) throw Error(`${args.path} is a folder. Use list to see its entries.`);
    const file = await readWindow(guard, args.path, offset, limit, signal, {
      maxChars,
      allowGrowth: true,
    }).catch((error) => {
      // Deleted between the check and the read.
      if (entryDisappeared(error)) throw missing();
      throw error;
    });
    const deferClippedLine = file.lineClipped && file.selected.length > 1;
    const selected = deferClippedLine ? file.selected.slice(0, -1) : file.selected;
    const end = selected.at(-1)?.line;
    const ref =
      end && (!isAbsolute(file.target.relative) || parseLineRef(`${file.target.relative}#L${offset}-L${end}`))
        ? formatLineRef({ path: file.target.relative, start: offset, end })
        : undefined;
    guard.assertAuthorized();
    ctx.lastReads.set(file.target.key, { sha256: file.sha256, mtimeMs: file.mtimeMs });
    return {
      text: selected.map((line) => `${line.line}: ${line.text}`).join("\n"),
      ...(isAbsolute(file.target.relative) ? { path: file.target.relative } : {}),
      totalLines: file.totalLines,
      truncated: file.truncated,
      ...(file.lineClipped && !deferClippedLine ? { lineClipped: true } : {}),
      ...(file.growing ? { growing: true } : {}),
      ...(end !== undefined && end < file.totalLines ? { nextOffset: end + 1 } : {}),
      ...(ref ? { ref } : {}),
    };
  },
};
