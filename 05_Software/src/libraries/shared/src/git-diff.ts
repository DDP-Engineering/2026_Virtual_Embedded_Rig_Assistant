import { z } from "zod";
import { documentIndexScopeSchema } from "./documents.js";

const path = z.string().min(1).max(8192);
export const gitComparisonSchema = z.enum(["staged", "unstaged"]);
export type GitComparison = z.infer<typeof gitComparisonSchema>;

export const gitDiffRequestSchema = documentIndexScopeSchema.extend({
  path,
  comparison: gitComparisonSchema,
});

export const GIT_DIFF_PATCH_LIMIT = 256 * 1024;
export const GIT_DIFF_LINE_LIMIT = 4000;

const patch = z
  .string()
  .min(1)
  .max(GIT_DIFF_PATCH_LIMIT)
  .refine(
    (value) =>
      !value.includes("\0") && value.split("\n", GIT_DIFF_LINE_LIMIT + 1).length <= GIT_DIFF_LINE_LIMIT,
  );

const context = {
  base: z.enum(["head", "empty-tree", "index", "unknown"]),
  rename: z.strictObject({ from: path, to: path }).optional(),
};

export const gitDiffResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...context, state: z.literal("patch"), patch }),
  z.strictObject({ ...context, state: z.enum(["empty", "binary", "too-large", "conflict", "unavailable"]) }),
]);
export type GitDiffResult = z.infer<typeof gitDiffResultSchema>;

export const gitDiffResponseSchema = gitDiffRequestSchema
  .extend({
    displayPath: path,
    result: gitDiffResultSchema,
  })
  .refine(
    ({ comparison, result }) =>
      (comparison === "unstaged") === (result.base === "index") &&
      (result.base !== "unknown" || result.state === "unavailable"),
    { path: ["result", "base"] },
  );
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>;
