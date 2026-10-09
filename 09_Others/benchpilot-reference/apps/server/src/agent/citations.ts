// Evidence citations (04 §6): after each assistant message, every [[ev:…]] is resolved with the same resolver as
// GET /evidence; message.done carries {ref, valid}. Invalid refs render as warning chips (05).
import { extractCitations, type Citation } from "@benchpilot/shared";
import type { Db } from "../db/index.ts";
import { resolveEvidence } from "../evidence/resolve.ts";

export function validateCitations(db: Db, text: string): Citation[] {
  return extractCitations(text).map((ref) => ({ ref, valid: resolveEvidence(db, ref) !== null }));
}
