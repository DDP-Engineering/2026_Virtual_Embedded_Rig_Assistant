import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { binaryDocumentKinds, type DocumentKind, isDocumentKindIn } from "@vera/shared";
import { isBinary } from "../tools/binary.js";
import { sourceLimit } from "./kinds.js";

export interface InspectInput {
  root: string;
  path: string;
  kind: Exclude<DocumentKind, "other">;
  /** The file identity main saw before asking; another identity means the file was replaced. */
  identity: { ino: number; dev: number };
  signal: AbortSignal;
}
export type SourceInspection = { status: "changed" } | { status: "ok"; sha256: string; binary: boolean };

/**
 * Streams the SHA-256 of an ordinary source opened without following links. A replaced file, a
 * read beyond the kind's limit or a change of size or times during the read report "changed".
 * Runs in the desktop indexer process.
 */
export async function inspectSource(input: InspectInput): Promise<SourceInspection> {
  const handle = await open(join(input.root, input.path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  let binary = false;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== input.identity.ino || opened.dev !== input.identity.dev)
      return { status: "changed" };
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      input.signal.throwIfAborted();
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      if (bytes === 0 && !isDocumentKindIn(input.kind, binaryDocumentKinds))
        binary = isBinary(buffer.subarray(0, read.bytesRead));
      bytes += read.bytesRead;
      if (bytes > sourceLimit(input.kind)) return { status: "changed" };
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
      return { status: "changed" };
  } finally {
    await handle.close();
  }
  return { status: "ok", sha256: hash.digest("hex"), binary };
}
