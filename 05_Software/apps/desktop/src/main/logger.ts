import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Clock, Logger } from "@vera/core";

export function createLogger(directory: string, clock: Clock): Logger {
  const secrets = new Map<string, number>();
  let queue = Promise.resolve();
  let failure: unknown;
  function redact(serialized: string): string {
    const tokens = [...secrets.keys()].flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]);
    const ordered = [...new Set(tokens)].sort((a, b) => b.length - a.length);
    function text(value: string): string {
      for (const token of ordered) value = value.replaceAll(token, "[REDACTED]");
      return value;
    }
    function scrub(value: unknown): unknown {
      if (typeof value === "string") return text(value);
      if (Array.isArray(value)) return value.map(scrub);
      if (value !== null && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), scrub(item)]));
      return value;
    }
    // Redact content rather than JSON syntax; quotes and slashes stay valid.
    return JSON.stringify(scrub(JSON.parse(serialized)));
  }
  return {
    log(level, message, data) {
      const timestamp = clock.now().toISOString();
      // Capture now so callers cannot mutate queued entries. Redact again at write time.
      let serialized: string;
      try {
        serialized = redact(
          JSON.stringify({ timestamp, level, message, ...(data === undefined ? {} : { data }) }),
        );
      } catch {
        serialized = JSON.stringify({ timestamp, level, message: "log.serialization.failed" });
      }
      queue = queue
        .then(async () => {
          await mkdir(directory, { recursive: true });
          await appendFile(join(directory, `vera-${timestamp.slice(0, 10)}.log`), `${redact(serialized)}\n`, {
            mode: 0o600,
          });
          const daily = (await readdir(directory))
            .filter((file) => /^vera-\d{4}-\d{2}-\d{2}\.log$/.test(file))
            .sort()
            .reverse();
          for (const file of daily.slice(7)) await rm(join(directory, file));
        })
        .catch((error: unknown) => {
          failure ??= error;
        });
    },
    registerSecret(secret) {
      if (!secret) return () => {};
      secrets.set(secret, (secrets.get(secret) ?? 0) + 1);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const count = secrets.get(secret) ?? 0;
        if (count <= 1) secrets.delete(secret);
        else secrets.set(secret, count - 1);
      };
    },
    async flush() {
      await queue;
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        throw error;
      }
    },
  };
}
