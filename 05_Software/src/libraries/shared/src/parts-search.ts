import { z } from "zod";

/** Supplier catalogs reached by the host for the official parts-search plugin; credentials stay in the host. */
export const partsSupplierIds = ["mouser", "digikey", "tme", "farnell", "rutronik"] as const;
export const partsSupplierIdSchema = z.enum(partsSupplierIds);
export type PartsSupplierId = z.infer<typeof partsSupplierIdSchema>;
/** `pair`: the credential has a public part (client id, API token) next to its secret. */
export const partsSuppliers = {
  mouser: { name: "Mouser", pair: false },
  digikey: { name: "DigiKey", pair: true },
  tme: { name: "TME", pair: true },
  farnell: { name: "Farnell", pair: false },
  rutronik: { name: "Rutronik", pair: false },
} as const satisfies Record<PartsSupplierId, { name: string; pair: boolean }>;
/** The plugin whose installation, validity and enablement opens the capability. */
export const partsSearchPluginId = "parts-search";

export const partsSearchSettingsSchema = z.strictObject({
  suppliers: z.strictObject({
    mouser: z.strictObject({ enabled: z.boolean() }),
    digikey: z.strictObject({ enabled: z.boolean() }),
    tme: z.strictObject({ enabled: z.boolean() }),
    farnell: z.strictObject({ enabled: z.boolean() }),
    rutronik: z.strictObject({ enabled: z.boolean() }),
  }),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[a-z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  farnellStore: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{1,62}[a-z0-9])$/),
});
export type PartsSearchSettings = z.infer<typeof partsSearchSettingsSchema>;
export const partsSearchDefaults: PartsSearchSettings = {
  suppliers: {
    mouser: { enabled: false },
    digikey: { enabled: false },
    tme: { enabled: false },
    farnell: { enabled: false },
    rutronik: { enabled: false },
  },
  country: "US",
  language: "en",
  currency: "USD",
  farnellStore: "uk.farnell.com",
};

/** A key, secret, client id or token: printable ASCII without spaces. */
export const partsSecretSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[!-~]+$/);
export const partsCredentialSchema = z.strictObject({
  secret: partsSecretSchema,
  id: partsSecretSchema.optional(),
});
export type PartsCredential = z.infer<typeof partsCredentialSchema>;
const pairComplete = (value: {
  supplier?: PartsSupplierId | undefined;
  credential?: PartsCredential | undefined;
}) =>
  !value.credential ||
  !value.supplier ||
  partsSuppliers[value.supplier].pair === (value.credential.id !== undefined);

export const partsAccessSaveSchema = z
  .strictObject({
    preferences: partsSearchSettingsSchema,
    supplier: partsSupplierIdSchema.optional(),
    credential: partsCredentialSchema.optional(),
    storageConsent: z.boolean().optional(),
  })
  .refine((value) => (value.credential === undefined) === (value.supplier === undefined))
  .refine(pairComplete);
export const partsAccessSaveResultSchema = z.strictObject({ status: z.enum(["saved", "consent-required"]) });
export const partsAccessSnapshotSchema = z.strictObject({
  preferences: partsSearchSettingsSchema,
  keys: z.record(
    partsSupplierIdSchema,
    z.strictObject({
      keyConfigured: z.boolean(),
      storage: z.enum(["encrypted", "unprotected", "memory"]).nullable(),
    }),
  ),
  secureStorage: z.boolean(),
});
export const partsAccessSupplierSchema = z.strictObject({ supplier: partsSupplierIdSchema });
export const partsAccessTestSchema = z.strictObject({ testId: z.uuid(), supplier: partsSupplierIdSchema });
export const partsAccessCancelSchema = z.strictObject({ testId: z.uuid() });
export const partsSupplierStatuses = [
  "ok",
  "partial",
  "failed",
  "key-required",
  "auth",
  "rate-limited",
  "timeout",
  "unavailable",
] as const;
export type PartsSupplierStatus = (typeof partsSupplierStatuses)[number];
export const partsAccessTestResultSchema = z.strictObject({
  testId: z.uuid(),
  supplier: partsSupplierIdSchema,
  status: z.enum([...partsSupplierStatuses, "disabled", "cancelled"]),
  checkedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
});
export type PartsAccessSave = z.infer<typeof partsAccessSaveSchema>;
export type PartsAccessSnapshot = z.infer<typeof partsAccessSnapshotSchema>;
export type PartsAccessTest = z.infer<typeof partsAccessTestSchema>;
export type PartsAccessTestResult = z.infer<typeof partsAccessTestResultSchema>;

/** Arguments of the `parts_search` tool: exactly one of a keyword query and a part number. */
export const partsSearchArgsSchema = z
  .strictObject({
    query: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .regex(/^[^\p{Cc}]*$/u)
      .optional(),
    mpn: z
      .string()
      .regex(/^[!-{}~][ -{}~]{0,62}[!-{}~]$/)
      .optional(),
    supplier: z.union([partsSupplierIdSchema, z.literal("all")]).default("all"),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .refine((value) => (value.query === undefined) !== (value.mpn === undefined), {
    message: "Give exactly one of query (keyword text) and mpn (a part number).",
  });
export type PartsSearchArgs = z.infer<typeof partsSearchArgsSchema>;
