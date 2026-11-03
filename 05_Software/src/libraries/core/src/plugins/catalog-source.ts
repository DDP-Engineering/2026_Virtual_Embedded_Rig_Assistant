import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CatalogIndex,
  type CatalogMaintainers,
  type CatalogPack,
  catalogIndexSchema,
  catalogMaintainersSchema,
  catalogPacksSchema,
  dangerousToken,
  ruleNamesProgram,
  type VeraError,
} from "@vera/shared";
import { zipSync } from "fflate";
import { LineCounter, parseDocument } from "yaml";
import type { z } from "zod";
import { type PluginPackage, readPluginPackage } from "./store.js";

/** One finding of the catalog check (spec REQ-DATA-b40d3f9b §2); `where` is a plugin id or file name. */
export interface CatalogIssue {
  where: string;
  code: "source" | "package" | "manifest" | "rules" | "token" | "reference" | "output";
  detail: string;
}
const PACKS = "packs.yaml";
const MAINTAINERS = "catalog.yaml";
/** Every zip entry carries this local date, so one source always gives the same bytes. */
const ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0);
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const errno = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/** A YAML source file parsed with the store's strictness (unique keys, no aliases) and its schema. */
async function readYaml<T extends z.ZodType>(
  folder: string,
  name: string,
  schema: T,
  issues: CatalogIssue[],
): Promise<z.infer<T> | undefined> {
  const problem = (detail: string) => {
    issues.push({ where: name, code: "source", detail });
    return undefined;
  };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(folder, name)));
  } catch (error) {
    return problem(errno(error) === "ENOENT" ? "missing" : "not UTF-8 text");
  }
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  const error = doc.errors[0];
  if (error) return problem(`YAML error at line ${lines.linePos(error.pos[0]).line}`);
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch {
    return problem("YAML aliases are not allowed");
  }
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  return problem(`${first?.path.map(String).join(".") || "(root)"} ${first?.code ?? "invalid"}`);
}

interface Examined {
  issues: CatalogIssue[];
  packages: Map<string, PluginPackage>;
  packs?: CatalogPack[];
  maintainers?: CatalogMaintainers;
}

/** Reads and checks a catalog source; plugins keep folder order (ascending). */
async function examineSource(folder: string): Promise<Examined> {
  const issues: CatalogIssue[] = [];
  const packs = await readYaml(folder, PACKS, catalogPacksSchema, issues);
  const maintainers = await readYaml(folder, MAINTAINERS, catalogMaintainersSchema, issues);
  const names = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(order);
  const known = new Set(names);
  const packages = new Map<string, PluginPackage>();
  for (const name of names) {
    let pkg: PluginPackage;
    try {
      pkg = await readPluginPackage(join(folder, name));
    } catch (error) {
      issues.push({ where: name, code: "package", detail: (error as VeraError).code ?? String(error) });
      continue;
    }
    const { manifest } = pkg;
    for (const issue of pkg.issues)
      issues.push({
        where: name,
        code: "manifest",
        detail: [
          issue.code,
          issue.path,
          issue.issue,
          issue.line === undefined ? undefined : `line ${issue.line}`,
        ]
          .filter(Boolean)
          .join(" "),
      });
    if (!manifest || pkg.issues.length) continue;
    packages.set(name, pkg);
    for (const program of Object.keys(manifest.programs))
      if (!manifest.rules.some((rule) => ruleNamesProgram(rule.match, program)))
        issues.push({ where: name, code: "rules", detail: `program ${program} has no rule` });
    for (const rule of manifest.rules) {
      if (rule.risk !== "safe" && rule.risk !== "device-read") continue;
      const token = dangerousToken(rule.match);
      const reviewed = maintainers?.reviewed.some(
        (mark) => mark.plugin === name && mark.match === rule.match,
      );
      if (token && !reviewed)
        issues.push({ where: name, code: "token", detail: `${token} in "${rule.match}" at ${rule.risk}` });
    }
    for (const required of manifest.requires)
      if (!known.has(required))
        issues.push({ where: name, code: "reference", detail: `requires ${required}` });
  }
  for (const pack of packs ?? [])
    for (const group of pack.groups)
      for (const id of group.plugins)
        if (!known.has(id))
          issues.push({
            where: PACKS,
            code: "reference",
            detail: `pack ${pack.id} group ${group.name} names ${id}`,
          });
  for (const id of maintainers?.official ?? [])
    if (!known.has(id))
      issues.push({ where: MAINTAINERS, code: "reference", detail: `official names ${id}` });
  for (const mark of maintainers?.reviewed ?? []) {
    // A plugin with its own issues is reported above; its marks wait until it reads again.
    if (known.has(mark.plugin) && !packages.has(mark.plugin)) continue;
    if (!packages.get(mark.plugin)?.manifest?.rules.some((rule) => rule.match === mark.match))
      issues.push({
        where: MAINTAINERS,
        code: "reference",
        detail: `reviewed names no rule "${mark.match}" of ${mark.plugin}`,
      });
  }
  return {
    issues,
    packages,
    ...(packs ? { packs } : {}),
    ...(maintainers ? { maintainers } : {}),
  };
}

/** The CI check of a catalog source: every issue, in source order; none means the source may merge. */
export async function checkCatalogSource(folder: string): Promise<CatalogIssue[]> {
  return (await examineSource(folder)).issues;
}

/**
 * The release of a catalog source: one deterministic `<id>-<version>.zip` per plugin (package under
 * `<id>/`) and `index.json`. With any issue, or an output folder that is not empty, nothing is written.
 */
export async function buildCatalogRelease(
  folder: string,
  out: string,
): Promise<{ issues: CatalogIssue[]; index?: CatalogIndex }> {
  const examined = await examineSource(folder);
  const issues = [...examined.issues];
  try {
    if ((await readdir(out)).length)
      issues.push({ where: out, code: "output", detail: "the folder is not empty" });
  } catch (error) {
    if (errno(error) !== "ENOENT") throw error;
  }
  if (issues.length) return { issues };
  const official = new Set(examined.maintainers?.official ?? []);
  const zips = new Map<string, Uint8Array>();
  const plugins: CatalogIndex["plugins"] = [];
  for (const [id, pkg] of examined.packages) {
    const manifest = pkg.manifest;
    if (!manifest) continue;
    const entries: Record<string, Uint8Array> = {};
    for (const path of [...pkg.files.keys()].sort(order))
      entries[`${id}/${path}`] = pkg.files.get(path) ?? new Uint8Array();
    const zip = zipSync(entries, { level: 9, mtime: ZIP_DATE });
    const url = `${id}-${manifest.version}.zip`;
    zips.set(url, zip);
    plugins.push({
      id,
      version: manifest.version,
      tier: official.has(id) ? "official" : "community",
      ecosystem: manifest.ecosystem,
      platforms: manifest.platforms,
      name: manifest.name,
      description: manifest.description,
      requires: manifest.requires,
      url,
      sha256: createHash("sha256").update(zip).digest("hex"),
      bytes: zip.length,
    });
  }
  const parsed = catalogIndexSchema.safeParse({ format: 1, plugins, packs: examined.packs ?? [] });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      issues: [{ where: "index.json", code: "source", detail: `${first?.path.join(".")} ${first?.code}` }],
    };
  }
  await mkdir(out, { recursive: true });
  for (const [name, zip] of zips) await writeFile(join(out, name), zip, { flag: "wx" });
  await writeFile(join(out, "index.json"), `${JSON.stringify(parsed.data, null, 2)}\n`, { flag: "wx" });
  return { issues: [], index: parsed.data };
}
