import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { customConfigSchema, modelReferenceSchema, sessionIdSchema } from "@vera/shared";

export const USAGE = `Usage: vera run --workbench <dir> --prompt <text>
  [--session <id>] [--data <dir>] [--key-file <file>] [--format jsonl|pretty]
  [--approve all|none] (otherwise prompt on TTY; non-TTY denies)
  --provider replay --script <file>
  --provider openai --model <id>
  --provider custom --base-url <url> --model <id>
  vera index --workbench <dir> [--data <dir>]
  vera search --workbench <dir> --query <text> [--mode hybrid|keyword|semantic]
    [--k 1..20] [--path-glob <glob>] [--data <dir>]

Provider defaults to openai; format defaults to jsonl. Keys: OPENAI_API_KEY or
UTF-8 --key-file (takes precedence). Data defaults to an owned temporary folder.
Exit codes: 0=end/help, 1=error/aborted/limit, 2=usage error.`;
export class UsageError extends Error {}
export interface RunOptions {
  kind?: "run";
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
export type DocumentOptions = {
  workbench: string;
  data?: string;
  query?: string;
  k?: number;
  mode?: "hybrid" | "keyword" | "semantic";
  pathGlob?: string;
  approve?: never;
} & ({ kind: "index" } | { kind: "search" });
function documentCommand(argv: string[]): DocumentOptions {
  const kind = argv[0] as "index" | "search";
  try {
    const { values, tokens } = parseArgs({
      args: argv.slice(1),
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: Object.fromEntries(
        (kind === "index"
          ? ["workbench", "data"]
          : ["workbench", "data", "query", "k", "mode", "path-glob"]
        ).map((name) => [name, { type: "string" as const }]),
      ),
    });
    const seen = new Set<string>();
    for (const token of tokens)
      if (token.kind === "option") {
        if (seen.has(token.name)) throw new UsageError(`Repeated --${token.name}.`);
        seen.add(token.name);
      }
    const text = (name: string) => {
      const value = values[name];
      if (value !== undefined && (typeof value !== "string" || !value.trim() || value.includes("\0")))
        throw new UsageError(`Invalid --${name}.`);
      return value as string | undefined;
    };
    const workbench = text("workbench"),
      data = text("data");
    if (!workbench) throw new UsageError(`${kind} requires --workbench.`);
    const common = { kind, workbench: resolve(workbench), ...(data ? { data: resolve(data) } : {}) };
    if (kind === "index") return { ...common, kind: "index" };
    const query = text("query"),
      rawK = text("k"),
      k = rawK === undefined ? 8 : Number(rawK),
      mode = text("mode") ?? "hybrid",
      pathGlob = text("path-glob");
    if (
      !query ||
      query.length > 1000 ||
      !Number.isInteger(k) ||
      k < 1 ||
      k > 20 ||
      !/^(hybrid|keyword|semantic)$/.test(mode) ||
      (rawK !== undefined && !/^(?:[1-9]|1[0-9]|20)$/.test(rawK))
    )
      throw new UsageError("Invalid search query/k/mode.");
    return {
      ...common,
      kind: "search",
      query,
      k,
      mode: mode as DocumentOptions["mode"] & string,
      ...(pathGlob ? { pathGlob } : {}),
    };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(error instanceof Error ? error.message : "Invalid arguments.");
  }
}
export function parseCommand(argv: string[]): RunOptions | DocumentOptions | undefined {
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0] ?? "")) return;
  if (argv[0] === "index" || argv[0] === "search") return documentCommand(argv);
  if (argv[0] !== "run") throw new UsageError("Expected command run, index or search.");
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
