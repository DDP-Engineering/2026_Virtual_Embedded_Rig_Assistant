import type { LlmEvent, LlmGateway } from "@vera/core";

/** Replay already holds each response in memory. Scrub after interpolation, before runtime input. */
export function scrubReplayOutput(gateway: LlmGateway, scrub: (text: string) => string): LlmGateway {
  return {
    selectedModel: (provider) => gateway.selectedModel(provider),
    capabilities: (reference, output) => gateway.capabilities(reference, output),
    models: (provider, signal, probe) => gateway.models(provider, signal, probe),
    async *stream(request) {
      let text: string[] = [];
      const tools = new Map<number, string[]>();
      for await (const event of gateway.stream(request)) {
        if (event.type === "text") text.push(event.delta);
        else if (event.type === "tool") {
          const chunks = tools.get(event.index) ?? [];
          chunks.push(event.delta);
          tools.set(event.index, chunks);
        } else {
          // Complete values cover credentials assembled by bindings or split across source deltas.
          if (text.length) yield { type: "text", delta: scrub(text.join("")), sourceDeltas: text.length };
          for (const [index, chunks] of tools) yield { type: "tool", index, delta: scrub(chunks.join("")) };
          // Canonical serialization protects decoded final/partial text, arguments and diagnostics.
          yield JSON.parse(scrub(JSON.stringify(event))) as LlmEvent;
          text = [];
          tools.clear();
        }
      }
    },
  };
}
