/** Strip known secrets from provider diagnostics before persistence or transport. */
export function scrub(text: string, secrets: Iterable<string>): string {
  const tokens = [
    ...new Set(
      [...secrets].filter(Boolean).flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]),
    ),
  ].sort((a, b) => b.length - a.length);
  for (const token of tokens) text = text.replaceAll(token, "[REDACTED]");
  return text;
}
