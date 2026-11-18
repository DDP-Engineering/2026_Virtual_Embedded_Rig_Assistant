import { type RunOptions, UsageError } from "./args.js";

/**
 * The key a run takes from the environment when no `--key-file` is given, and a note for stderr when there
 * is none. `OPENAI_API_KEY` belongs to OpenAI: it is never sent to a custom provider's host. `--key-env`
 * names the variable instead, so a key reaches another host only when the command says which one.
 */
export function environmentKey(
  provider: RunOptions["provider"],
  env: NodeJS.ProcessEnv,
  keyEnv?: string,
): { key?: string; note?: string } {
  if (keyEnv) {
    const named = env[keyEnv]?.trim();
    if (!named) throw new UsageError(`--key-env ${keyEnv}: the environment variable is not set or is empty.`);
    return { key: named };
  }
  const key = env.OPENAI_API_KEY;
  if (provider === "openai")
    return key
      ? { key }
      : { note: "no API key: set OPENAI_API_KEY or pass --key-file <file> or --key-env <NAME>" };
  if (provider === "custom" && key)
    return {
      note: "OPENAI_API_KEY is used only with --provider openai; pass --key-file <file> or --key-env <NAME> to send a key to the custom provider",
    };
  return {};
}
