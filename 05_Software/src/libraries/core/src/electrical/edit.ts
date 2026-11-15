// Model change operations and the explicit-mapping import (spec REQ-DATA-06c0bd54 "Tools"), applied to an
// in-memory model. The caller validates the result with checkModel before anything is written.
import { randomBytes } from "node:crypto";
import {
  type ElectricalModel,
  type ElectricalObject,
  type ElectricalQuantity,
  electricalIdPrefixes,
  electricalIdSchema,
  electricalObjectSchema,
  electricalProfileSchema,
  electricalQuantitySchema,
  electricalRelationSchema,
  electricalSourceSchema,
} from "@vera/shared";
import { z } from "zod";
import { parseModel } from "./model.js";

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const objectFields = electricalObjectSchema.shape;
export const electricalOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("set-project"),
    name: electricalObjectSchema.shape.name,
    profile: electricalProfileSchema.optional(),
  }),
  z.strictObject({ op: z.literal("add-source"), source: electricalSourceSchema.partial({ id: true }) }),
  z.strictObject({ op: z.literal("remove-source"), id: electricalIdSchema }),
  z.strictObject({ op: z.literal("add-object"), object: electricalObjectSchema.partial({ id: true }) }),
  z.strictObject({
    op: z.literal("update-object"),
    id: electricalIdSchema,
    ref: nullable(objectFields.ref.unwrap()),
    name: nullable(objectFields.name.unwrap()),
    note: nullable(objectFields.note.unwrap()),
    attributes: z.record(z.string(), z.union([z.string(), z.boolean()]).nullable()).optional(),
    properties: z.record(z.string(), electricalQuantitySchema.nullable()).optional(),
  }),
  z.strictObject({ op: z.literal("remove-object"), id: electricalIdSchema }),
  z.strictObject({ op: z.literal("add-relation"), relation: electricalRelationSchema.partial({ id: true }) }),
  z.strictObject({ op: z.literal("remove-relation"), id: electricalIdSchema }),
  z.strictObject({
    op: z.literal("import"),
    path: z.string().min(1).max(1024),
    mapping: z.record(electricalIdSchema, z.union([z.literal("new"), electricalIdSchema])),
  }),
]);
export type ElectricalOperation = z.infer<typeof electricalOperationSchema>;
export interface EditHost {
  /** Reads a workbench file for an import; confined to the workbench and bounded by the caller. */
  readImport(path: string): Promise<string>;
  /** A fresh ID with the prefix; tests inject a deterministic one. */
  newId?(prefix: string): string;
}

const editError = (index: number, message: string) =>
  Error(`Invalid electrical model change: operations[${index}]: ${message}`);
const randomId = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;

/** Replaces source citations through the mapping; properties keep their order. */
function remapSources(object: ElectricalObject, mapping: Record<string, string>): ElectricalObject {
  if (!object.properties) return object;
  const properties: Record<string, ElectricalQuantity> = {};
  for (const [name, quantity] of Object.entries(object.properties))
    properties[name] = quantity.source
      ? { ...quantity, source: { ...quantity.source, id: mapping[quantity.source.id] ?? quantity.source.id } }
      : quantity;
  return { ...object, properties };
}

/**
 * Applies the operations in order to a copy of the model (null when the workbench has none yet) and returns the
 * new model with the IDs generated on the way. Throws `Invalid electrical model change:` on an operation that
 * cannot apply; the returned model still has to pass checkModel.
 */
