// zod schemas for the three client-configured content types (03): testbench.yaml + topology.yaml,
// catalog/tests/*.yaml, skills/*/SKILL.md frontmatter. Parsing YAML is the server's job; these validate the result.
// Each schema's output type is asserted equal to its domain.ts type below, so the two cannot drift apart.
import { z } from "zod";
import type { CheckDefinition, TestbenchConfig, TestDefinition, Topology } from "../domain.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const id = () => z.string().regex(ID, "letters, digits, '.', '_' or '-'");
const nonEmpty = () => z.string().trim().min(1);

/** Rejects regexes JavaScript cannot compile (catalog `regex` fields run in the evaluators). */
const regexSource = () =>
  z
    .string()
    .min(1)
    .max(200)
    .refine((s) => {
      try {
        new RegExp(s);
        return true;
      } catch {
        return false;
      }
    }, "invalid regular expression");

// ---------------------------------------------------------------- testbench

export const deviceInfoSchema = z.strictObject({
  model: nonEmpty(),
  firmware: z.array(nonEmpty()).min(1),
});

export const testbenchConfigSchema = z.strictObject({
  id: z.string().regex(/^TB-[A-Za-z0-9-]+$/, "testbench ids look like TB-01"),
  name: nonEmpty(),
  description: z.string(),
  device: deviceInfoSchema,
  enabled_tools: z.array(id()),
  enabled_skills: z.array(id()),
  enabled_tests: z.array(id()),
  simulation: z.strictObject({ pools: nonEmpty() }),
});

export const topologySchema = z.strictObject({
  nodes: z
    .array(
      z.strictObject({
        id: id(),
        type: z.enum(["dut", "client", "server", "switch", "probe", "cloud"]),
        label: nonEmpty(),
        addr: z.string().optional(),
        notes: z.string().optional(),
        position: z.strictObject({ x: z.number(), y: z.number() }).optional(),
      }),
    )
    .min(1),
  links: z.array(
    z.strictObject({
      a: id(),
      b: id(),
      port: z.string().optional(),
      vlan: z.number().int().min(1).max(4094).optional(),
      kind: z.enum(["wired", "wifi", "mirror", "uplink"]).optional(),
    }),
  ),
  capture_points: z.array(
    z.strictObject({
      name: id(),
      source: nonEmpty(),
      vlan: z.number().int().min(1).max(4094).optional(),
    }),
  ),
});

// ---------------------------------------------------------------- catalog

const eventMatcherSchema = z.union([
  z.strictObject({ source: id(), regex: regexSource() }),
  z.strictObject({ source: id(), display_filter: nonEmpty() }),
]);

const compareOpSchema = z.enum(["==", "!=", ">", ">=", "<", "<="]);
const checkBase = { id: id(), title: nonEmpty() };

export const checkDefinitionSchema = z.discriminatedUnion("type", [
  z
    .strictObject({
      ...checkBase,
      type: z.literal("interval_between_events"),
      start: eventMatcherSchema,
      end: eventMatcherSchema,
      max_s: z.number().nonnegative().optional(),
      min_s: z.number().nonnegative().optional(),
    })
    .refine((c) => c.max_s !== undefined || c.min_s !== undefined, "needs max_s and/or min_s"),
  z
    .strictObject({
      ...checkBase,
      type: z.literal("packet_count"),
      source: id(),
      display_filter: nonEmpty(),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .refine((c) => c.min !== undefined || c.max !== undefined, "needs min and/or max"),
  z.strictObject({
    ...checkBase,
    type: z.literal("packet_field_all"),
    source: id(),
    display_filter: nonEmpty(),
    field: z.string().regex(/^[A-Za-z0-9_.-]+$/, "a tshark field name"),
    op: compareOpSchema,
    value: z.union([z.number(), z.string()]),
  }),
  z.strictObject({
    ...checkBase,
    type: z.literal("metric_threshold"),
    metric: id(),
    agg: z.enum(["avg", "min", "max", "p95", "last"]),
    op: compareOpSchema,
    value: z.number(),
    unit: z.string(),
  }),
  z.strictObject({
    ...checkBase,
    type: z.literal("metric_trend"),
    metric: id(),
    max_decline_per_hour: z.number().nonnegative(),
  }),
  z.strictObject({ ...checkBase, type: z.literal("log_absent"), source: id(), regex: regexSource() }),
]);

export const testDefinitionSchema = z
  .strictObject({
    id: z.string().regex(/^TC-[A-Z0-9]+-\d{3}$/, "test ids look like TC-DHCP-001"),
    name: nonEmpty(),
    version: z.number().int().positive(),
    area: z.array(id()).min(1),
    owner: nonEmpty(),
    description: nonEmpty(),
    procedure: nonEmpty(),
    inputs: z.array(id()).min(1),
    duration: z.strictObject({ sim_s: z.number().positive(), demo_s: z.number().positive() }),
    checks: z.array(checkDefinitionSchema).min(1),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    for (const [i, c] of t.checks.entries()) {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", path: ["checks", i, "id"], message: `duplicate check id '${c.id}'` });
      seen.add(c.id);
      // Every artifact a check reads must be one of the test's declared inputs.
      const sources =
        c.type === "interval_between_events" ? [c.start.source, c.end.source] : "source" in c ? [c.source] : [];
      for (const s of sources)
        if (!t.inputs.includes(s))
          ctx.addIssue({ code: "custom", path: ["checks", i], message: `source '${s}' is not in inputs` });
    }
  });

// ---------------------------------------------------------------- skills

/** SKILL.md frontmatter (Agent Skills format). Extra keys (license, metadata, …) are allowed and ignored. */
export const skillFrontmatterSchema = z.looseObject({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase words joined by '-'").max(64),
  description: z.string().trim().min(20).max(1024),
});

/** 03 §3: a skill body is markdown of at most 120 lines. */
export const SKILL_BODY_MAX_LINES = 120;

// ---------------------------------------------------------------- type equality with domain.ts

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type _TestbenchConfigMatches = Assert<Equals<z.infer<typeof testbenchConfigSchema>, TestbenchConfig>>;
export type _TopologyMatches = Assert<Equals<z.infer<typeof topologySchema>, Topology>>;
export type _CheckDefinitionMatches = Assert<Equals<z.infer<typeof checkDefinitionSchema>, CheckDefinition>>;
export type _TestDefinitionMatches = Assert<Equals<z.infer<typeof testDefinitionSchema>, TestDefinition>>;

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;
