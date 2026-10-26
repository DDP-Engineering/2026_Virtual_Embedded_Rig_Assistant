/** Keep a raw tail long enough to recognize a credential crossing provider delta boundaries. */
export function createStreamScrubber(secrets: () => readonly string[], scrub: (text: string) => string) {
  let buffer = "";
  return {
    push(delta: string): string {
      buffer += delta;
      const patterns = [
        ...new Set(
          secrets()
            .filter(Boolean)
            .flatMap((s) => [s, JSON.stringify(s).slice(1, -1)]),
        ),
      ];
      const longest = Math.max(1, ...patterns.map((s) => s.length));
      let cut = Math.max(0, buffer.length - longest + 1);
      for (const secret of patterns) {
        let at = buffer.indexOf(secret);
        while (at >= 0) {
          if (at < cut && at + secret.length > cut) cut = at;
          at = buffer.indexOf(secret, at + 1);
        }
      }
      const output = scrub(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
      return output;
    },
    flush(): string {
      const output = scrub(buffer);
      buffer = "";
      return output;
    },
  };
}