export async function applyOperations(
  current: ElectricalModel | null,
  operations: readonly ElectricalOperation[],
  host: EditHost,
): Promise<{ model: ElectricalModel; ids: string[] }> {
  const newId = host.newId ?? randomId;
  const ids: string[] = [];
  const fresh = (prefix: string) => {
    const id = newId(prefix);
    ids.push(id);
    return id;
  };
  let model: ElectricalModel | null = current && structuredClone(current);
  for (const [index, operation] of operations.entries()) {
    if (!model) {
      if (operation.op !== "set-project" || operation.name === undefined)
        throw editError(
          index,
          "the workbench has no electrical model yet: start with set-project and a name",
        );
      model = {
        kind: "vera-electrical-model",
        format: 1,
        project: {
          id: fresh(electricalIdPrefixes.project),
          name: operation.name,
          profile: operation.profile ?? { jurisdiction: null, domain: null, standards: [], limits: [] },
        },
        sources: [],
        objects: [],
        relations: [],
      };
      continue;
    }
    const at = (list: { id: string }[], id: string, kind: string) => {
      const found = list.findIndex((item) => item.id === id);
      if (found < 0) throw editError(index, `no ${kind} ${id}`);
      return found;
    };
    switch (operation.op) {
      case "set-project":
        if (operation.name !== undefined) model.project.name = operation.name;
        if (operation.profile !== undefined) model.project.profile = operation.profile;
        break;
      case "add-source":
        model.sources.push({
          ...operation.source,
          id: operation.source.id ?? fresh(electricalIdPrefixes.sourceRecord),
        });
        break;
      case "remove-source":
        model.sources.splice(at(model.sources, operation.id, "source"), 1);
        break;
      case "add-object":
        model.objects.push({
          ...operation.object,
          id: operation.object.id ?? fresh(electricalIdPrefixes[operation.object.type]),
        });
        break;
      case "update-object": {
        const object = model.objects[at(model.objects, operation.id, "object")] as ElectricalObject;
        for (const field of ["ref", "name", "note"] as const) {
          const value = operation[field];
          if (value === null) delete object[field];
          else if (value !== undefined) object[field] = value;
        }
        for (const field of ["attributes", "properties"] as const) {
          const changes = operation[field];
          if (!changes) continue;
          const merged: Record<string, unknown> = { ...object[field] };
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) delete merged[key];
            else merged[key] = value;
          }
          if (Object.keys(merged).length) (object as Record<string, unknown>)[field] = merged;
          else delete object[field];
        }
        break;
      }
      case "remove-object":
        model.objects.splice(at(model.objects, operation.id, "object"), 1);
        break;
      case "add-relation":
        model.relations.push({
          ...operation.relation,
          id: operation.relation.id ?? fresh(electricalIdPrefixes.relation),
        });
        break;
      case "remove-relation":
        model.relations.splice(at(model.relations, operation.id, "relation"), 1);
        break;
      case "import":
        model = await importExchange(model, operation, index, host);
        break;
    }
  }
  if (!model) throw Error("Invalid electrical model change: no operation.");
  return { model, ids };
}

async function importExchange(
  model: ElectricalModel,
  operation: Extract<ElectricalOperation, { op: "import" }>,
  index: number,
  host: EditHost,
): Promise<ElectricalModel> {
  let exchange: ElectricalModel;
  try {
    exchange = parseModel(await host.readImport(operation.path), "exchange file");
  } catch (error) {
    throw editError(index, error instanceof Error ? error.message : "the exchange file cannot be read");
  }
  const { mapping } = operation;
  const imported = [
    ...exchange.sources.map((item) => ({ kind: "source", id: item.id, type: undefined })),
    ...exchange.objects.map((item) => ({
      kind: "object",
      id: item.id,
      type: item.type as string | undefined,
    })),
    ...exchange.relations.map((item) => ({ kind: "relation", id: item.id, type: undefined })),
  ];
  const listed = new Set(imported.map((item) => item.id));
  const unmapped = imported.filter((item) => !(item.id in mapping)).map((item) => item.id);
  if (unmapped.length)
    throw editError(index, `the mapping does not name ${unmapped.slice(0, 20).join(", ")}`);
  const extra = Object.keys(mapping).filter((id) => !listed.has(id));
  if (extra.length) throw editError(index, `the exchange file holds no ${extra.slice(0, 20).join(", ")}`);
  const existing = new Map<string, { kind: string; type?: string }>([
    [model.project.id, { kind: "project" }],
    ...model.sources.map((item) => [item.id, { kind: "source" }] as const),
    ...model.objects.map((item) => [item.id, { kind: "object", type: item.type }] as const),
    ...model.relations.map((item) => [item.id, { kind: "relation" }] as const),
  ]);
  const target: Record<string, string> = {};
  const targets = new Set<string>();
  for (const item of imported) {
    const to = mapping[item.id] as string;
    const id = to === "new" ? item.id : to;
    const found = existing.get(id);
    if (to === "new" && found)
      throw editError(index, `${item.id} is mapped as new but the model already holds it`);
    if (to !== "new" && (!found || found.kind !== item.kind || found.type !== item.type))
      throw editError(
        index,
        `${item.id} is mapped to ${to}, which is not an existing ${item.type ?? item.kind}`,
      );
    if (targets.has(id)) throw editError(index, `two imported entities are mapped to ${id}`);
    targets.add(id);
    target[item.id] = id;
  }
  const merge = <T extends { id: string }>(list: T[], items: T[]) => {
    for (const item of items) {
      const found = list.findIndex((entry) => entry.id === item.id);
      if (found < 0) list.push(item);
      else list[found] = item;
    }
  };
  const next = structuredClone(model);
  const mapped = (id: string) => target[id] ?? id;
  merge(
    next.sources,
    exchange.sources.map((source) => ({ ...source, id: mapped(source.id) })),
  );
  merge(
    next.objects,
    exchange.objects.map((object) => remapSources({ ...object, id: mapped(object.id) }, target)),
  );
  merge(
    next.relations,
    exchange.relations.map((relation) => ({
      ...relation,
      id: mapped(relation.id),
      from: mapped(relation.from),
      to: mapped(relation.to),
    })),
  );
  return next;
}
