export class LogFailure extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND" | "DENIED" | "CONFLICT" | "INTERNAL",
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}
