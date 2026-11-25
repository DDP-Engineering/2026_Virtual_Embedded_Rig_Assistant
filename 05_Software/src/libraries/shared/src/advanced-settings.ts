// REQ-FUNC-902313e0 REQ-DATA-96ef3dd6 REQ-DATA-33a90ef2 REQ-FUNC-2e124a88
import { z } from "zod";

export const advancedScopes = ["app", "workbench", "session"] as const;
export type AdvancedScope = (typeof advancedScopes)[number];
/** When a changed value takes effect, shown next to each field. */
export type AdvancedTiming = "live" | "new" | "nextOperation" | "reindex" | "reopen" | "restart";

interface IntSetting {
  kind: "int";
  min: number;
  max: number;
  default: number;
  scopes: readonly AdvancedScope[];
  applies: AdvancedTiming;
}
/** An on/off setting: absent at a scope means inherit. */
interface SwitchSetting {
  kind: "switch";
  default: boolean;
  scopes: readonly AdvancedScope[];
  applies: AdvancedTiming;
}
/** A number from a fixed list, such as the rows per page a pager offers. */
interface ChoiceSetting {
  kind: "choice";
  options: readonly number[];
  default: number;
  scopes: readonly AdvancedScope[];
  applies: AdvancedTiming;
}
type AdvancedSetting = IntSetting | SwitchSetting | ChoiceSetting;

const int = <const S extends readonly AdvancedScope[], const T extends AdvancedTiming = "live">(
  min: number,
  max: number,
  value: number,
  scopes: S,
  applies: T = "live" as T,
) => ({ kind: "int", min, max, default: value, scopes, applies }) as const;
const toggle = <const S extends readonly AdvancedScope[]>(value: boolean, scopes: S) =>
  ({ kind: "switch", default: value, scopes, applies: "live" }) as const;
const choice = <const O extends readonly number[], const S extends readonly AdvancedScope[]>(
  options: O,
  value: O[number],
  scopes: S,
) => ({ kind: "choice", options, default: value, scopes, applies: "live" }) as const;

/**
 * Every user-tunable Advanced setting, in the user's units (seconds, percent, characters, tokens). Values are
 * checked against this registry when saved (strict) and when resolved (an invalid stored value is skipped),
 * so a hand-edited file never fails to load.
 */
