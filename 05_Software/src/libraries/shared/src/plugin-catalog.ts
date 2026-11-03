import { z } from "zod";
import {
  PLUGIN_LIMITS,
  pluginIdSchema,
  pluginInstalledSchema,
  pluginManifestSchema,
  pluginReviewSchema,
} from "./plugins.js";

/** Limits of a catalog index (spec REQ-DATA-b40d3f9b §4) and its packs (§1.1). */
export const CATALOG_LIMITS = {
  indexBytes: 4 * 1024 * 1024,
  plugins: 1024,
  packs: 64,
  groups: 32,
  groupPlugins: 64,
} as const;
/** Catalog plugins are official or community; `local` and `trial` exist only on this machine. */
export const catalogTierSchema = z.enum(["official", "community"]);
export type CatalogTier = z.infer<typeof catalogTierSchema>;
const unique = <T>(items: readonly T[]) => new Set(items).size === items.length;
const ids = (max: number) => z.array(pluginIdSchema).max(max).refine(unique, "List each plugin once.");

const groupSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  plugins: ids(CATALOG_LIMITS.groupPlugins).min(1),
  default: z.boolean().default(false),
});
/** One ecosystem pack: checkable groups of plugins, some selected by default. */
export const catalogPackSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  groups: z
    .array(groupSchema)
    .min(1)
    .max(CATALOG_LIMITS.groups)
    .refine((groups) => unique(groups.map((group) => group.name)), "Name each group once."),
});
export type CatalogPack = z.infer<typeof catalogPackSchema>;
/** packs.yaml of a catalog source. */
export const catalogPacksSchema = z
  .array(catalogPackSchema)
  .max(CATALOG_LIMITS.packs)
  .refine((packs) => unique(packs.map((pack) => pack.id)), "Name each pack once.");
/** catalog.yaml: the maintainers' file of a catalog source (tiers and reviewed rules). */
export const catalogMaintainersSchema = z.strictObject({
  format: z.literal(1),
  official: ids(CATALOG_LIMITS.plugins).default([]),
  reviewed: z
    .array(z.strictObject({ plugin: pluginIdSchema, match: z.string().min(1).max(1024) }))
    .max(4096)
    .default([]),
});
export type CatalogMaintainers = z.infer<typeof catalogMaintainersSchema>;

const manifest = pluginManifestSchema.shape;
/** One index.json entry: the manifest's identity plus where its zip lies and what it must hash to. */
export const catalogEntrySchema = z.strictObject({
  id: pluginIdSchema,
  version: manifest.version,
  tier: catalogTierSchema,
  ecosystem: manifest.ecosystem,
  platforms: manifest.platforms,
  name: manifest.name,
  description: manifest.description,
  requires: ids(64),
  /** A bare zip file name in the catalog folder, so a mirror is a plain copy. */
  url: z
    .string()
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*\.zip$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().min(1).max(PLUGIN_LIMITS.zipBytes),
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
/** index.json format 1 of a catalog release. */
export const catalogIndexSchema = z.strictObject({
  format: z.literal(1),
  plugins: z
    .array(catalogEntrySchema)
    .max(CATALOG_LIMITS.plugins)
    .refine((plugins) => unique(plugins.map((plugin) => plugin.id)), "List each plugin once."),
  packs: catalogPacksSchema,
});
export type CatalogIndex = z.infer<typeof catalogIndexSchema>;

/** Matched as lowercase substrings of a rule pattern below device-write (architecture §7). */
export const DANGEROUS_TOKENS = [
  "burn",
  "efuse",
  "fuse",
  "otp",
  "rdp",
  "lock",
  "protect",
  "secure",
  "encrypt",
  "transmit",
  "send",
] as const;
/** The first dangerous token a rule pattern contains, in any letter case. */
export function dangerousToken(match: string): string | undefined {
  const text = match.toLowerCase();
  return DANGEROUS_TOKENS.find((token) => text.includes(token));
}

/** Semantic version precedence (build metadata ignored); -1, 0 or 1. */
export function compareVersions(left: string, right: string): number {
  const parse = (version: string) => {
    const [core = "", pre] = (version.split("+")[0] ?? "").split(/-(.*)/s);
    return { core: core.split(".").map(Number), pre: pre ? pre.split(".") : [] };
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i++) {
    const difference = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  // A release ranks above its pre-releases.
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numeric = (part: string) => /^\d+$/.test(part);
    if (numeric(x) && numeric(y)) return Math.sign(Number(x) - Number(y));
    if (numeric(x) !== numeric(y)) return numeric(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
/**
 * A catalog folder URL with a trailing `/`: https, or http on a loopback host; no credentials, query
 * or fragment. Undefined for anything else (spec REQ-DATA-b40d3f9b §5).
 */
export function catalogUrl(value: string): string | undefined {
  const match = /^(https?):\/\/([^/?#@\s\\]+)(\/[^?#\s\\]*)?$/i.exec(value);
  if (!match || value.length > 2048 || !z.url().safeParse(value).success) return undefined;
  const scheme = (match[1] ?? "").toLowerCase();
  const authority = match[2] ?? "";
  const path = match[3] ?? "/";
  if (scheme === "http" && !LOOPBACK.test(authority)) return undefined;
  return `${scheme}://${authority}${path.endsWith("/") ? path : `${path}/`}`;
}
export const catalogUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => catalogUrl(value) !== undefined, "Use an https URL, or http on this computer.");

/** A catalog plugin as the Plugins page lists it, with the installed state on this machine. */
export const catalogPluginSchema = catalogEntrySchema.extend({
  installed: z
    .strictObject({
      version: z.string().max(128).optional(),
      tier: pluginInstalledSchema.shape.tier,
    })
    .optional(),
  /** The index version is higher than the installed one. */
  update: z.boolean(),
});
export type CatalogPlugin = z.infer<typeof catalogPluginSchema>;
/** What the catalog section shows: the remote catalog, the bundled one (offline) or nothing. */
export const pluginCatalogViewSchema = z.strictObject({
  source: z.enum(["remote", "bundled", "none"]),
  url: z.string().max(2048).optional(),
  problem: z.enum(["unreachable", "invalid"]).optional(),
  checkedAt: z.iso.datetime().optional(),
  plugins: z.array(catalogPluginSchema).max(CATALOG_LIMITS.plugins),
  packs: z.array(catalogPackSchema).max(CATALOG_LIMITS.packs),
});
export type PluginCatalogView = z.infer<typeof pluginCatalogViewSchema>;
/** A downloaded, verified catalog package: the store's review plus whether the user must see it. */
export const pluginCatalogReviewSchema = z.strictObject({
  review: pluginReviewSchema,
  id: pluginIdSchema,
  version: manifest.version,
  tier: catalogTierSchema,
  required: z.boolean(),
});
export type PluginCatalogReview = z.infer<typeof pluginCatalogReviewSchema>;
export const pluginCatalogRequestSchema = z.strictObject({ refresh: z.boolean() });
export const pluginCatalogIdRequestSchema = z.strictObject({ id: pluginIdSchema });
export const pluginCatalogInstallRequestSchema = z.strictObject({
  id: pluginIdSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
