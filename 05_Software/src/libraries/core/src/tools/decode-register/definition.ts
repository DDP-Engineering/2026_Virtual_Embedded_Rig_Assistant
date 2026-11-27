import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { posix } from "node:path";
import { decodeRegisterDefinitionSchema, formatLineRef } from "@vera/shared";
import { parseDocument } from "yaml";
import { PathGuard } from "../../workbench/path-guard.js";

export class DecodeFailure extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND" | "DENIED" | "CONFLICT",
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}
const changed = () =>
  new DecodeFailure(
    "CONFLICT",
    "source_changed",
    "Definition changed. Read the current file before decoding again.",
  );
const denied = () =>
  new DecodeFailure(
    "DENIED",
    "path_denied",
    "Choose an ordinary definition allowed by the current permission mode, outside VERA application data.",
  );
const MAX_BYTES = 1024 * 1024;

/** Linear JSON preflight: every valid definition has <=7 containers deep, <=5 keys
 * per object and <=512 array entries. Keep YAML's uniqueKeys pass bounded per map,
 * including duplicate keys that JSON.parse would otherwise discard. */
function boundedStructure(text: string): void {
  const stack: { object: boolean; count: number }[] = [];
  let quoted = false;
  const invalid = () =>
    new DecodeFailure("INVALID", "invalid_definition", "Use a bounded JSON register definition structure.");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === "\\") i++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      stack.push({ object: char === "{", count: 0 });
      if (stack.length > 8) throw invalid();
    } else if (char === "}" || char === "]") stack.pop();
    else {
      const current = stack.at(-1);
      if (current && ((current.object && char === ":") || (!current.object && char === ","))) {
        current.count++;
        if (current.count > (current.object ? 8 : 511)) throw invalid();
      }
    }
  }
}

/** Reads with host-selected scope; retains at most1MiB plus one overflow byte. */
export async function loadDefinition(
  root: string,
  path: string,
  expectedSha256: string | undefined,
  signal: AbortSignal,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
) {
  signal.throwIfAborted();
  let guard: PathGuard;
  let target: Awaited<ReturnType<PathGuard["resolve"]>>;
  let sourcePath = posix.normalize(path.replaceAll("\\", "/"));
  let local = true;
  try {
    guard = inputGuard ?? (await PathGuard.create(root, root, "workbench", undefined, excludedRoots));
    target = await guard.resolve(path);
    sourcePath = target.relative;
    local = !sourcePath.startsWith("/") && !/^[A-Za-z]:/.test(sourcePath);
    if (local) formatLineRef({ path: sourcePath, start: 1, end: 1 });
  } catch {
    throw denied();
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    if (!(await lstat(target.absolute)).isFile()) throw denied();
    handle = await open(target.absolute, "r");
  } catch (error) {
    if (error instanceof DecodeFailure) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new DecodeFailure("NOT_FOUND", "not_found", "Definition not found. Choose an existing file.");
    throw denied();
  }
  try {
    const before = await handle.stat();
    const checkIdentity = async () => {
      try {
        const current = await guard.resolve(path);
        const info = await lstat(current.absolute);
        if (
          current.key !== target.key ||
          !info.isFile() ||
          info.ino !== before.ino ||
          info.dev !== before.dev ||
          info.size !== before.size ||
          info.mtimeMs !== before.mtimeMs ||
          info.ctimeMs !== before.ctimeMs
        )
          throw changed();
      } catch {
        throw changed();
      }
    };
    await checkIdentity();
    if (!before.isFile()) throw denied();
    if (before.size > MAX_BYTES)
      throw new DecodeFailure("INVALID", "file_too_large", "Choose a definition no larger than 1 MiB.");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, size, Math.min(65536, bytes.length - size), size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await handle.stat();
    await checkIdentity();
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw changed();
    const data = bytes.subarray(0, size);
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) throw changed();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw new DecodeFailure("INVALID", "invalid_utf8", "Save the definition as UTF-8 JSON.");
    }
    boundedStructure(text);
    let raw: unknown;
    try {
      // Enforce JSON grammar before invoking YAML on untrusted input.
      raw = JSON.parse(text);
    } catch {
      throw new DecodeFailure("INVALID", "invalid_definition", "Use one valid JSON device definition.");
    }
    let document: ReturnType<typeof parseDocument>;
    try {
      document = parseDocument(text, { uniqueKeys: true });
    } catch {
      throw new DecodeFailure("INVALID", "invalid_definition", "Use one bounded JSON device definition.");
    }
    if (document.errors.some((error) => error.code === "DUPLICATE_KEY"))
      throw new DecodeFailure("INVALID", "duplicate_keys", "Remove duplicate JSON keys from the definition.");
    if (document.errors.length) {
      throw new DecodeFailure("INVALID", "invalid_definition", "Use one valid JSON device definition.");
    }
    const parsed = decodeRegisterDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
      // Name what is wrong and where: a definition is written by hand from a datasheet, and one general
      // sentence for every mistake left only guessing.
      const problems = parsed.error.issues
        .slice(0, 6)
        .map(
          (issue) =>
            `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message.replace(/\.$/, "")}`,
        );
      throw new DecodeFailure(
        "INVALID",
        "invalid_definition",
        `Correct the definition: ${problems.join("; ")}${parsed.error.issues.length > 6 ? `; and ${parsed.error.issues.length - 6} more` : ""}.`,
      );
    }
    signal.throwIfAborted();
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return {
      definition: parsed.data,
      source: {
        path: sourcePath,
        sha256,
        ref: local ? formatLineRef({ path: sourcePath, start: 1, end: lines }) : null,
      },
    };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DecodeFailure) throw error;
    throw denied();
  } finally {
    await handle.close();
  }
}
