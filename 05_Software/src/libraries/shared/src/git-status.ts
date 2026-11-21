import { z } from "zod";
import { documentIndexScopeSchema } from "./documents.js";

export const gitStatusRequestSchema = documentIndexScopeSchema.extend({
  viewId: z.uuid(),
  action: z.enum(["open", "refresh", "close"]),
});

const path = z.string().min(1).max(8192);
const badge = z.enum(["M", "?", "A", "R", "D"]);
const entry = z.strictObject({
  path,
  displayPath: path.optional(),
  staged: badge.nullable(),
  unstaged: badge.nullable(),
  conflict: z.boolean(),
  virtual: z.boolean(),
  rename: z.strictObject({ path, role: z.enum(["source", "destination"]) }).optional(),
});
export type GitStatusEntry = z.infer<typeof entry>;

export const gitStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"),
    branch: z.strictObject({
      kind: z.enum(["named", "unborn", "detached"]),
      name: z.string().min(1).max(4096),
    }),
    entries: z.array(entry).max(5000),
    changed: z.int().nonnegative().max(5000),
    conflicts: z.int().nonnegative().max(5000),
  }),
  z.strictObject({ state: z.enum(["no-repository", "missing-git", "unsupported", "failed"]) }),
]);
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitStatusOwner = Omit<z.infer<typeof gitStatusRequestSchema>, "action">;
export const gitStatusUpdateSchema = gitStatusRequestSchema.omit({ action: true }).extend({
  status: gitStatusSchema,
  watchLimited: z.boolean(),
});
export type GitStatusUpdate = z.infer<typeof gitStatusUpdateSchema>;
