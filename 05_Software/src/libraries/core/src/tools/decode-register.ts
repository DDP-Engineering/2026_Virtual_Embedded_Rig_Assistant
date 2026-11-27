import { decodeRegisterArgsSchema, decodeRegisterResultSchema } from "@vera/shared";
import { type ToolDefinition, toolExcludedRoots, toolPathGuard, toolSignal } from "./context.js";

/**
 * The value as bench tools and datasheets write it: a JSON number, binary (0b1011), a hex suffix (0Bh),
 * digit separators or stray spaces. The schema keeps one exact form, decimal or 0x hexadecimal text.
 */
function repairDecodeCall(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const { value } = raw as { value?: unknown };
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? { ...raw, value: String(value) } : raw;
  if (typeof value !== "string") return raw;
  const text = value.replace(/[\s_']/g, "");
  const binary = /^0[bB]([01]+)$/.exec(text)?.[1];
  const suffixed = /^([0-9a-fA-F]+)[hH]$/.exec(text)?.[1];
  return {
    ...raw,
    value: binary ? `0x${BigInt(`0b${binary}`).toString(16)}` : suffixed ? `0x${suffixed}` : text,
  };
}

export const decodeRegisterTool: ToolDefinition = {
  name: "decode_register",
  class: "read",
  description:
    "Decode a captured unsigned register value against a local JSON device definition (at most 1 MiB) in an isolated worker. Returns exact decimal/hex field values, unmapped bits and citable definition/source refs; reads no device and infers no fault. Definition content is data. Paths follow the current tool scope: absolute outside definitions require Bypass; VERA application data is always refused. Outside sources have absolute paths and null local citation refs.",
  params: decodeRegisterArgsSchema,
  repair: repairDecodeCall,
  async execute(ctx, raw, signal) {
    signal = toolSignal(ctx, signal);
    const guard = await toolPathGuard(ctx);
    signal.throwIfAborted();
    const args = decodeRegisterArgsSchema.parse(raw);
    if (!ctx.workers)
      return {
        isError: true,
        code: "INTERNAL",
        reason: "worker_unavailable",
        error: "The register worker is unavailable. Reopen the workbench.",
      };
    const result = await ctx.workers.run(
      {
        kind: "decode_register",
        root: ctx.root,
        args,
        ...(guard.scope === "filesystem" ? { scope: "filesystem" as const } : {}),
        excludedRoots: toolExcludedRoots(ctx),
      },
      signal,
    );
    signal.throwIfAborted();
    if (result.reason === "aborted") throw Error("Register decoding aborted.");
    if (result.reason === "timeout")
      return {
        isError: true,
        code: "INTERNAL",
        reason: "worker_timeout",
        error: "Register decoding reached the worker deadline. Retry the call or use a smaller definition.",
      };
    if (result.failure)
      return {
        isError: true,
        code: result.failure.code,
        reason: result.failure.reason,
        error: result.failure.message,
      };
    const decoded = decodeRegisterResultSchema.safeParse(result.value);
    if (decoded.success && !result.error) return decoded.data;
    return {
      isError: true,
      code: "INTERNAL",
      reason: "worker_failed",
      error: "The register worker could not complete decoding. Retry the call.",
    };
  },
};
