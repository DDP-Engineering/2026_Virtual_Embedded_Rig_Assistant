import { addAbortListener } from "node:events";
import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import { rasterSignature, veraError } from "@vera/shared";
import type { PathGuard } from "../workbench/path-guard.js";
import { FileReadLimitError, readGuardedFile } from "./files.js";

const maxSide = 2048;

interface PreparedRaster {
  image: ImageContent;
  revision: string;
}

function fileRevision(key: string, stat: Stats): string {
  return JSON.stringify([key, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
}

/** Prepare a confined raster for the model using the chat image limits. */
export async function readRasterFile(
  guard: Promise<PathGuard>,
  path: string,
  signal: AbortSignal,
  maxBytes: number,
  cached?: PreparedRaster,
): Promise<PreparedRaster> {
  let bytes: Buffer;
  let revision: string;
  try {
    const pathGuard = await guard;
    signal.throwIfAborted();
    if (cached) {
      const target = await pathGuard.resolve(path);
      const stat = await lstat(target.absolute);
      signal.throwIfAborted();
      if (stat.isFile() && stat.size <= maxBytes && fileRevision(target.key, stat) === cached.revision) {
        pathGuard.assertAuthorized();
        return cached;
      }
    }
    const file = await readGuardedFile(pathGuard, path, maxBytes, signal);
    bytes = file.bytes;
    revision = fileRevision(file.target.key, file.stat);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FileReadLimitError)
      throw { ...veraError("IMAGE_TOO_LARGE"), params: { maxMB: maxBytes / (1024 * 1024) } };
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw veraError("NOT_FOUND");
    throw veraError("DENIED");
  }
  if (/\.svgz?$/i.test(path)) throw veraError("IMAGE_FORMAT");
  const format = rasterSignature(bytes);
  if (!format) throw veraError("IMAGE_FORMAT");
  const decode = async (): Promise<PreparedRaster> => {
    const { default: sharp } = await import("sharp");
    signal.throwIfAborted();
    const image = sharp(bytes, { failOn: "warning" });
    if ((await image.metadata()).format !== format) throw veraError("IMAGE_FORMAT");
    signal.throwIfAborted();
    const scaled = await image
      .autoOrient()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .toFormat(format)
      .toBuffer();
    signal.throwIfAborted();
    return {
      revision,
      image: { type: "image", mimeType: `image/${format}`, data: scaled.toString("base64") },
    };
  };
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  try {
    return await Promise.race([
      decode(),
      new Promise<never>((_resolve, reject) => {
        subscription = addAbortListener(signal, () => reject(signal.reason));
      }),
    ]);
  } catch {
    signal.throwIfAborted();
    throw veraError("IMAGE_FORMAT");
  } finally {
    subscription?.[Symbol.dispose]();
  }
}
