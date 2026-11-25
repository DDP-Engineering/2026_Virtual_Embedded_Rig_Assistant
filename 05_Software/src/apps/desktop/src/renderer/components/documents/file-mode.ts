import { type DocsEntryProperties, type RasterFormat, veraError, viewerExtensionKind } from "@vera/shared";
import { z } from "zod";
import { api } from "../../api/index.js";
import { readHexFile } from "./hex-source.js";
import { type ImageFile, imageMime } from "./image-source.js";
import { readTextFile } from "./read-text-file.js";
import { detectTextEncoding } from "./text-encoding.js";

export const fileModeSchema = z.enum(["rendered", "text", "hex"]);
export type FileMode = z.infer<typeof fileModeSchema>;
export interface FileModeInfo {
  extension: string;
  modes: FileMode[];
  mode: FileMode;
}
const storageKey = "vera.viewer.modes";
const preferencesSchema = z.strictObject({
  version: z.literal(1),
  extensions: z.record(z.string().max(4096), fileModeSchema),
});
function preferences(storage: Pick<Storage, "getItem">) {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(storage.getItem(storageKey) ?? "null"));
    return parsed.success ? parsed.data.extensions : {};
  } catch {
    return {};
  }
}
export function rememberFileMode(
  storage: Pick<Storage, "getItem" | "setItem">,
  extension: string,
  mode: FileMode,
) {
  try {
    storage.setItem(
      storageKey,
      JSON.stringify({ version: 1, extensions: { ...preferences(storage), [extension]: mode } }),
    );
  } catch {
    // Storage denial leaves this tab's deliberate choice usable for the current run.
  }
}
export function resolveFileMode(
  storage: Pick<Storage, "getItem">,
  extension: string,
  deliberate?: FileMode,
  binary = false,
  renderedAvailable = true,
): FileModeInfo {
  const kind = viewerExtensionKind(extension);
  const rendered = kind === "image" || (kind === "rendered" && renderedAvailable);
  const modes: FileMode[] = rendered ? ["rendered", "text", "hex"] : ["text", "hex"];
  const preferred = deliberate ?? preferences(storage)[extension];
  const fallback = rendered
    ? "rendered"
    : (viewerExtensionKind(extension) === "text" ||
          [".md", ".markdown", ".html", ".htm"].includes(extension)) &&
        !binary
      ? "text"
      : "hex";
  return { extension, modes, mode: preferred && modes.includes(preferred) ? preferred : fallback };
}

/** Only plain file targets enter here; citations keep their verified content and range loader. */
export async function readFileMode(
  workbenchId: string,
  path: string,
  requestId: string,
  deliberate?: FileMode,
  onInfo?: (info: FileModeInfo) => void,
  imageFormat?: RasterFormat,
) {
  const stat = await api.invoke("docs.stat", { workbenchId, path });
  const properties: DocsEntryProperties = stat.properties;
  if (stat.workbenchId !== workbenchId) throw veraError("CONFLICT");
  if (properties.type !== "file" || properties.size === null || properties.extension === undefined)
    throw veraError("INVALID");
  const extension =
    imageFormat && viewerExtensionKind(properties.extension) !== "image"
      ? `.${imageFormat}`
      : properties.extension;
  let binary = false;
  // A fixed prefix decides text or binary. Unknown names are sniffed too: Makefile, Kconfig, linker
  // scripts, device trees and map files are text an engineer reads, not hex.
  const unknown = viewerExtensionKind(extension) === "unknown";
  if (
    unknown ||
    viewerExtensionKind(extension) === "text" ||
    [".md", ".markdown", ".html", ".htm"].includes(extension)
  ) {
    const reply = await api.invoke("docs.readBytes", {
      workbenchId,
      path: properties.path,
      offset: 0,
      length: 4096,
    });
    if (
      reply.workbenchId !== workbenchId ||
      reply.path !== properties.path ||
      reply.offset !== 0 ||
      reply.size !== properties.size
    )
      throw veraError("CONFLICT");
    const bytes = Uint8Array.from(atob(reply.data), (char) => char.charCodeAt(0));
    if (bytes.length !== Math.min(4096, properties.size)) throw veraError("CONFLICT");
    const text = new TextDecoder(detectTextEncoding(bytes)).decode(bytes, { stream: true });
    binary = Array.from(text).some((char) => {
      const code = char.charCodeAt(0);
      // ESC is text: build and serial logs carry ANSI colour codes.
      return code < 9 || (code > 13 && code < 32 && code !== 27);
    });
  }
  const modeInfo = resolveFileMode(localStorage, extension, deliberate, binary, properties.rendered === true);
  if (unknown && !binary && deliberate === undefined && !preferences(localStorage)[extension])
    modeInfo.mode = "text";
  // Binary Markdown/HTML has no meaningful automatic rendered view.
  if (binary && deliberate === undefined && !preferences(localStorage)[extension]) modeInfo.mode = "hex";
  onInfo?.(modeInfo);
  if (modeInfo.mode === "rendered" && viewerExtensionKind(extension) === "image") {
    const result = await readHexFile(workbenchId, path);
    const imageFile: ImageFile = {
      ...result.hexFile,
      mime: imageMime(imageFormat ? `.${imageFormat}` : extension),
    };
    return { workbenchId, content: result.content, imageFile, modeInfo };
  }
  let result =
    modeInfo.mode === "hex"
      ? await readHexFile(workbenchId, path)
      : modeInfo.mode === "text"
        ? await readTextFile(workbenchId, path)
        : await api.invoke("docs.open", { workbenchId, path, requestId });
  if (modeInfo.mode === "rendered" && result.content.kind === "text") {
    if (
      result.workbenchId !== workbenchId ||
      ((!("requestId" in result) || result.requestId !== requestId) && result.content.path !== path)
    )
      throw veraError("NOT_FOUND");
    const text = await readTextFile(workbenchId, path, result.content);
    result = { ...result, ...text };
  }
  return { ...result, modeInfo };
}
