import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { customConfigSchema, modelReferenceSchema, sessionIdSchema } from "@vera/shared";

export const USAGE = `Usage: vera run --workbench <dir> --prompt <text>
  [--session <id>] [--data <dir>] [--key-file <file>] [--format jsonl|pretty]
  [--approve all|none] (otherwise prompt on TTY; non-TTY denies)
  --provider replay --script <file>
  --provider openai --model <id>
  --provider custom --base-url <url> --model <id>

Provider defaults to openai; format defaults to jsonl. Keys: OPENAI_API_KEY or
UTF-8 --key-file (takes precedence). Data defaults to an owned temporary folder.
Exit codes: 0=end/help, 1=error/aborted/limit, 2=usage error.`;
export class UsageError extends Error {}
export interface RunOptions {
  workbench: string;
  prompt: string;
  provider: "replay" | "openai" | "custom";
  format: "jsonl" | "pretty";
  model: string;
  session?: string;
  data?: string;
  keyFile?: string;
  script?: string;
  baseUrl?: string;
  approve?: "all" | "none";
}
export function parseCommand(argv: string[]): RunOptions | undefined {
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0] ?? "")) return;
  if (argv[0] !== "run") throw new UsageError("Expected command run.");
  try {
    const { values, tokens } = parseArgs({
      args: argv.slice(1),
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: Object.fromEntries(
        [
          "workbench",
          "prompt",
          "session",
          "data",
          "key-file",
          "provider",
          "script",
          "model",
          "base-url",
          "format",
          "approve",
        ].map((key) => [key, { type: "string" as const }]),
      ),
    });
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== "option") continue;
      if (seen.has(token.name)) throw new UsageError(`Repeated option --${token.name}.`);
      seen.add(token.name);
    }
    const text = (key: string): string | undefined => {
      const value = values[key];
      if (value !== undefined && (typeof value !== "string" || !value.trim() || value.includes("\0")))
        throw new UsageError(`Invalid --${key}.`);
      return value as string | undefined;
    };
    const workbench = text("workbench"),
      prompt = text("prompt");
    if (!workbench || !prompt) throw new UsageError("run requires --workbench and --prompt.");
    const provider = text("provider") ?? "openai",
      format = text("format") ?? "jsonl";
    if (!["replay", "openai", "custom"].includes(provider)) throw new UsageError("Invalid --provider.");
    if (format !== "jsonl" && format !== "pretty") throw new UsageError("Invalid --format.");
    const script = text("script"),
      model = text("model"),
      baseUrl = text("base-url"),
      session = text("session"),
      data = text("data"),
      keyFile = text("key-file");
    const approve = text("approve");
    if (approve !== undefined && approve !== "all" && approve !== "none")
      throw new UsageError("Invalid --approve.");
    if (session && !sessionIdSchema.safeParse(session).success) throw new UsageError("Invalid --session.");
    if (
      provider === "replay"
        ? !script || !!model || !!baseUrl
        : !model || !!script || (provider === "custom" ? !baseUrl : !!baseUrl)
    )
      throw new UsageError("Incompatible or missing provider options.");
    if (
      model &&
      !modelReferenceSchema.safeParse(`${provider === "custom" ? "custom:cli" : provider}/${model}`).success
    )
      throw new UsageError("Invalid --model.");
    if (provider === "custom" && !customConfigSchema.safeParse({ name: "CLI", baseUrl, model }).success)
      throw new UsageError("Invalid custom provider configuration.");
    return {
      workbench: resolve(workbench),
      prompt,
      provider: provider as RunOptions["provider"],
      format,
      model: model ?? "script",
      ...(script ? { script: resolve(script) } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(session ? { session } : {}),
      ...(data ? { data: resolve(data) } : {}),
      ...(keyFile ? { keyFile: resolve(keyFile) } : {}),
      ...(approve ? { approve } : {}),
    };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    // Node's parser diagnostic includes untrusted option values; the output boundary scrubs it.
    throw new UsageError(error instanceof Error ? error.message : "Invalid arguments.");
  }
}
