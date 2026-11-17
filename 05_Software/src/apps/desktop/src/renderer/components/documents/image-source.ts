import { HEX_WINDOW_BYTES, type HexFile, HexSource } from "./hex-source.js";
import { yieldTextScan } from "./large-text-source.js";

/** Transient metadata only; the mounted image view owns bytes and its Blob URL. */
export interface ImageFile extends HexFile {
  mime: string;
}
export function imageMime(extension: string) {
  return extension === ".svg"
    ? "image/svg+xml"
    : extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : `image/${extension.slice(1)}`;
}

/** Browser decoding needs the complete encoded resource; IPC and cancellation remain windowed. */
export async function readImageBlob(file: ImageFile, signal: AbortSignal) {
  const source = new HexSource(file);
  const parts: BlobPart[] = [];
  try {
    await source.verify(signal);
    for (let offset = 0; offset < Math.max(1, file.size); offset += HEX_WINDOW_BYTES) {
      const length = Math.min(HEX_WINDOW_BYTES, Math.max(1, file.size - offset));
      parts.push(new Uint8Array(await source.read(offset, length, signal)));
      await yieldTextScan(signal);
    }
    await source.verify(signal);
    return new Blob(parts, { type: file.mime });
  } finally {
    source.dispose();
  }
}
