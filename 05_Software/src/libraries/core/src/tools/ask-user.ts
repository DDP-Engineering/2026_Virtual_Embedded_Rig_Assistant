import { type QuestionInput, type QuestionOutcome, questionInputSchema } from "@vera/shared";
import type { ToolDefinition } from "./context.js";

export type AskUser = (input: QuestionInput, callId: string, signal: AbortSignal) => Promise<QuestionOutcome>;

export const askUserTool: ToolDefinition = {
  name: "ask_user",
  class: "session",
  description:
    "Pause this session to ask for a clarification or decision. Supply the question and 2–8 choices. Set aboutPlan to true to request a decision about the current nonempty plan. Optionally provide the one-based integer of the recommended choice. The user may select a choice, write a different answer, or cancel. A workbench may apply the recommendation after a timeout. A reply never grants permissions or approves an operation. Seek authorization using the actual operation's approval flow.",
  params: questionInputSchema,
  available: (ctx) => !!ctx.askUser,
  async execute(ctx, input, signal, callId) {
    if (!ctx.askUser || !callId) throw Error("Interactive clarification is unavailable.");
    return ctx.askUser(questionInputSchema.parse(input), callId, signal);
  },
};
