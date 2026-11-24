import {
  type QuestionInput,
  type QuestionOutcome,
  type QuestionReply,
  type QuestionRequest,
  veraError,
} from "@vera/shared";
import { ulid } from "ulid";

interface Pending {
  request: QuestionRequest;
  expires: () => boolean;
  settle(outcome: QuestionOutcome): boolean;
}

/** One current question per session. Its timer is owned by the turn, independent of subscribers. */
export class Questions {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number) {}

  id(sessionId: string): string | undefined {
    return this.current(sessionId)?.questionId;
  }

  current(sessionId: string): QuestionRequest | undefined {
    return this.pending.get(sessionId)?.request;
  }

  ask(
    sessionId: string,
    turnId: string,
    callId: string,
    input: QuestionInput,
    minutes: number | null,
    signal: AbortSignal,
    requested: (request: QuestionRequest) => void,
    settled: (request: QuestionRequest, outcome: QuestionOutcome) => void,
  ): Promise<QuestionOutcome> {
    signal.throwIfAborted();
    if (this.pending.has(sessionId)) throw veraError("BUSY");
    const recommendation = input.recommended;
    const recommended =
      typeof recommendation === "number" &&
      Number.isInteger(recommendation) &&
      recommendation >= 1 &&
      recommendation <= input.choices.length
        ? recommendation
        : null;
    const automatic = recommended === null ? undefined : input.choices[recommended - 1];
    const expiry = automatic === undefined || minutes === null ? null : this.now() + minutes * 60_000;
    const request: QuestionRequest = {
      questionId: `q_${ulid()}`,
      callId,
      turnId,
      question: input.question,
      choices: input.choices,
      ...(input.aboutPlan && { aboutPlan: true as const }),
      recommended,
      deadline: expiry === null ? null : new Date(expiry).toISOString(),
    };
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.pending.delete(sessionId);
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      };
      const settle = (outcome: QuestionOutcome) => {
        if (this.pending.get(sessionId)?.request !== request) return false;
        cleanup();
        try {
          settled(request, outcome);
          resolve(outcome);
          return true;
        } catch (error) {
          reject(error);
          return false;
        }
      };
      const stop = () => settle({ kind: "cancelled", source: "stopped" });
      const expire = () => {
        if (expiry === null || recommended === null || automatic === undefined || this.now() < expiry)
          return false;
        settle({ kind: "choice", choice: recommended, answer: automatic, source: "automatic" });
        return true;
      };
      const wake = () => {
        if (!expire() && expiry !== null) timer = setTimeout(wake, Math.max(0, expiry - this.now()));
      };
      this.pending.set(sessionId, { request, expires: expire, settle });
      signal.addEventListener("abort", stop, { once: true });
      try {
        requested(request);
        if (this.pending.get(sessionId)?.request === request) wake();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  answer(sessionId: string, questionId: string, reply: QuestionReply): void {
    const pending = this.pending.get(sessionId);
    if (!pending || pending.request.questionId !== questionId || pending.expires())
      throw veraError("CONFLICT");
    let outcome: QuestionOutcome;
    if (reply.kind === "choice") {
      const answer = pending.request.choices[reply.choice - 1];
      if (answer === undefined) throw veraError("INVALID");
      outcome = { kind: "choice", choice: reply.choice, answer, source: "user" };
    } else if (reply.kind === "text") {
      outcome = { kind: "text", answer: reply.text, source: "user" };
    } else {
      outcome = { kind: "cancelled", source: "user" };
    }
    if (!pending.settle(outcome)) throw veraError("INTERNAL");
  }
}
