// Electrical results (spec REQ-DATA-06c0bd54 "Result document"): strict reading and freshness derived from the input
// snapshots a result copied from the model. VERA never stores a stale flag and never rewrites a result.
import { type ElectricalModel, type ElectricalResult, electricalResultSchema } from "@vera/shared";
import { entityHash, jsonPath, type ModelProblem, modelEntities } from "./model.js";
import { unitProblem } from "./units.js";

export interface Freshness {
  freshness: "current" | "stale";
  /** Inputs whose entity now hashes differently from the snapshot. */
  changed: string[];
  /** Inputs whose entity no longer exists. */
  removed: string[];
}

/** The result, or its first problem; `folder` is the run folder name the run ID must equal. */
export function checkResult(
  raw: unknown,
  folder: string,
): { result: ElectricalResult } | { problem: ModelProblem } {
  const parsed = electricalResultSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { problem: { path: jsonPath(issue?.path ?? []), message: issue?.message ?? "is invalid" } };
  }
  const result = parsed.data;
  if (result.runId !== folder)
    return {
      problem: { path: "runId", message: `run ID ${result.runId} differs from its folder ${folder}` },
    };
  const units: [string, string][] = [
    ...Object.entries(result.conditions).flatMap(([key, value]) =>
      "unit" in value ? [[`conditions.${key}.unit`, value.unit] as [string, string]] : [],
    ),
    ...result.intermediate.map(
      (value, index) => [`intermediate[${index}].unit`, value.unit] as [string, string],
    ),
    ...result.criteria.flatMap((criterion, index) =>
      (["measured", "limit"] as const).flatMap((end) => {
        const value = criterion[end];
        return value ? [[`criteria[${index}].${end}.unit`, value.unit] as [string, string]] : [];
      }),
    ),
    ...(result.assemblies ?? []).flatMap((assembly, index) =>
      assembly.devices.flatMap((device, at) =>
        device.setting
          ? [[`assemblies[${index}].devices[${at}].setting.unit`, device.setting.unit] as [string, string]]
          : [],
      ),
    ),
  ];
  for (const [path, unit] of units) {
    const message = unitProblem(unit);
    if (message) return { problem: { path, message } };
  }
  return { result };
}

/** Compares every input snapshot with the current model; without a model every input is removed. */
export function resultFreshness(result: ElectricalResult, model: ElectricalModel | null): Freshness {
  const entities = model ? modelEntities(model) : new Map<string, unknown>();
  const changed: string[] = [];
  const removed: string[] = [];
  for (const input of result.inputs) {
    const current = entities.get(input.id);
    if (current === undefined) removed.push(input.id);
    else if (entityHash(current) !== entityHash(input.snapshot)) changed.push(input.id);
  }
  return { freshness: changed.length || removed.length ? "stale" : "current", changed, removed };
}
