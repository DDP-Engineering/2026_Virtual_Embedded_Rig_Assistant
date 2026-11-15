import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LAB_REGISTRY_BYTES,
  type PluginParameters,
  type PluginSetting,
  type PluginSettingScope,
  type PluginSettingState,
} from "@vera/shared";
import { PathGuard } from "../workbench/path-guard.js";
import { parseRegistry } from "./resource-registry.js";

/** At most this many workbench files are checked per parameter. */
const MATCHES_MAX = 64;

export interface SettingPorts {
  /** The open workbench's root; without one, workbench files stay unchecked. */
  readonly workbench?: string | undefined;
  /** The stored references (MQTT, Wokwi) or supplier ids (parts) of a scope; never a secret. */
  readonly secrets: (scope: PluginSettingScope) => Promise<readonly string[]>;
}

/**
 * The state of each declared parameter on this computer (REQ-FUNC-cbdb46ac), in declaration order: a secret is
 * stored when its scope holds at least one credential; a workbench file is present when every match is a valid
 * regular file inside the workbench, invalid with the first problem otherwise, missing without a match.
 */
export async function settingStates(
  settings: PluginParameters,
  ports: SettingPorts,
): Promise<PluginSettingState[]> {
  const guard = ports.workbench ? await PathGuard.create(ports.workbench) : undefined;
  const states: PluginSettingState[] = [];
  for (const [name, setting] of Object.entries(settings)) {
    if (setting.kind === "value") states.push({ name, kind: "value", state: "value" });
    else if (setting.kind === "secret") {
      const refs = [...(await ports.secrets(setting.scope))].slice(0, 64);
      states.push(
        refs.length
          ? { name, kind: "secret", state: "stored", refs }
          : { name, kind: "secret", state: "missing" },
      );
    } else if (!guard || !ports.workbench) states.push({ name, kind: "workbench-file", state: "unchecked" });
    else states.push({ name, kind: "workbench-file", ...(await fileState(ports.workbench, guard, setting)) });
  }
  return states;
}

async function fileState(
  root: string,
  guard: PathGuard,
  setting: Extract<PluginSetting, { kind: "workbench-file" }>,
): Promise<Pick<PluginSettingState, "state" | "paths" | "problem">> {
  const paths = await expand(root, setting.path.split("/"));
  if (!paths.length) return { state: "missing" };
  for (const path of paths) {
    const problem = await check(guard, path, setting.format);
    if (problem) return { state: "invalid", paths, problem };
  }
  return { state: "present", paths };
}

/** The existing workbench paths a declared path matches; `*` is one name, never a dot folder. */
async function expand(root: string, segments: readonly string[]): Promise<string[]> {
  let found = [""];
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    const next: string[] = [];
    for (const base of found) {
      if (segment !== "*") {
        const path = base ? `${base}/${segment}` : segment;
        if (last ? await exists(join(root, path)) : await isFolder(join(root, path))) next.push(path);
        continue;
      }
      let names: string[];
      try {
        names = (await readdir(join(root, base), { withFileTypes: true }))
          .filter((entry) => !entry.name.startsWith(".") && (last || entry.isDirectory()))
          .map((entry) => entry.name)
          .sort();
      } catch {
        names = [];
      }
      for (const name of names) next.push(base ? `${base}/${name}` : name);
    }
    found = next.slice(0, MATCHES_MAX);
  }
  return found;
}
const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );
const isFolder = (path: string) =>
  lstat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

/** Why one workbench file cannot be used, or undefined when it is valid. */
async function check(
  guard: PathGuard,
  path: string,
  format: "lab-resources" | "json" | undefined,
): Promise<string | undefined> {
  let absolute: string;
  try {
    absolute = (await guard.resolve(path)).absolute;
  } catch (error) {
    return error instanceof Error && /ignored/.test(error.message)
      ? `${path} is ignored by the workbench.`
      : `${path} lies outside the workbench.`;
  }
  let bytes: Buffer;
  try {
    const info = await lstat(absolute);
    if (!info.isFile()) return `${path} is not a regular file.`;
    if (info.size > LAB_REGISTRY_BYTES) return `${path} is larger than 256 KiB.`;
    bytes = await readFile(absolute);
  } catch {
    return `${path} cannot be read.`;
  }
  if (format === "lab-resources") {
    try {
      parseRegistry(bytes, path);
    } catch (error) {
      return (error as Error).message;
    }
  } else if (format === "json") {
    try {
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return `${path} is not valid UTF-8 JSON.`;
    }
  }
  return undefined;
}
