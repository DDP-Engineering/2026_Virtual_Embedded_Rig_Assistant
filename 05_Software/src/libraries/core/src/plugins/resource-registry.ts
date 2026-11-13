import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
  LAB_REGISTRY_BYTES,
  LAB_REGISTRY_PATH,
  type LabRegistry,
  labRegistrySchema,
  labResourceKeys,
  type PluginProgram,
} from "@vera/shared";
import { PathGuard } from "../workbench/path-guard.js";

/** A registry alias a run_program call names, with its identity keys (spec REQ-DATA-f2cbfc23 §3-4). */
export interface ProgramResource {
  readonly alias: string;
  readonly kind: string;
  readonly resource: string;
  readonly keys: readonly string[];
}
export interface ClaimedResources {
  readonly resources: readonly ProgramResource[];
  readonly registry: { readonly path: string; readonly sha256: string };
}

/** The aliases a call names with the program's resource option (`--instrument psu` or `--instrument=psu`). */
export function namedAliases(option: string, args: readonly string[]): string[] {
  const aliases: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (arg === option) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-"))
        throw Error(`${option} needs an alias of ${LAB_REGISTRY_PATH}.`);
      aliases.push(value);
      index++;
    } else if (arg.startsWith(`${option}=`)) aliases.push(arg.slice(option.length + 1));
  }
  if (aliases.length > 1) throw Error(`Name one resource with ${option}, once.`);
  return aliases;
}

/** Reads and validates the workbench registry; an Error names the file and the problem. */
export async function readRegistry(
  workbench: string,
  signal?: AbortSignal,
): Promise<{ registry: LabRegistry; sha256: string }> {
  const guard = await PathGuard.create(workbench);
  let absolute: string;
  try {
    absolute = (await guard.resolve(LAB_REGISTRY_PATH)).absolute;
  } catch {
    throw Error(`${LAB_REGISTRY_PATH} cannot be used: it lies outside the workbench or is ignored.`);
  }
  let bytes: Buffer;
  try {
    const info = await lstat(absolute);
    if (!info.isFile()) throw Error(`${LAB_REGISTRY_PATH} is not a regular file.`);
    if (info.size > LAB_REGISTRY_BYTES) throw Error(`${LAB_REGISTRY_PATH} is larger than 256 KiB.`);
    bytes = await readFile(absolute, signal ? { signal } : {});
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`${LAB_REGISTRY_PATH} is missing; declare the bench resources there first.`);
    if (error instanceof Error && error.message.startsWith(LAB_REGISTRY_PATH)) throw error;
    throw Error(`${LAB_REGISTRY_PATH} cannot be read.`);
  }
  if (bytes.length > LAB_REGISTRY_BYTES) throw Error(`${LAB_REGISTRY_PATH} is larger than 256 KiB.`);
  let parsed: ReturnType<typeof labRegistrySchema.safeParse>;
  try {
    parsed = labRegistrySchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    throw Error(`${LAB_REGISTRY_PATH} is not valid UTF-8 JSON.`);
  }
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Error(
      `${LAB_REGISTRY_PATH} is not valid: ${issue?.path.join(".") || "document"}: ${issue?.message}`,
    );
  }
  return { registry: parsed.data, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * The resources a call of `program` claims, or undefined when the program declares none or the call names no
 * alias. Throws an Error naming the problem before any approval is asked.
 */
export async function claimedResources(
  workbench: string,
  program: PluginProgram,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<ClaimedResources | undefined> {
  const declared = program.resources;
  if (!declared) return undefined;
  const aliases = namedAliases(declared.option, args);
  if (aliases.length === 0) return undefined;
  const { registry, sha256 } = await readRegistry(workbench, signal);
  const resources = aliases.map((alias) => {
    const entry = registry.resources.find((candidate) => candidate.alias === alias);
    if (!entry) throw Error(`The alias ${alias} is not declared in ${LAB_REGISTRY_PATH}.`);
    if (!(declared.kinds as readonly string[]).includes(entry.kind))
      throw Error(`The alias ${alias} is a ${entry.kind} resource, which this program does not use.`);
    return Object.freeze({
      alias,
      kind: entry.kind,
      resource: entry.resource,
      keys: Object.freeze(labResourceKeys(entry)),
    });
  });
  return {
    resources: Object.freeze(resources),
    registry: Object.freeze({ path: LAB_REGISTRY_PATH, sha256 }),
  };
}