export const advancedSettings = {
  /** Tool calls one agent turn may make before it stops with `limit`. */
  toolCallsPerTurn: int(10, 500, 200, ["app", "workbench", "session"]),
  /** Seconds a model stream may send nothing before the request ends with a timeout. */
  noOutputTimeout: int(30, 3600, 300, ["app", "session"]),
  /** Seconds to wait for hosted response headers; custom endpoints keep their own wait. */
  headerWait: int(10, 300, 30, ["app"]),
  /** Seconds to discover available models when configuring a provider. */
  providerDiscoveryTimeout: int(5, 120, 10, ["app"], "nextOperation"),
  /** Summarize a finished conversation after a turn, instead of at the next request. */
  backgroundCompaction: toggle(true, ["app", "workbench"]),
  /** Characters of each tool result a summary request carries. */
  summaryToolResultChars: int(500, 8000, 2000, ["app"]),
  /** Summary passes one request may run. */
  summaryPasses: int(1, 10, 5, ["app"]),
  /** Percent over a calibrated count (110 = 1.1 times). */
  calibrationMargin: int(100, 150, 110, ["app"]),
  /** Count requests with the provider-calibrated ratio rather than the conservative estimate. */
  providerTokenCounts: toggle(true, ["app"]),
  /** Delegated sessions that may run at once. */
  delegations: int(1, 8, 3, ["app"]),
  /** Turns that may run at once across every open workbench, delegated ones included (REQ-DATA-84718b36). */
  concurrentTurns: int(1, 16, 4, ["app"]),
  /** Percent of the input budget above which history is compacted. */
  compactionTrigger: int(50, 95, 80, ["app", "workbench"]),
  /** Tokens of the most recent history kept verbatim (at most a fifth of the input budget). */
  recentTailTokens: int(0, 100000, 20000, ["app", "workbench"]),
  /** Compact this session automatically; off keeps full detail up to the context limit. */
  autoCompaction: toggle(true, ["session"]),
  /** Characters of one tool result the model receives; longer results are shrunk. */
  toolResultChars: int(8000, 128000, 32000, ["app"]),
  /** Lines one read returns at most, and when the call names none. */
  readLines: int(500, 10000, 2000, ["app"]),
  /** Characters of text one read returns at most. */
  readChars: int(10000, 120000, 30000, ["app"]),
  /** Matches one grep returns at most, and when the call names none. */
  grepResults: int(50, 2000, 500, ["app"]),
  /** MiB above which grep skips a file. */
  grepFileMB: int(1, 50, 5, ["app"]),
  /** Paths one glob returns at most. */
  globResults: int(100, 5000, 500, ["app"]),
  /** Seconds a grep or parse_log worker task may run; a running task keeps its deadline. */
  workerDeadline: int(5, 120, 10, ["app"], "new"),
  /** Sources one web_search requests at most, and when the call names none. */
  webSearchResults: int(1, 8, 5, ["app"]),
  /** Characters one web_read requests at most, and when the call names none. */
  webReadChars: int(1000, 16000, 12000, ["app"]),
  /** Seconds a web search or read request may take. */
  webTimeout: int(5, 120, 30, ["app"]),
  /** Seconds for Interactive Browser navigation when explicitly set. Inherit keeps the operation defaults. */
  browserNavigationTimeout: int(5, 60, 12, ["app"], "nextOperation"),
  /** MiB one web_download may fetch; bound into its approval. */
  downloadMB: int(10, 1000, 100, ["app"]),
  /** Seconds one web_download may take to transfer; PDF text extraction keeps its own deadline. */
  downloadTimeout: int(30, 1800, 120, ["app"]),
  /** Background program runs one session may have at once. */
  backgroundPrograms: int(1, 16, 4, ["app"], "new"),
  /** Run folders a workbench keeps; older ones are removed. */
  runLogsKept: int(20, 2000, 200, ["app"]),
  /** MiB of output one run log keeps. */
  runLogMB: int(8, 1024, 64, ["app"]),
  /** Seconds a program run may take when neither a plugin rule nor the program sets a timeout. */
  programTimeout: int(60, 3600, 600, ["app", "workbench"]),
  /** Seconds a foreground run_command may take at most. */
  commandTimeout: int(60, 3600, 600, ["app", "workbench"]),
  /** MiB above which a text document is not indexed; PDF and Office use docs.maxFileMB. */
  textFileMB: int(1, 64, 20, ["workbench"], "reindex"),
  /** Selected files above which the Documents preview warns. */
  docVolumeFiles: int(500, 100000, 2000, ["app", "workbench"]),
  /** Selected MiB above which the Documents preview warns. */
  docVolumeMB: int(512, 51200, 2048, ["app", "workbench"]),
  /** Hits one Docs panel search lists. */
  docsResults: int(10, 100, 20, ["app", "workbench"]),
  /** Base seconds a PDF or Office extraction may take; PDFs scale with size. */
  extractionTimeout: int(30, 1800, 120, ["app"], "new"),
  /** Milliseconds the indexer waits after a change before it starts. */
  indexingPause: int(250, 10000, 1000, ["app"]),
  /** Seconds an idle embedding worker is kept before it is retired. */
  embeddingIdle: int(10, 600, 60, ["app"], "new"),
  /** Seconds a local transcription may take, including worker startup and model loading. */
  dictationTranscriptionTimeout: int(30, 300, 120, ["app"], "nextOperation"),
  /** Terminals one workbench may have open; lowering it closes none. */
  terminals: int(1, 16, 8, ["app"], "new"),
  /** Ki characters of output a terminal keeps, read when it opens. */
  terminalBufferK: int(64, 1024, 256, ["app"], "new"),
  /** Lines a terminal view keeps when scrolled back. */
  terminalScrollback: int(1000, 50000, 3000, ["app"], "new"),
  /** Characters of a terminal's latest output one terminal_read returns. */
  terminalAgentChars: int(2000, 64000, 12000, ["app"]),
  /** Hours between update checks while updates are not Off. */
  updateInterval: int(1, 168, 6, ["app"]),
  /** Hours between plugin catalog checks. */
  catalogInterval: int(1, 168, 24, ["app"]),
  /** Daily log files kept. */
  logDays: int(1, 90, 7, ["app"]),
  /** Newest transcript rows mounted when a session is shown. */
  transcriptRows: int(20, 200, 40, ["app"], "new"),
  /** Older transcript rows mounted in each later idle chunk. */
  transcriptChunkRows: int(50, 500, 100, ["app"], "new"),
  /** Rows a paged list starts with. */
  pageSize: choice([10, 20, 50], 10, ["app"]),
} as const satisfies Record<string, AdvancedSetting>;
export type AdvancedKey = keyof typeof advancedSettings;
export const advancedKeys = Object.keys(advancedSettings) as AdvancedKey[];
/** The value type of one setting: a number, or a boolean for a switch. */
export type AdvancedValueOf<K extends AdvancedKey> = (typeof advancedSettings)[K] extends { kind: "switch" }
  ? boolean
  : number;
export type AdvancedValue = number | boolean;
export type AdvancedValues = { [K in AdvancedKey]?: AdvancedValueOf<K> };
/** A stored map as read from a file or event: not yet validated. */
export type StoredAdvanced = Readonly<Record<string, unknown>> | undefined;
type Patch = Partial<Record<AdvancedKey, AdvancedValue | null>>;

