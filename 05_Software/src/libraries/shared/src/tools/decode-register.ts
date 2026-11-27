import { z } from "zod";
import { parseLineRef, parseRef } from "../refs.js";

// Match the entire input: JavaScript's $ alone also accepts a final newline.
export const registerValueSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) => /^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.exec(value)?.[0] === value,
    "Use an unsigned decimal or hexadecimal string.",
  );
// Generous bounds: real register and field names are a few dozen characters.
const name = z.string().min(1).max(1024);
const label = z.string().max(1024);
const address = z.string().max(256);
const digits = z.string().max(80);
const device = z.strictObject({ id: name, revision: name });
// Any width up to 64 bits: 24-bit converter results and 12-bit timers are as common as byte multiples.
const widthBits = z.number().int().min(1).max(64);
const lineRef = z.string().refine((ref) => !!parseLineRef(ref), "Use a workbench line reference.");
/**
 * Where the register is documented: lines of a text file, or the page or heading of a document. Register
 * maps come from PDF datasheets, which VERA cites by page.
 */
const sourceRef = z
  .string()
  .max(1024)
  .refine(
    (ref) => ["lines", "page", "page-range", "heading"].includes(parseRef(ref)?.kind ?? ""),
    "Use a workbench reference such as docs/sheet.md#L3-L9 or docs/sheet.pdf#p=12.",
  );
const sourceRefs = z.array(sourceRef).min(1).max(8);
const note = z.string().max(256);
const enumValue = z.union([registerValueSchema, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const field = z.strictObject({
  name,
  lsb: z.number().int().min(0).max(63),
  width: z.number().int().min(1).max(64),
  description: z.string().max(256).optional(),
  enum: z
    .array(z.strictObject({ value: enumValue, label }))
    .max(256)
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
          address: address.optional(),
          // What a datasheet's register table states beside the fields; kept for the reader, not decoded.
          description: note.optional(),
          reset: note.optional(),
          access: note.optional(),
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
  address: address.optional(),
  valueHex: digits,
  valueDec: digits,
  fields: z
    .array(
      z.strictObject({
        name,
        lsb: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        valueHex: digits,
        valueDec: digits,
        label: label.nullable(),
        ref: lineRef.nullable(),
      }),
    )
    .max(64),
  unmappedMaskHex: digits,
  unmappedSetBitsHex: digits,
  source: z.strictObject({
    path: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    ref: lineRef.nullable(),
  }),
  sourceRefs,
});
export type DecodeRegisterResult = z.infer<typeof decodeRegisterResultSchema>;
