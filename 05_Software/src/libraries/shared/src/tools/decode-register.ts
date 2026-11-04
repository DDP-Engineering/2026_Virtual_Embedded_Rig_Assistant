import { z } from "zod";
import { parseLineRef } from "../refs.js";

// Match the entire input: JavaScript's $ alone also accepts a final newline.
export const registerValueSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) => /^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.exec(value)?.[0] === value,
    "Use an unsigned decimal or hexadecimal string.",
  );
const name = z.string().min(1);
const device = z.strictObject({ id: name, revision: name });
const widthBits = z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]);
const lineRef = z.string().refine((ref) => !!parseLineRef(ref), "Use a workbench line reference.");
const sourceRefs = z.array(lineRef).min(1).max(8);
const enumValue = z.union([registerValueSchema, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const field = z.strictObject({
  name,
  lsb: z.number().int().min(0).max(63),
  width: z.number().int().min(1).max(64),
  description: z.string().max(256).optional(),
  enum: z
    .array(z.strictObject({ value: enumValue, label: z.string() }))
    .max(16)
    .optional(),
});
export const decodeRegisterDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    device,
    sourceRefs,
    registers: z
      .array(
        z.strictObject({
          name,
          widthBits,
          address: z.string().optional(),
          sourceRefs: sourceRefs.optional(),
          fields: z.array(field).max(64),
        }),
      )
      .min(1)
      .max(512),
  })
  .superRefine((definition, ctx) => {
    const registers = new Set<string>();
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const register of definition.registers) {
      if (registers.has(register.name)) invalid("Register names must be unique.");
      registers.add(register.name);
      const names = new Set<string>();
      let used = 0n;
      for (const f of register.fields) {
        if (names.has(f.name)) invalid("Field names must be unique.");
        names.add(f.name);
        if (
          !Number.isInteger(f.lsb) ||
          !Number.isInteger(f.width) ||
          f.lsb < 0 ||
          f.width < 1 ||
          f.width > 64 ||
          f.lsb + f.width > register.widthBits
        ) {
          invalid("Field exceeds the register width.");
          continue;
        }
        const max = (1n << BigInt(f.width)) - 1n;
        const mask = max << BigInt(f.lsb);
        if (used & mask) invalid("Field masks overlap.");
        used |= mask;
        const values = new Set<string>();
        for (const entry of f.enum ?? []) {
          if (!enumValue.safeParse(entry.value).success) continue;
          const value = BigInt(entry.value);
          if (value > max || values.has(value.toString()))
            invalid("Enum values must be distinct and fit the field.");
          values.add(value.toString());
        }
      }
    }
  });
export type DecodeRegisterDefinition = z.infer<typeof decodeRegisterDefinitionSchema>;
export const decodeRegisterArgsSchema = z.strictObject({
  definitionPath: z.string().min(1).max(256),
  register: name,
  value: registerValueSchema,
  device: z.strictObject({ id: name, revision: name.optional() }).optional(),
  expectedSha256: z
    .string()
    .length(64)
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});
export type DecodeRegisterArgs = z.infer<typeof decodeRegisterArgsSchema>;
export const decodeRegisterResultSchema = z.strictObject({
  device,
  register: name,
  widthBits,
  address: z.string().optional(),
  valueHex: z.string(),
  valueDec: z.string(),
  fields: z
    .array(
      z.strictObject({
        name,
        lsb: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        valueHex: z.string(),
        valueDec: z.string(),
        label: z.string().nullable(),
        ref: lineRef,
      }),
    )
    .max(64),
  unmappedMaskHex: z.string(),
  unmappedSetBitsHex: z.string(),
  source: z.strictObject({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), ref: lineRef }),
  sourceRefs,
});
export type DecodeRegisterResult = z.infer<typeof decodeRegisterResultSchema>;
