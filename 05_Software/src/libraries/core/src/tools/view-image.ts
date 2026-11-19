import { type VeraError, veraErrorSchema } from "@vera/shared";
import { z } from "zod";
import { PathGuard } from "../workbench/path-guard.js";
import { type ToolDefinition, toolExcludedRoots } from "./context.js";
import { readRasterFile } from "./raster-file.js";

const params = z.strictObject({ path: z.string().min(1) });

export const viewImageTool: ToolDefinition = {
  name: "view_image",
  class: "read",
  requiresImages: true,
  description:
    "Inspect a PNG, JPEG, GIF or WebP image in the workbench (up to 20 MiB). Supply a workbench-relative file path without links.",
  params,
  async execute(ctx, raw, signal) {
    const { path } = params.parse(raw);
    const relative = path.replaceAll("\\", "/");
    const sharedAttachment =
      relative.startsWith(".vera/attachments/") && ctx.hasDeliveredImage?.(relative) === true;
    const guard = PathGuard.create(ctx.root, ctx.root, "workbench", undefined, toolExcludedRoots(ctx), [], {
      refuseLinks: true,
      allowSessionAttachments: sharedAttachment,
    });
    try {
      const image = await readRasterFile(guard, path, signal);
      return { path, image };
    } catch (error) {
      signal.throwIfAborted();
      const parsed = veraErrorSchema.safeParse(error);
      if (!parsed.success) throw error;
      const explanations: Partial<Record<VeraError["code"], string>> = {
        DENIED: "Use an allowed workbench-relative path without links.",
        NOT_FOUND: "The image file was not found.",
        IMAGE_FORMAT: "Use a valid PNG, JPEG, GIF or WebP image.",
        IMAGE_TOO_LARGE: "Choose an image of at most 20 MiB.",
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
