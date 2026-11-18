/** The sorted tokens of a secret set. The stores only add secrets, so a new size means a new secret. */
const cache = new WeakMap<Set<string>, { size: number; tokens: string[] }>();

function tokensOf(secrets: Iterable<string>): string[] {
  return [
    ...new Set(
      [...secrets].filter(Boolean).flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]),
    ),
  ].sort((a, b) => b.length - a.length);
}

/** Strip known secrets from provider diagnostics before persistence or transport. */
export function scrub(text: string, secrets: Iterable<string>): string {
  let tokens: string[];
  if (secrets instanceof Set) {
    let cached = cache.get(secrets);
    if (cached?.size !== secrets.size) {
      cached = { size: secrets.size, tokens: tokensOf(secrets) };
      cache.set(secrets, cached);
    }
    tokens = cached.tokens;
  } else tokens = tokensOf(secrets);
  for (const token of tokens) text = text.replaceAll(token, "[REDACTED]");
  return text;
}