const isAdvancedKey = (key: string): key is AdvancedKey => Object.hasOwn(advancedSettings, key);
function valueSchema(key: AdvancedKey): z.ZodType<AdvancedValue> {
  const setting: AdvancedSetting = advancedSettings[key];
  if (setting.kind === "switch") return z.boolean();
  if (setting.kind === "choice") {
    const options = setting.options;
    return z
      .number()
      .int()
      .refine((value) => options.includes(value));
  }
  return z.number().int().min(setting.min).max(setting.max);
}
function validValue(key: AdvancedKey, value: unknown): value is AdvancedValue {
  return valueSchema(key).safeParse(value).success;
}

/** A save patch for one scope: each registered key accepts a value in range, or null to clear it. */
export function advancedPatchSchema(scope: AdvancedScope) {
  const shape: Record<string, z.ZodType> = {};
  for (const key of advancedKeys)
    if ((advancedSettings[key].scopes as readonly string[]).includes(scope))
      shape[key] = valueSchema(key).nullable().optional();
  return z.strictObject(shape) as unknown as z.ZodType<Patch, Patch>;
}

/** Apply a save patch to a stored map: null removes a key; keys that are not registered are dropped. */
export function mergeAdvanced(current: StoredAdvanced, patch: Patch): Record<string, AdvancedValue> {
  const next: Record<string, AdvancedValue> = {};
  for (const [key, value] of Object.entries(current ?? {}))
    if (isAdvancedKey(key) && validValue(key, value)) next[key] = value;
  for (const [key, value] of Object.entries(patch)) {
    if (!isAdvancedKey(key) || value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

export interface AdvancedSources {
  session?: StoredAdvanced;
  workbench?: StoredAdvanced;
  app?: StoredAdvanced;
}
/**
 * The value that applies: session, else workbench, else application, else the registry default.
 * Each scope is checked against the setting's own range, so any scope may raise or lower another; a value
 * stored at a scope the setting does not list (a hand-edited file) is ignored like an invalid one.
 */
export function resolveAdvanced<K extends AdvancedKey>(
  key: K,
  sources: AdvancedSources,
  onIgnored?: (scope: AdvancedScope, key: string) => void,
): { value: AdvancedValueOf<K>; source: AdvancedScope | "default" } {
  const order: AdvancedScope[] = ["session", "workbench", "app"];
  // Unknown keys are reported at every scope, whichever value wins.
  if (onIgnored)
    for (const scope of order)
      for (const stored of Object.keys(sources[scope] ?? {}))
        if (!isAdvancedKey(stored)) onIgnored(scope, stored);
  let found: { value: AdvancedValueOf<K>; source: AdvancedScope } | undefined;
  for (const scope of order) {
    const stored = sources[scope];
    if (!stored || !Object.hasOwn(stored, key)) continue;
    const value = stored[key];
    const listed = (advancedSettings[key].scopes as readonly string[]).includes(scope);
    if (listed && validValue(key, value)) {
      found ??= { value: value as AdvancedValueOf<K>, source: scope };
    } else onIgnored?.(scope, key);
  }
  return found ?? { value: advancedSettings[key].default as AdvancedValueOf<K>, source: "default" };
}

const switchWords: Readonly<Record<string, boolean>> = { true: true, on: true, false: false, off: false };
/**
 * `key=value` from the CLI, checked like a session value (a switch takes on, off, true or false); undefined
 * when invalid.
 */
export function parseAdvancedFlag(flag: string): { key: AdvancedKey; value: AdvancedValue } | undefined {
  const match = /^([A-Za-z][A-Za-z0-9]*)=(-?\d+|[a-z]+)$/.exec(flag);
  const key = match?.[1];
  const raw = match?.[2] ?? "";
  if (!key || !isAdvancedKey(key) || !(advancedSettings[key].scopes as readonly string[]).includes("session"))
    return undefined;
  const value =
    advancedSettings[key].kind === "switch"
      ? Object.hasOwn(switchWords, raw)
        ? switchWords[raw]
        : undefined
      : /^-?\d+$/.test(raw)
        ? Number(raw)
        : undefined;
  return value !== undefined && validValue(key, value) ? { key, value } : undefined;
}

/** The save patch that turns `before` into `after` for one scope's registered keys (null removes). */
export function advancedEditPatch(
  before: StoredAdvanced,
  after: StoredAdvanced,
  scope: AdvancedScope,
): Patch {
  const patch: Patch = {};
  for (const key of advancedKeys) {
    if (!(advancedSettings[key].scopes as readonly string[]).includes(scope)) continue;
    const next = after?.[key];
    const previous = before?.[key];
    if (next === undefined && previous !== undefined) patch[key] = null;
    else if (next !== undefined && next !== previous) patch[key] = next as AdvancedValue;
  }
  return patch;
}
/**
 * Whether every registered value present in a draft or patch is in range; null (cleared) and unknown keys
 * are not checked.
 */
export function advancedDraftValid(values: StoredAdvanced): boolean {
  return advancedKeys.every(
    (key) => values?.[key] === undefined || values[key] === null || validValue(key, values[key]),
  );
}
