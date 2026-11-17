import { DOCS_BYTE_WINDOW_LIMIT, type ViewerContent, veraError } from "@vera/shared";
import { api } from "../../api/index.js";

const TEXT_LIMIT = 5 * 1024 * 1024;

/** Current small-file text loading; large-file indexing/window navigation belongs to VIEW-03. */
export async function readTextFile(
  workbenchId: string,
  path: string,
  existing?: Extract<ViewerContent, { kind: "text" }>,
) {
  const stat = await api.invoke("docs.stat", { workbenchId, path });
  if (stat.workbenchId !== workbenchId) throw veraError("CONFLICT");
  const { properties } = stat;
  if (properties.type !== "file" || properties.size === null) throw veraError("INVALID");
  if (properties.size > TEXT_LIMIT) {
    if (existing) return { workbenchId, content: existing, textBytes: undefined };
    throw { code: "INVALID", messageKey: "documents.textTooLarge" };
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
  const content: Extract<ViewerContent, { kind: "text" }> = existing ?? {
    kind: "text",
    path,
    displayPath: properties.displayPath ?? properties.path,
    ref: null,
    snippet: "",
    lines: [],
    start: 1,
    end: 1,
  };
  return { workbenchId, content, textBytes: bytes };
}
