import { z } from "zod";
import { gitRuleArguments } from "./git-options.js";
import { type PluginRisk, pluginIdSchema, pluginProgramNameSchema, pluginRiskSchema } from "./plugins.js";
import type { PermissionMode } from "./session.js";
import { sigrokRuleArguments } from "./sigrok-options.js";

/** A plugin rule as matching reads it: a space-separated pattern, its risk and an optional note. */
export interface ProgramRule {
  readonly match: string;
  readonly risk: PluginRisk;
  readonly note?: string | undefined;
  /** Seconds a run of a matching command may take. */
  readonly timeout?: number | undefined;
}
export interface ProgramClassification {
  risk: PluginRisk;
  /** Notes of every matching rule, each text once, in manifest order. */
  notes: string[];
  /** The word the user types to approve an irreversible command; null for every other risk. */
  confirm: string | null;
  /** The largest timeout of the matching rules, in seconds; null when none declares one. */
  timeout: number | null;
}
/**
 * What the approval gate does with a program command: run it without a record, refuse it, approve
 * it by mode, wait for the user, or wait for the user and the typed confirmation.
 */
export type ProgramPolicy = "run" | "refuse" | "mode" | "user" | "confirm";
export type ProgramRefusal =
  | { reason: "count" }
  | { reason: "length" | "control" | "argument-file"; index: number };
export const PROGRAM_ARGUMENTS = { count: 64, length: 4096 } as const;

const RANK: Record<PluginRisk, number> = {
  safe: 0,
  "device-read": 1,
  "device-write": 2,
  irreversible: 3,
  blocked: 4,
};
interface Token {
  text: string;
  /** Index of the argument the token came from; -1 for the program name. */
  arg: number;
}
type Part = { any: true } | { any: false; options: { text: string; prefix: boolean }[] };

const normalise = (text: string) => text.toLowerCase().replaceAll("_", "-");
/** `--name=value` is two tokens; a single-dash `-n=v` stays one. */
const split = (text: string): string[] => {
  const option = /^(--[^=]+)=(.*)$/s.exec(text);
  return option ? [option[1] as string, option[2] as string] : [text];
};
const option = (text: string) =>
  text.length > 1 && text.endsWith("*") ? { text: text.slice(0, -1), prefix: true } : { text, prefix: false };
function part(token: string): Part {
  if (token === "*") return { any: true };
  const choices = /^\{(.+)\}$/.exec(token)?.[1]?.split(",");
  if (choices?.every((choice) => choice !== "" && choice !== "*"))
    return { any: false, options: choices.map(option) };
  return { any: false, options: [option(token)] };
}
function tokens(program: string, args: readonly string[]): Token[] {
  return [
    { text: normalise(program), arg: -1 },
    ...args.flatMap((arg, index) => split(arg).map((text) => ({ text: normalise(text), arg: index }))),
  ];
}
function pattern(match: string): Part[] {
  return (
    match
      .trim()
      .split(/\s+/)
      .flatMap(split)
      .map((token) => part(normalise(token)))
      // Adjacent sequence wildcards consume exactly the same language as one wildcard.
      .filter((current, index, parts) => !current.any || !parts[index - 1]?.any)
  );
}
/**
 * The token index each part consumed (null for `*`) when the pattern covers every token, else null.
 * Cost is O(pattern tokens × command tokens): a `*` that fails from token t fails from every later
 * token too, so each `*` tries each continuation at most once.
 */
function cover(parts: Part[], line: Token[]): (number | null)[] | null {
  const failed = new Set<number>();
  /** Per `*` part: the smallest token index it already failed from. */
  const anyFailedFrom: number[] = [];
  const taken: (number | null)[] = [];
  const walk = (p: number, t: number): boolean => {
    if (p === parts.length) return t === line.length;
    const key = p * (line.length + 1) + t;
    if (failed.has(key)) return false;
    const current = parts[p] as Part;
    if (current.any) {
      const limit = anyFailedFrom[p] ?? line.length + 1;
      if (t >= limit) return false;
      taken[p] = null;
      for (let next = t; next < limit; next++) if (walk(p + 1, next)) return true;
      anyFailedFrom[p] = t;
      return false;
    } else {
      const text = line[t]?.text;
      if (
        text !== undefined &&
        current.options.some((choice) =>
          choice.prefix ? text.startsWith(choice.text) : text === choice.text,
        )
      ) {
        taken[p] = t;
        if (walk(p + 1, t + 1)) return true;
      }
    }
    failed.add(key);
    return false;
  };
  return walk(0, 0) ? taken.slice(0, parts.length) : null;
}

