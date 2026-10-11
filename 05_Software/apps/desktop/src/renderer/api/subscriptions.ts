import {
  type AppEvent,
  appEventSchema,
  type VeraBridge,
  veraError,
  type WorkbenchEvent,
  workbenchEventSchema,
  workbenchIdSchema,
} from "@vera/shared";

export function createSubscriptions(
  register: (topic: "app" | "workbench", id: string | undefined, on: (event: unknown) => void) => () => void,
): VeraBridge["subscribe"] {
  function subscribe(topic: "app", on: (event: AppEvent) => void): () => void;
  function subscribe(topic: "workbench", id: string, on: (event: WorkbenchEvent) => void): () => void;
  function subscribe(
    topic: "app" | "workbench",
    idOrOn: string | ((event: AppEvent) => void),
    on?: (event: WorkbenchEvent) => void,
  ): () => void {
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
