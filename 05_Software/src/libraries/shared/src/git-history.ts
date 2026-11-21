import { z } from "zod";
import { documentIndexScopeSchema } from "./documents.js";

const path = z.string().min(1).max(8192);
export const gitHistoryRequestSchema = documentIndexScopeSchema.extend({ path });
export const gitHistoryEligibilitySchema = z.enum(["tracked", "untracked", "unavailable"]);
export type GitHistoryEligibility = z.infer<typeof gitHistoryEligibilitySchema>;

export const gitHistoryEligibilityResponseSchema = gitHistoryRequestSchema.extend({
  eligibility: gitHistoryEligibilitySchema,
});

export const GIT_HISTORY_PAGE_SIZE = 50;
export const GIT_HISTORY_AUTHOR_LIMIT = 256;
export const GIT_HISTORY_SUBJECT_LIMIT = 1024;

const commit = z.strictObject({
  hash: z.string().regex(/^[0-9a-f]{12}$/),
  author: z.string().max(GIT_HISTORY_AUTHOR_LIMIT),
  date: z.iso.datetime(),
  subject: z.string().max(GIT_HISTORY_SUBJECT_LIMIT),
});
export type GitHistoryCommit = z.infer<typeof commit>;

export const gitHistoryResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"),
    commits: z.array(commit).min(1).max(GIT_HISTORY_PAGE_SIZE),
    capped: z.boolean(),
    scopeBoundary: z.boolean(),
  }),
  z.strictObject({ state: z.literal("empty"), scopeBoundary: z.boolean() }),
  z.strictObject({ state: z.enum(["unborn", "unavailable", "malformed", "read-limit"]) }),
]);
export type GitHistoryResult = z.infer<typeof gitHistoryResultSchema>;

export const gitHistoryResponseSchema = gitHistoryRequestSchema.extend({
  displayPath: path,
  result: gitHistoryResultSchema,
});
export type GitHistoryResponse = z.infer<typeof gitHistoryResponseSchema>;
