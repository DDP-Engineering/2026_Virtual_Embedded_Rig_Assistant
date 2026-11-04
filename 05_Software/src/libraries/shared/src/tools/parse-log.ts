import { z } from "zod";

export const logLevelSchema = z.enum(["error", "warn", "info", "debug", "verbose", "other"]);
export type LogLevel = z.infer<typeof logLevelSchema>;
export const parseLogArgsSchema = z
  .strictObject({
    path: z.string().min(1).max(256),
    profile: z.enum(["esp-idf", "zephyr", "iso"]).optional(),
    pattern: z.string().min(1).max(512).optional(),
    levels: z.array(logLevelSchema).optional(),
    contains: z.string().max(200).optional(),
    fromLine: z.number().int().min(1).default(1),
    maxEvents: z.number().int().min(1).max(200).default(50),
    expectedSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
  })
  .refine((args) => (args.profile !== undefined) !== (args.pattern !== undefined), {
    message: "Supply exactly one of profile or pattern.",
  });
export type ParseLogArgs = z.infer<typeof parseLogArgsSchema>;
const count = z.number().int().nonnegative();
const ref = z.string().min(1);
export const parseLogResultSchema = z.strictObject({
  profile: z.string(),
  source: z.strictObject({
    path: z.string(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    ref: ref.nullable(),
  }),
  scan: z.strictObject({
    complete: z.boolean(),
    stopReason: z.enum(["eof", "timeout"]),
    lines: count,
    bytes: count,
  }),
  counts: z.strictObject({
    error: count,
    warn: count,
    info: count,
    debug: count,
    verbose: count,
    other: count,
    unparsed: count,
    blank: count,
  }),
  events: z
    .array(
      z.strictObject({
        line: z.number().int().positive(),
        time: z.string().max(256).optional(),
        level: logLevelSchema,
        source: z.string().max(256).optional(),
        message: z.string().max(256),
        ref,
      }),
    )
    .max(200),
  preview: z.strictObject({ truncated: z.boolean(), omitted: count }),
  unparsedSamples: z
    .array(z.strictObject({ line: z.number().int().positive(), text: z.string().max(256), ref }))
    .max(5),
});
export type ParseLogResult = z.infer<typeof parseLogResultSchema>;

/** These expressions are trusted profiles; custom patterns compile only in the worker. */
export const logProfiles = {
  "esp-idf":
    /^(?<level>[EWIDV]) \((?<time>\d+|\d{2}:\d{2}:\d{2}\.\d+)\)\s+(?<source>[^:]+):\s*(?<message>.*)$/i,
  zephyr:
    /^\[(?<time>\d{2}:\d{2}:\d{2}\.\d+,\d+)\]\s+<(?<level>err|wrn|inf|dbg)>\s+(?<source>[^:]+):\s*(?<message>.*)$/i,
  iso: /^(?<time>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(?<level>TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\s+(?<message>.*)$/i,
};
export function normalizeLogLevel(value: string): LogLevel {
  switch (value.toUpperCase()) {
    case "E":
    case "ERR":
    case "ERROR":
    case "F":
    case "FATAL":
      return "error";
    case "W":
    case "WRN":
    case "WARN":
    case "WARNING":
      return "warn";
    case "I":
    case "INF":
    case "INFO":
      return "info";
    case "D":
    case "DBG":
    case "DEBUG":
      return "debug";
    case "V":
    case "VERBOSE":
    case "TRACE":
      return "verbose";
    default:
      return "other";
  }
}
export function emptyLogResult(args: Pick<ParseLogArgs, "path" | "profile">): ParseLogResult {
  return {
    profile: args.profile ?? "pattern",
    source: { path: args.path, sha256: null, ref: null },
    scan: { complete: false, stopReason: "timeout", lines: 0, bytes: 0 },
    counts: { error: 0, warn: 0, info: 0, debug: 0, verbose: 0, other: 0, unparsed: 0, blank: 0 },
    events: [],
    preview: { truncated: false, omitted: 0 },
    unparsedSamples: [],
  };
}
/** Preserve metadata/citations, shrink only the event preview before serialization. */
export function boundLogResult(result: ParseLogResult): ParseLogResult {
  while (JSON.stringify(result).length > 32000 && result.events.length) {
    result.events.pop();
    result.preview.omitted++;
    result.preview.truncated = true;
  }
  return result;
}
