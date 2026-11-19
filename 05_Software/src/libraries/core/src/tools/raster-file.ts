import type { ImageContent } from "@earendil-works/pi-ai";
import { MAX_MESSAGE_IMAGE_BYTES, rasterSignature, veraError } from "@vera/shared";
import type { PathGuard } from "../workbench/path-guard.js";
import { FileReadLimitError, readGuardedFile } from "./files.js";

const maxSide = 2048;

/** Prepare a confined raster for the model using the chat image limits. */
export async function readRasterFile(
  guard: Promise<PathGuard>,
  path: string,
  signal: AbortSignal,
): Promise<ImageContent> {
  let bytes: Buffer;
  try {
    ({ bytes } = await readGuardedFile(await guard, path, MAX_MESSAGE_IMAGE_BYTES, signal));
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FileReadLimitError) throw veraError("IMAGE_TOO_LARGE");
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw veraError("NOT_FOUND");
    throw veraError("DENIED");
  }
  if (/\.svgz?$/i.test(path)) throw veraError("IMAGE_FORMAT");
  const format = rasterSignature(bytes);
  if (!format) throw veraError("IMAGE_FORMAT");
  const { default: sharp } = await import("sharp");
  try {
    const image = sharp(bytes, { failOn: "warning" });
    if ((await image.metadata()).format !== format) throw veraError("IMAGE_FORMAT");
    const scaled = await image
      .autoOrient()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .toFormat(format)
      .toBuffer();
    return { type: "image", mimeType: `image/${format}`, data: scaled.toString("base64") };
  } catch {
    throw veraError("IMAGE_FORMAT");
  } finally {
    signal.throwIfAborted();
  }
}
