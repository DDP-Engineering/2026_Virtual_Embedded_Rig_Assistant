import {
  type AppEvent,
  appEventSchema,
  type SessionEvent,
  sessionEventSchema,
  sessionSubscriptionSchema,
  type VeraBridge,
  veraError,
  type WorkbenchEvent,
  workbenchEventSchema,
  workbenchIdSchema,
} from "@vera/shared";

export function createSubscriptions(
  register: (topic: "app" | "workbench", id: string | undefined, on: (event: unknown) => void) => () => void,
  sessionRegister?: (id: string, sinceSeq: number, on: (event: SessionEvent) => void) => () => void,
): VeraBridge["subscribe"] {
  function subscribe(topic: "app", on: (event: AppEvent) => void): () => void;
  function subscribe(topic: "workbench", id: string, on: (event: WorkbenchEvent) => void): () => void;
  function subscribe(
    topic: "session",
    id: string,
    sinceSeq: number,
    on: (event: SessionEvent) => void,
  ): () => void;
  function subscribe(
    topic: "app" | "workbench" | "session",
    idOrOn: string | ((event: AppEvent) => void),
    onOrSeq?: ((event: WorkbenchEvent) => void) | number,
    sessionOn?: (event: SessionEvent) => void,
  ): () => void {
    if (topic === "session") {
      if (
        !sessionRegister ||
        !sessionSubscriptionSchema.safeParse({
          sessionId: idOrOn,
          sinceSeq: onOrSeq,
          subscriptionId: "renderer",
        }).success ||
        typeof idOrOn !== "string" ||
        typeof onOrSeq !== "number" ||
        typeof sessionOn !== "function"
      )
        throw veraError("INVALID");
      return sessionRegister(idOrOn, onOrSeq, (event) => {
        const parsed = sessionEventSchema.safeParse(event);
        if (parsed.success) sessionOn(parsed.data);
      });
    }
    const on = typeof onOrSeq === "function" ? onOrSeq : undefined;
    if (topic === "app" && typeof idOrOn === "function")
      return register("app", undefined, (event) => {
        const parsed = appEventSchema.safeParse(event);
        if (parsed.success) idOrOn(parsed.data);
      });
    if (
      topic === "workbench" &&
      typeof idOrOn === "string" &&
      workbenchIdSchema.safeParse(idOrOn).success &&
      typeof on === "function"
    )
      return register("workbench", idOrOn, (event) => {
        const parsed = workbenchEventSchema.safeParse(event);
        if (parsed.success) on(parsed.data);
      });
    throw veraError("INVALID");
  }
  return subscribe;
}
