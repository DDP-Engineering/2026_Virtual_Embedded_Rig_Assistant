import { type VeraError, veraErrorSchema } from "@vera/shared";
import { z } from "zod";
import { type ToolDefinition, toolLimit, toolPathGuard } from "./context.js";
import { readRasterFile } from "./raster-file.js";

const params = z.strictObject({ path: z.string().min(1) });

/** What to do with a picture that cannot be shown; a named format tells the user it is not damaged. */
function unsupported(found: unknown): string {
  const accepted = "PNG, JPEG, GIF, WebP, TIFF or BMP";
  return typeof found === "string" && found !== "unknown"
    ? `${found} pictures cannot be shown. Convert the file to PNG or JPEG.`
    : `The file is not a readable ${accepted} picture.`;
}

export const viewImageTool: ToolDefinition = {
  name: "view_image",
  class: "read",
  requiresImages: true,
  description: "Inspect a PNG, JPEG, GIF, WebP, TIFF or BMP image. Supply a file path as for read.",
  params,
  async execute(ctx, raw, signal) {
    const { path } = params.parse(raw);
    const maxMB = toolLimit(ctx, "imageFileMB");
    const relative = path.replaceAll("\\", "/");
    const sharedAttachment =
      relative.startsWith(".vera/attachments/") && ctx.hasDeliveredImage?.(relative) === true;
    // The scope read has: the workbench, the folders added to it and, in Bypass, the file system.
    const guard = toolPathGuard(ctx, true, { allowSessionAttachments: sharedAttachment });
    try {
      const { image } = await readRasterFile(guard, path, signal, maxMB * 1024 * 1024);
      return { path, image };
    } catch (error) {
      signal.throwIfAborted();
      const parsed = veraErrorSchema.safeParse(error);
      if (!parsed.success) throw error;
      const explanations: Partial<Record<VeraError["code"], string>> = {
        DENIED: "This path is not available. Use a file in the workbench or in a folder added to it.",
        NOT_FOUND: "The image file was not found.",
        IMAGE_FORMAT: unsupported(parsed.data.params?.found),
        IMAGE_TOO_LARGE: `Choose an image of at most ${maxMB} MiB.`,
      };
      const code = parsed.data.code;
      return {
        isError: true,
        code,
        error: explanations[code] ?? "Image read failed.",
      };
    }
  },
};
