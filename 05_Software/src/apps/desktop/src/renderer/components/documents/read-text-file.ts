import { DOCS_BYTE_WINDOW_LIMIT, type ViewerContent, veraError } from "@vera/shared";
import { api } from "../../api/index.js";
import { type LargeTextFile, LargeTextSource } from "./large-text-source.js";
import { detectTextEncoding } from "./text-encoding.js";

const TEXT_LIMIT = 5 * 1024 * 1024;

/** Ordinary text uses bounded assembly for small files and a transient window source for large ones. */
export async function readTextFile(
  workbenchId: string,
  path: string,
  existing?: Extract<ViewerContent, { kind: "text" }>,
) {
  const stat = await api.invoke("docs.stat", { workbenchId, path });
  if (stat.workbenchId !== workbenchId) throw veraError("CONFLICT");
  const { properties } = stat;
  if (properties.type !== "file" || properties.size === null) throw veraError("INVALID");
  if (
    existing?.byteSource &&
    (existing.byteSource.size !== properties.size || existing.byteSource.modified !== properties.modified)
  )
    throw veraError("CONFLICT");
  const content: Extract<ViewerContent, { kind: "text" }> = {
    ...(existing ?? {
      kind: "text",
      path,
      displayPath: properties.displayPath ?? properties.path,
      ref: null,
      snippet: "",
      start: 1,
      end: 1,
    }),
    lines: [],
  };
  if (properties.size > TEXT_LIMIT) {
    const largeText: LargeTextFile = {
      workbenchId,
      path: properties.path,
      size: properties.size,
      modified: properties.modified,
      encoding: "utf-8",
    };
    if (existing?.byteSource) {
      const verified = existing.byteSource;
      largeText.verified = { revision: verified.revision, lines: verified.lines, utf8Log: verified.utf8Log };
      return { workbenchId, content, textBytes: undefined, largeText };
    }
    const source = new LargeTextSource(largeText);
    const signal = new AbortController().signal;
    try {
      largeText.encoding = detectTextEncoding(await source.read(0, 4, signal));
      await source.verify(signal);
    } finally {
      source.dispose();
    }
    return { workbenchId, content, textBytes: undefined, largeText };
  }
  const bytes = new Uint8Array(properties.size);
  // Even an empty file is read so a change after stat cannot silently produce an empty view.
  for (let offset = 0; offset < Math.max(1, bytes.length); offset += DOCS_BYTE_WINDOW_LIMIT) {
    const length = Math.min(DOCS_BYTE_WINDOW_LIMIT, Math.max(1, bytes.length - offset));
    const reply = await api.invoke("docs.readBytes", { workbenchId, path: properties.path, offset, length });
    if (
      reply.workbenchId !== workbenchId ||
      reply.path !== properties.path ||
      reply.offset !== offset ||
      reply.size !== bytes.length
    )
      throw veraError("CONFLICT");
    const part = Uint8Array.from(atob(reply.data), (char) => char.charCodeAt(0));
    if (part.length !== Math.min(length, bytes.length - offset)) throw veraError("CONFLICT");
    bytes.set(part, offset);
  }
  const after = await api.invoke("docs.stat", { workbenchId, path: properties.path });
  if (
    after.workbenchId !== workbenchId ||
    after.properties.path !== properties.path ||
    after.properties.type !== "file" ||
    after.properties.size !== properties.size ||
    after.properties.modified !== properties.modified
  )
    throw veraError("CONFLICT");
  return { workbenchId, content, textBytes: bytes, largeText: undefined };
}
