import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Clock, Logger } from "@vera/core";

/**
 * `keep` is the resolved Log retention (daily files kept; seven without a getter). The desktop builds the
 * logger before its settings service, so the getter is read only while an entry is written; while it throws,
 * nothing is pruned, so an early entry cannot delete files a longer retention keeps.
 */
export function createLogger(directory: string, clock: Clock, keep?: () => number): Logger {
  const secrets = new Map<string, number>();
  let queue = Promise.resolve();
  let failure: unknown;
  // Old files are pruned with the first entry that can read the retention, when the day changes and when the
  // retention changes, not with every entry (REQ-FUNC-4a030008).
  let prunedDay: string | undefined;
  let prunedKeep: number | undefined;
  const retained = (): number | undefined => {
    if (!keep) return 7;
    try {
      const value = keep();
      return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  };
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
          const day = timestamp.slice(0, 10);
          const count = retained();
          if (count === undefined || (day === prunedDay && count === prunedKeep)) return;
          const daily = (await readdir(directory))
            .filter((file) => /^vera-\d{4}-\d{2}-\d{2}\.log$/.test(file))
            .sort()
            .reverse();
          for (const file of daily.slice(count)) await rm(join(directory, file));
          prunedDay = day;
          prunedKeep = count;
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
