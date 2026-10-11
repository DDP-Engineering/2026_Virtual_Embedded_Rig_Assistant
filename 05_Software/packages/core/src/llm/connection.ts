import type { ProviderTestResult, ProviderTestStep } from "@vera/shared";
import { veraError } from "@vera/shared";
import { mapProviderError } from "./errors.js";
import type { LlmGateway } from "./gateway.js";

const echoParameters = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
} as const;
function validEchoArguments(args: Record<string, unknown>): boolean {
  return (
    Object.keys(args).length === echoParameters.required.length &&
    echoParameters.required.every(
      (key) => Object.hasOwn(args, key) && typeof args[key] === echoParameters.properties[key].type,
    )
  );
}

export async function testConnection(
  gateway: LlmGateway,
  provider: string,
  model?: string,
  signal: AbortSignal = new AbortController().signal,
  now: () => number = Date.now,
  scrub: (text: string) => string = (text) => text,
): Promise<ProviderTestResult> {
  const steps: ProviderTestStep[] = [];
  try {
    const catalog = await gateway.models(provider, signal, true);
    steps.push({ step: "reachability", status: catalog.reachability });
  } catch (error) {
    steps.push({ step: "reachability", status: "fail", error: mapProviderError(error, scrub, "") });
  }
  let reference: string;
  try {
    reference = `${provider}/${model ?? gateway.selectedModel(provider)}`;
    gateway.capabilities(reference);
  } catch (error) {
    steps.push(
      { step: "authentication", status: "fail", error: mapProviderError(error, scrub, "") },
      { step: "tools", status: "skipped" },
      { step: "streaming", status: "skipped" },
    );
    return { steps };
  }
  for (const step of ["authentication", "tools", "streaming"] as const) {
    if (
      signal.aborted ||
      (step !== "authentication" && steps.find((s) => s.step === "authentication")?.status !== "pass")
    ) {
      steps.push({ step, status: "skipped" });
      continue;
    }
    let deltas = 0;
    let passed = false;
    let error: ProviderTestStep["error"];
    try {
      for await (const event of gateway.stream({
        model: reference,
        system: "Connection test.",
        messages: [
          {
            role: "user",
            content:
              step === "tools"
                ? "Call the echo tool with text OK."
                : step === "streaming"
                  ? "Write this complete sentence: This connection test confirms that streamed responses arrive incrementally."
                  : "Reply with OK.",
            timestamp: now(),
          },
        ],
        tools:
          step === "tools"
            ? [
                {
                  name: "echo",
                  description: "Echo text",
                  parameters: echoParameters,
                },
              ]
            : [],
        signal,
        maxOutputTokens: Math.min(256, gateway.capabilities(reference).maxOutputTokens),
      })) {
        if (event.type === "text" && event.delta)
          deltas = event.sourceDeltas === undefined ? deltas + 1 : Math.max(deltas, event.sourceDeltas);
        if (event.type === "error") error = mapProviderError(event.error, scrub, "");
        if (event.type === "done")
          passed =
            step === "tools"
              ? event.message.content.some(
                  (c) => c.type === "toolCall" && c.name === "echo" && validEchoArguments(c.arguments),
                )
              : step === "streaming"
                ? deltas > 1
                : event.message.content.some((c) => c.type === "text" && c.text.trim().length > 0);
      }
    } catch (failure) {
      error = mapProviderError(failure, scrub, "");
    }
    steps.push({
      step,
      status: passed && !error ? "pass" : "fail",
      ...(!passed || error ? { error: error ?? veraError("PROVIDER") } : {}),
    });
  }
  return { steps };
}
