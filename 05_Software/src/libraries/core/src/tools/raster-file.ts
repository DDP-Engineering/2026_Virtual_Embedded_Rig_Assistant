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
  const format = /\.svgz?$/i.test(path) ? undefined : rasterSignature(bytes);
  // TIFF and BMP are what instruments and layout tools save; they are sent to the model as PNG.
  const converted = format ? undefined : convertible(bytes);
  if (!format && !converted)
    throw { ...veraError("IMAGE_FORMAT"), params: { found: foundFormat(path, bytes) } };
  const decode = async (): Promise<PreparedRaster> => {
    const { default: sharp } = await import("sharp");
    signal.throwIfAborted();
    const bitmap = converted === "bmp" ? bitmapPixels(bytes) : undefined;
    if (converted === "bmp" && !bitmap) throw veraError("IMAGE_FORMAT");
    // A picture cut short by an interrupted transfer still shows what arrived; only unreadable data fails.
    const image = bitmap
      ? sharp(bitmap.data, { raw: { width: bitmap.width, height: bitmap.height, channels: bitmap.channels } })
      : sharp(bytes, { failOn: "none" });
    if (!bitmap && (await image.metadata()).format !== (format ?? converted)) throw veraError("IMAGE_FORMAT");
    signal.throwIfAborted();
    const output = format ?? "png";
    const scaled = await image
      .autoOrient()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .toFormat(output)
      .toBuffer();
    signal.throwIfAborted();
    return {
      revision,
      image: { type: "image", mimeType: `image/${output}`, data: scaled.toString("base64") },
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

const starts = (bytes: Uint8Array, offset: number, text: string) =>
  [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

function convertible(bytes: Uint8Array): "tiff" | "bmp" | undefined {
  if (starts(bytes, 0, "II*\0") || starts(bytes, 0, "MM\0*")) return "tiff";
  if (starts(bytes, 0, "BM")) return "bmp";
  return undefined;
}

/** The name of a picture format that cannot be shown, for a message that says what to convert. */
function foundFormat(path: string, bytes: Uint8Array): string {
  if (/\.svgz?$/i.test(path) || starts(bytes, 0, "<svg") || starts(bytes, 0, "<?xml")) return "SVG";
  if (starts(bytes, 4, "ftyp"))
    return ["heic", "heix", "hevc", "mif1", "heif"].some((brand) => starts(bytes, 8, brand))
      ? "HEIC"
      : starts(bytes, 8, "avif")
        ? "AVIF"
        : "unknown";
  if (starts(bytes, 0, "%PDF-")) return "PDF";
  return "unknown";
}

/**
 * The pixels of an uncompressed Windows bitmap with 8, 24 or 32 bits per pixel: what oscilloscopes and
 * logic analysers save as a screenshot. Anything else (compressed, 1 or 4 bits) is not decoded.
 */
function bitmapPixels(
  bytes: Buffer,
): { data: Buffer; width: number; height: number; channels: 3 | 4 } | undefined {
  if (bytes.length < 54) return undefined;
  const offset = bytes.readUInt32LE(10);
  const header = bytes.readUInt32LE(14);
  const width = bytes.readInt32LE(18);
  const signedHeight = bytes.readInt32LE(22);
  const bits = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);
  const height = Math.abs(signedHeight);
  if (header < 40 || width <= 0 || !height || width * height > 64_000_000) return undefined;
  if (![8, 24, 32].includes(bits) || !(compression === 0 || (compression === 3 && bits === 32)))
    return undefined;
  const stride = Math.ceil((width * bits) / 32) * 4;
  if (offset + stride * height > bytes.length) return undefined;
  const palette = 14 + header;
  const channels = bits === 32 ? 4 : 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    // Rows are stored bottom-up unless the height is negative.
    const row = offset + (signedHeight > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * channels;
      const source = bits === 8 ? palette + (bytes[row + x] ?? 0) * 4 : row + x * (bits / 8);
      data[target] = bytes[source + 2] ?? 0;
      data[target + 1] = bytes[source + 1] ?? 0;
      data[target + 2] = bytes[source] ?? 0;
      // The fourth byte of a 32-bit bitmap is often unused and zero: the picture is shown opaque.
      if (channels === 4) data[target + 3] = 255;
    }
  }
  return { data, width, height, channels };
}
