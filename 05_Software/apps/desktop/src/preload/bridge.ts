import {
  type AppEvent,
  type Channel,
  channels,
  eventEnvelopeSchema,
  isChannel,
  type Request,
  type Response,
  resultSchema,
  type VeraBridge,
  veraError,
  type WorkbenchEvent,
  workbenchIdSchema,
} from "@vera/shared";

export interface BridgeTransport {
  invoke(channel: string, name: string, request: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

export function createBridge(transport: BridgeTransport): VeraBridge {
  function subscribe(topic: "app", on: (event: AppEvent) => void): () => void;
  function subscribe(topic: "workbench", id: string, on: (event: WorkbenchEvent) => void): () => void;
  function subscribe(
    topic: "app" | "workbench",
    idOrOn: string | ((event: AppEvent) => void),
    on?: (event: WorkbenchEvent) => void,
  ): () => void {
    if (
      (topic === "app" && typeof idOrOn !== "function") ||
      (topic === "workbench" && (!workbenchIdSchema.safeParse(idOrOn).success || typeof on !== "function")) ||
      (topic !== "app" && topic !== "workbench")
    )
      throw veraError("INVALID");
    let active = true;
    const listener = (_event: unknown, payload: unknown) => {
      if (!active) return;
      const envelope = eventEnvelopeSchema.safeParse(payload);
      if (!envelope.success) return;
      if (topic === "app" && envelope.data.topic === "app" && typeof idOrOn === "function")
        idOrOn(envelope.data.event);
      if (topic === "workbench" && envelope.data.topic === "workbench" && envelope.data.id === idOrOn)
        on?.(envelope.data.event);
    };
    transport.on("vera:event", listener);
    return () => {
      if (!active) return;
      active = false;
      transport.removeListener("vera:event", listener);
    };
  }
  return {
    async invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>> {
      if (!isChannel(channel)) throw veraError("NOT_FOUND");
      const parsed = channels[channel].request.safeParse(request);
      if (!parsed.success) throw veraError("INVALID");
      let result: unknown;
      try {
        result = await transport.invoke("vera:invoke", channel, parsed.data);
      } catch {
        throw veraError("INTERNAL");
      }
      const response = resultSchema(channel).safeParse(result);
      if (!response.success) throw veraError("INTERNAL");
      if (!response.data.ok) throw response.data.error;
      return response.data.value;
    },
    subscribe,
  };
}
