import { z } from "zod";

export const questionTimeoutLimits = { min: 1, max: 1440, initial: 5 } as const;
export const questionTimeoutMinutesSchema = z
  .number()
  .int()
  .min(questionTimeoutLimits.min)
  .max(questionTimeoutLimits.max)
  .nullable();

const questionText = z.string().trim().min(1).max(1000);
const choiceText = z.string().trim().min(1).max(300);
const answerText = z.string().trim().min(1).max(2000);
const choiceNumber = z.number().int().min(1).max(8);
export const questionIdSchema = z.string().regex(/^q_[0-9A-HJKMNP-TV-Z]{26}$/);

export const questionInputSchema = z.strictObject({
  question: questionText,
  choices: z.array(choiceText).min(2).max(8),
  recommended: z.unknown().optional().describe("One-based number of the recommended choice, if any"),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const questionRequestSchema = questionInputSchema
  .extend({
    questionId: questionIdSchema,
    callId: z.string().min(1),
    turnId: z.string().min(1),
    recommended: choiceNumber.nullable(),
    deadline: z.iso.datetime().nullable(),
  })
  .refine(({ recommended, choices, deadline }) =>
    recommended === null ? deadline === null : recommended <= choices.length,
  );
export type QuestionRequest = z.infer<typeof questionRequestSchema>;

export const questionReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("choice"), choice: choiceNumber }),
  z.strictObject({ kind: z.literal("text"), text: answerText }),
  z.strictObject({ kind: z.literal("cancel") }),
]);
export type QuestionReply = z.infer<typeof questionReplySchema>;

export const questionOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("choice"),
    choice: choiceNumber,
    answer: choiceText,
    source: z.enum(["user", "automatic"]),
  }),
  z.strictObject({ kind: z.literal("text"), answer: answerText, source: z.literal("user") }),
  z.strictObject({ kind: z.literal("cancelled"), source: z.enum(["user", "stopped"]) }),
]);
export type QuestionOutcome = z.infer<typeof questionOutcomeSchema>;

export const sessionQuestionSchema = questionRequestSchema.safeExtend({
  outcome: questionOutcomeSchema.nullable(),
});
export type SessionQuestion = z.infer<typeof sessionQuestionSchema>;

/** Apply content masking without changing identifiers, choice positions, or source. */
export function maskQuestionRequest(
  request: QuestionRequest,
  scrub: (text: string) => string,
): QuestionRequest {
  return {
    ...request,
    question: masked(request.question, scrub, 1000),
    choices: request.choices.map((choice) => masked(choice, scrub, 300)),
  };
}

export function maskQuestionOutcome(
  outcome: QuestionOutcome,
  scrub: (text: string) => string,
): QuestionOutcome {
  return "answer" in outcome
    ? { ...outcome, answer: masked(outcome.answer, scrub, outcome.kind === "choice" ? 300 : 2000) }
    : outcome;
}

function masked(value: string, scrub: (text: string) => string, max: number): string {
  return scrub(value).slice(0, max).trim() || "[REDACTED]";
}
