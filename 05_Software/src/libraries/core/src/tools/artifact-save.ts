import { ARTIFACT_MAX_BYTES, portableArtifactName } from "@vera/shared";
import { z } from "zod";
import { exactIssuedLineCitations } from "../agent/citations.js";
import type { ToolDefinition } from "./context.js";

const invalidName =
  "Invalid artifact name. Use a file name of 1–100 ASCII letters, digits, dot, underscore or hyphen.";
/** What a storage refusal means for the model; the system's own text names absolute paths. */
const refusals: Record<string, string> = {
  CONFLICT: "The artifact changed while it was being saved. Save it again.",
  DENIED: "Artifact storage is not an ordinary folder, so nothing was saved. Tell the user.",
  INVALID: invalidName,
  NOT_FOUND: "The session's artifact storage is missing, so nothing was saved. Tell the user.",
};

export const artifactSaveTool: ToolDefinition = {
  name: "artifact_save",
  class: "session",
  description:
    "Save a UTF8 session artifact (up to 5 MiB) without changing workbench files. The result's ref names the artifact; an unportable name is saved under a portable one. Use overwrite:true only to replace an existing artifact.",
  params: z.strictObject({
    name: z.string().refine((name) => portableArtifactName(name) !== undefined, invalidName),
    content: z
      .string()
      .refine(
        (s) => Buffer.byteLength(s, "utf8") <= ARTIFACT_MAX_BYTES,
        "Artifact content exceeds the 5 MiB UTF8 limit.",
      ),
    description: z
      .string()
      .optional()
      .describe("A short description. Longer descriptions are shortened when saved."),
    overwrite: z.boolean().optional(),
    exactLineRefs: z
      .boolean()
      .optional()
      .describe(
        "Replace covered line subranges with the narrowest issued window from this turn. Leave other references unchanged.",
      ),
  }),
  async execute(ctx, raw, signal) {
    if (!ctx.artifacts) throw Error("Session artifact storage is unavailable.");
    const { exactLineRefs, ...args } = artifactSaveTool.params.parse(raw) as {
      name: string;
      content: string;
      description?: string;
      overwrite?: boolean;
      exactLineRefs?: boolean;
    };
    const requested = args.name;
    // A refused name costs the model the whole content again: spaces, accents and separators are replaced.
    args.name = portableArtifactName(requested) ?? requested;
    try {
      if (exactLineRefs && args.content.includes("[[")) {
        const issued = ctx.artifacts.issuedCitationRefs?.();
        if (issued?.size) {
          const normalized = exactIssuedLineCitations(args.content, issued);
          if (Buffer.byteLength(normalized, "utf8") <= ARTIFACT_MAX_BYTES) args.content = normalized;
        }
      }
      const result = await ctx.artifacts.store.save(ctx.artifacts, args, signal);
      const saved = result.ref.slice("artifact:".length);
      return saved === requested ? result : { ...result, savedAs: saved };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code !== "string") throw error;
      throw Error(
        refusals[code] ??
          (/^E[A-Z]+$/.test(code)
            ? `The artifact could not be saved (${code}). If it is open in another program, close it there and save again.`
            : `Artifact operation ${code}.`),
      );
    }
  },
};
