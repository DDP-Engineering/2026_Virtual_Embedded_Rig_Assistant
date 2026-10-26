import { z } from "zod";
import { validArtifactName } from "./refs.js";
import { sessionIdSchema } from "./session.js";

export const ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
export const artifactIdSchema = z.string().regex(/^art_[0-9A-HJKMNP-TV-Z]{26}$/);
export const artifactNameSchema = z.string().refine(validArtifactName, "Invalid portable artifact name.");
export const artifactSummarySchema = z.strictObject({
  artifactId: artifactIdSchema,
  sessionId: sessionIdSchema,
  name: artifactNameSchema,
  mime: z.enum(["text/markdown", "text/plain"]),
  bytes: z.number().int().nonnegative().max(ARTIFACT_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const artifactContentSchema = artifactSummarySchema.extend({
  content: z.string().refine((s) => utf8Bytes(s) <= ARTIFACT_MAX_BYTES),
});
/** Shared has no DOM/Node dependency; count UTF8 bytes, including replacement surrogates. */
export function utf8Bytes(text: string): number {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;
export type ArtifactContent = z.infer<typeof artifactContentSchema>;