/** Whether a rule's first pattern token matches the program name, so the rule can apply to it. */
export function ruleNamesProgram(match: string, program: string): boolean {
  if (!match.trim()) return false;
  const first = pattern(match)[0];
  return first !== undefined && cover([first], tokens(program, [])) !== null;
}

/** Classifies a command line with the declaring plugin's rules (architecture §2.2). */
export function classifyCommand(
  rules: readonly ProgramRule[],
  program: string,
  args: readonly string[],
  optionSyntax?: "sigrok-cli" | "git",
): ProgramClassification {
  const projected =
    optionSyntax === "sigrok-cli"
      ? sigrokRuleArguments(args)
      : optionSyntax === "git"
        ? gitRuleArguments(args)
        : args;
  const line = tokens(program, projected);
  let risk: PluginRisk | undefined;
  let confirm: string | undefined;
  let timeout: number | null = null;
  const notes: string[] = [];
  for (const rule of rules) {
    const taken = cover(pattern(rule.match), line);
    if (!taken) continue;
    if (risk === undefined || RANK[rule.risk] > RANK[risk]) risk = rule.risk;
    if (rule.note !== undefined && !notes.includes(rule.note)) notes.push(rule.note);
    if (rule.timeout !== undefined && (timeout === null || rule.timeout > timeout)) timeout = rule.timeout;
    if (rule.risk === "irreversible" && confirm === undefined) {
      const index = taken.find((t) => t !== null && (line[t] as Token).arg >= 0);
      confirm = (line[index ?? 0] as Token).text;
    }
  }
  return {
    risk: risk ?? "device-write",
    notes,
    confirm: risk === "irreversible" ? (confirm ?? null) : null,
    timeout,
  };
}
/** Refusals checked on the raw arguments before any rule. */
export function programArgumentRefusal(args: readonly string[]): ProgramRefusal | null {
  if (args.length > PROGRAM_ARGUMENTS.count) return { reason: "count" };
  for (const [index, arg] of args.entries()) {
    if (arg.length > PROGRAM_ARGUMENTS.length) return { reason: "length", index };
    if (/[\0\r\n]/.test(arg)) return { reason: "control", index };
    if (arg.startsWith("@")) return { reason: "argument-file", index };
  }
  return null;
}
/** The mode matrix of ADR-0018, with the trial override of ADR-0016. */
export function programPolicy(mode: PermissionMode, risk: PluginRisk, trial: boolean): ProgramPolicy {
  if (risk === "blocked" || (mode === "read-only" && (trial || risk !== "safe"))) return "refuse";
  if (trial) return risk === "irreversible" ? "confirm" : "user";
  if (risk === "safe") return "run";
  if (mode === "bypass" || (mode === "auto-edit" && risk === "device-read")) return "mode";
  return risk === "irreversible" ? "confirm" : "user";
}
/** Typed text matches when, trimmed and normalised like a command token, it equals the word. */
export function confirmationMatches(word: string | null, typed: string | undefined): boolean {
  const text = normalise(typed?.trim() ?? "");
  return word !== null && text !== "" && text === word;
}

/** The command line as a reader sees it: arguments that would not split back are JSON-quoted. */
export function programCommandLine(program: string, args: readonly string[]): string {
  return [program, ...args.map((arg) => (/^[^\s"'\\]+$/.test(arg) ? arg : JSON.stringify(arg)))].join(" ");
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** What a run_program approval card and prompt show; core's request carries these and the ids. */
export const programApprovalSchema = z.strictObject({
  pluginId: pluginIdSchema,
  trial: z.boolean(),
  program: pluginProgramNameSchema,
  programVersion: z.string().min(1).max(128).nullable(),
  // Display strings are unbounded like other event text: credential redaction may lengthen them.
  executable: z.string().min(1),
  args: z.array(z.string()).max(PROGRAM_ARGUMENTS.count),
  cwd: z.string().min(1),
  risk: pluginRiskSchema,
  confirm: z.string().min(1).max(PROGRAM_ARGUMENTS.length).nullable(),
  notes: z.array(z.string().min(1)).max(512),
  files: z
    .array(
      z.strictObject({
        arg: z
          .number()
          .int()
          .min(0)
          .max(PROGRAM_ARGUMENTS.count - 1),
        path: z.string().min(1),
        sha256,
      }),
    )
    .max(PROGRAM_ARGUMENTS.count),
});
export type ProgramApproval = z.infer<typeof programApprovalSchema>;
/** A run_program approval carries a program payload and no diff; other tools carry none. */
export function validProgramApproval(value: {
  tool: string;
  bytes: number;
  diff: string;
  program?: unknown;
}): boolean {
  return value.tool === "run_program"
    ? !!value.program && value.bytes === 0 && value.diff === ""
    : value.program === undefined;
}
