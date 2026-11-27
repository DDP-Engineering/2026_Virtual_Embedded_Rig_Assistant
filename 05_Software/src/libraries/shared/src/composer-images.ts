import { z } from "zod";
import { advancedSettings } from "./advanced-settings.js";

export const DEFAULT_IMAGE_FILE_BYTES = advancedSettings.imageFileMB.default * 1024 * 1024;
export const MAX_IMAGE_FILE_BYTES = advancedSettings.imageFileMB.max * 1024 * 1024;
export const COMPOSER_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp";
export const WORKBENCH_IMAGE_DRAG = "application/x-vera-workbench-image";

const formats = ["png", "jpeg", "gif", "webp"] as const;
export const rasterFormatSchema = z.enum(formats);
export type RasterFormat = z.infer<typeof rasterFormatSchema>;

export function rasterExtension(name: string): RasterFormat | undefined {
  const extension = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase();
  return formats.find((format) => format === (extension === "jpg" ? "jpeg" : extension));
}

export function rasterSignature(bytes: Uint8Array): RasterFormat | undefined {
  const at = (offset: number, signature: readonly number[]) =>
    signature.every((value, index) => bytes[offset + index] === value);
  if (at(0, [137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (at(0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (at(0, [71, 73, 70, 56]) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97) return "gif";
  if (at(0, [82, 73, 70, 70]) && at(8, [87, 69, 66, 80])) return "webp";
}

/** Allows unnamed clipboard payloads and checks any supplied filename extension against the bytes. */
export function composerRasterFormat(name: string, bytes: Uint8Array, requireExtension: boolean) {
  const signature = rasterSignature(bytes);
  return requireExtension || /\.[^./\\]+$/.test(name)
    ? rasterExtension(name) === signature
      ? signature
      : undefined
    : signature;
}

const printable = (value: string) =>
  [...value].every((character) => character >= " " && character !== "\u007f");

export const composerImageSourceSchema = z.union([
  z.strictObject({
    name: z
      .string()
      .max(255)
      .refine((value) => printable(value) && !/[\\/]/.test(value)),
    data: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MAX_IMAGE_FILE_BYTES / 3))
      .pipe(z.base64()),
  }),
  z.strictObject({
    path: z.string().min(1).max(4096).refine(printable),
  }),
]);
export type ComposerImageSource = z.infer<typeof composerImageSourceSchema>;

export const composerImageSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  name: z.string().min(1).max(255),
  thumbnail: z
    .base64()
    .min(4)
    .max(128 * 1024),
});
export type ComposerImage = z.infer<typeof composerImageSchema>;
