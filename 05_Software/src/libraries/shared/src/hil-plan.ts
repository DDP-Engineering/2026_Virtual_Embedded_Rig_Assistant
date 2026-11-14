import { z } from "zod";

/**
 * A hardware-in-the-loop test plan, format 1 (spec REQ-DATA-5f714098 §2): declarative data that VERA core compiles into
 * finite operations of enabled plugins. Step parameters (`with`) are checked by the step's adapter in core.
 */
export const HIL_PLAN_BYTES = 256 * 1024;
/** The total of `repeat x (1 + retries)` over a plan's steps. */
export const HIL_MAX_ATTEMPTS = 256;

/** No C0 control character and no DEL. */
export const noControlCharacters = (value: string) =>
  ![...value].some((char) => char < " " || char === "\u007f");
const text = (max: number) =>
  z.string().min(1).max(max).refine(noControlCharacters, "Use no control characters.");
const seconds = z.number().int().min(1).max(3600);
export const hilStepIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export const hilFirmwareEffectSchema = z.enum(["device-read", "device-write", "irreversible"]);
export const hilPhaseSchema = z.enum(["setup", "test"]);

const common = {
  id: hilStepIdSchema,
  use: z.string().regex(/^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31})?$/),
  with: z.record(z.string(), z.unknown()).optional(),
  timeout: seconds.optional(),
  expect: text(256).optional(),
};
export const hilStepSchema = z.strictObject({
  ...common,
  phase: hilPhaseSchema.optional(),
  retries: z.number().int().min(0).max(5).optional(),
  repeat: z.number().int().min(1).max(100).optional(),
  background: z.literal(true).optional(),
  skip: text(200).optional(),
});
export const hilCleanupStepSchema = z.strictObject(common);
export type HilStep = z.infer<typeof hilStepSchema>;
export type HilCleanupStep = z.infer<typeof hilCleanupStepSchema>;

export const hilPlanSchema = z
  .strictObject({
    format: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    title: text(200),
    setup: z.strictObject({
      board: text(80),
      revision: text(40),
      description: text(1000),
      wiring: z.array(text(200)).max(32),
      firmwareEffect: hilFirmwareEffectSchema,
      effectNote: text(500),
      interlocks: z.array(text(200)).max(16).optional(),
    }),
    firmware: z
      .strictObject({
        path: text(1024),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        format: z.enum(["elf", "hex", "bin"]),
        address: z
          .string()
          .regex(/^0x[0-9a-fA-F]{1,8}$/)
          .optional(),
      })
      .refine((firmware) => (firmware.format === "bin") === (firmware.address !== undefined), {
        message: "A bin image needs its address; elf and hex images carry their own.",
        path: ["address"],
      }),
    budget: z.strictObject({ seconds }),
    steps: z.array(hilStepSchema).min(1).max(64),
    cleanup: z.array(hilCleanupStepSchema).max(16).optional(),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (const [group, steps] of [
      ["steps", plan.steps],
      ["cleanup", plan.cleanup ?? []],
    ] as const)
      for (const [index, step] of steps.entries()) {
        if (seen.has(step.id))
          ctx.addIssue({ code: "custom", path: [group, index, "id"], message: "Use each step id once." });
        seen.add(step.id);
      }
    if (!plan.steps.some((step) => (step.phase ?? "test") === "test"))
      ctx.addIssue({ code: "custom", path: ["steps"], message: "A plan needs at least one test step." });
    const attempts = plan.steps.reduce(
      (sum, step) => sum + (step.repeat ?? 1) * (1 + (step.retries ?? 0)),
      0,
    );
    if (attempts > HIL_MAX_ATTEMPTS)
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: `The steps allow ${attempts} attempts; at most ${HIL_MAX_ATTEMPTS} (repeat x (1 + retries)).`,
      });
  });
export type HilPlan = z.infer<typeof hilPlanSchema>;

export interface HilProblem {
  /** Dotted path into the plan, `""` for the document itself. */
  readonly path: string;
  readonly message: string;
}
/** Every schema problem of a plan document with the dotted path it concerns; unknown keys name the key itself. */
export function hilPlanProblems(value: unknown): HilProblem[] {
  const parsed = hilPlanSchema.safeParse(value);
  if (parsed.success) return [];
  const problems: HilProblem[] = [];
  for (const issue of parsed.error.issues) {
    const base = issue.path.map(String);
    if (issue.code === "unrecognized_keys")
      for (const key of issue.keys)
        problems.push({ path: [...base, key].join("."), message: `Unknown field ${key}.` });
    else problems.push({ path: base.join("."), message: issue.message });
  }
  return problems;
}
