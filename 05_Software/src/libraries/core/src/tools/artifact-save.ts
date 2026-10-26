import { ARTIFACT_MAX_BYTES, validArtifactName } from "@vera/shared";
import { z } from "zod";
import type { ToolDefinition } from "./context.js";

export const artifactSaveTool: ToolDefinition = {
  name: "artifact_save",
  class: "session",
  description:
    "Save a UTF8 session artifact (up to5MiB) without changing workbench files. Use a portable filename, overwrite:true only to replace an existing artifact.",
  params: z.strictObject({
    name: z
      .string()
      .refine(
        validArtifactName,
        "Invalid artifact name. Use1–100 ASCII letters/digits/dot/underscore/hyphen and a portable file name.",
      ),
    content: z
      .string()
      .refine(
        (s) => Buffer.byteLength(s, "utf8") <= ARTIFACT_MAX_BYTES,
        "Artifact content exceeds the5MiB UTF8 limit.",
      ),
    description: z.string().optional(),
    overwrite: z.boolean().optional(),
  }),
  async execute(ctx, raw, signal) {
    if (!ctx.artifacts) throw Error("Session artifact storage is unavailable.");
    try {
      return await ctx.artifacts.store.save(
        ctx.artifacts,
        raw as { name: string; content: string; description?: string; overwrite?: boolean },
        signal,
      );
    } catch (error) {
      if (error instanceof Error) throw error;
      const code = (error as { code?: string }).code;
      throw Error(`Artifact operation ${code ?? "failed"}. Check the session and ordinary storage paths.`);
    }
  },
};
