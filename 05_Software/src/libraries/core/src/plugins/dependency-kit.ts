import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isPluginRelativePath, type PluginProgram, pluginHintLink, urlParts } from "@vera/shared";
import { type CatalogIssue, readCatalogSource } from "./catalog-source.js";

/** The platforms a dependency kit is built for. */
export const DEPENDENCY_KIT_PLATFORMS = ["windows-x64", "linux-x64"] as const;
export type DependencyKitPlatform = (typeof DEPENDENCY_KIT_PLATFORMS)[number];

/** A kit build that failed; its message names the plugin program or file. */
export class DependencyKitError extends Error {
  override name = "DependencyKitError";
}

/** What the kit build needs from outside: the network, uv's resolver and pip, and uv's CPython list. */
export interface DependencyKitTools {
  fetch(url: string, init: { signal?: AbortSignal | undefined }): Promise<Response>;
  /** Resolves one program's requirements for CPython 3.13 on the platform and downloads their wheels into `folder`. */
  wheels(
    platform: DependencyKitPlatform,
    input: { requirement: string } | { script: string },
    folder: string,
  ): Promise<void>;
  /** The URL of the CPython 3.13 archive the pinned uv installs on the platform. */
  python(platform: DependencyKitPlatform): Promise<string>;
}

/** `kit.json` format 1 (spec REQ-DATA-532b02f5). */
export interface DependencyKitIndex {
  format: 1;
  platform: DependencyKitPlatform;
  plugins: { id: string; version: string }[];
  downloads: { file: string; sha256: string; bytes: number; url: string; programs: string[] }[];
  programs: { program: string; kind: "pip" | "script" }[];
  wheels: { file: string; sha256: string; bytes: number }[];
  python?: { file: string; bytes: number };
  vendor: { program: string; guide?: string; link?: string }[];
  /** Official plugins of the platform left out with `--skip`. */
  skipped?: string[];
  bytes: number;
}

/** No pinned download or wheel is larger (the provisioner's limit too). */
const FILE_LIMIT = 2 * 1024 ** 3;
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const errno = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A URL path segment, decoded, when it is a plain file name. */
function plainName(segment: string): string | undefined {
  try {
    const name = decodeURIComponent(segment);
    return isPluginRelativePath(name) && !name.includes("/") && !name.includes("\\") ? name : undefined;
  } catch {
    return undefined;
  }
}
const segments = (url: string) => urlParts(url)?.path.split("/") ?? [];

/**
 * The kit-relative path of a pinned download file (spec REQ-DATA-532b02f5): `files/<sha256>/<name>`, where `<name>`
 * is the URL's last path segment, decoded, or `download` when that is not a plain file name. The kit writer and
 * the provisioner both use it, so a bench finds exactly the file the build stored.
 */
export function dependencyKitFile(entry: { url: string; sha256: string }): string {
  return `files/${entry.sha256}/${plainName(segments(entry.url).at(-1) ?? "") ?? "download"}`;
}

interface Plan {
  plugins: DependencyKitIndex["plugins"];
  downloads: Map<string, { url: string; sha256: string; bytes?: number | undefined; programs: string[] }>;
  programs: {
    program: string;
    kind: "pip" | "script";
    input: { requirement: string } | { script: string };
  }[];
  vendor: DependencyKitIndex["vendor"];
}

/** What the kit of `platform` holds: the official plugins of that platform, from their manifests alone. */
async function plan(
  source: string,
  platform: DependencyKitPlatform,
  skip: readonly string[],
): Promise<{ issues: CatalogIssue[]; plan?: Plan }> {
  const read = await readCatalogSource(source);
  if (read.issues.length) return { issues: read.issues };
  const unknown = skip.filter((id) => !read.official.has(id));
  if (unknown.length) throw new DependencyKitError(`--skip names no official plugin: ${unknown.join(", ")}`);
  const result: Plan = { plugins: [], downloads: new Map(), programs: [], vendor: [] };
  for (const [folder, pkg] of read.packages) {
    const manifest = pkg.manifest;
    if (
      !manifest ||
      !read.official.has(manifest.id) ||
      skip.includes(manifest.id) ||
      !manifest.platforms.includes(platform)
    )
      continue;
    result.plugins.push({ id: manifest.id, version: manifest.version });
    for (const name of Object.keys(manifest.programs).sort(order)) {
      const program = manifest.programs[name] as PluginProgram;
      const id = `${manifest.id}/${name}`;
      const { install } = program;
      if ("pip" in install) {
        result.programs.push({ program: id, kind: "pip", input: { requirement: install.pip } });
        continue;
      }
      if ("script" in install) {
        result.programs.push({
          program: id,
          kind: "script",
          input: { script: join(source, folder, ...install.script.split("/")) },
        });
        continue;
      }
      const entry = install.download?.[platform];
      if (entry) {
        const known = result.downloads.get(entry.sha256);
        if (known) known.programs.push(id);
        else
          result.downloads.set(entry.sha256, {
            url: entry.url,
            sha256: entry.sha256,
            bytes: entry.bytes,
            programs: [id],
          });
      } else if ("find" in install) {
        const guide = "hint" in install ? install.hint : undefined;
        const link = guide ? pluginHintLink(guide) : undefined;
        result.vendor.push({ program: id, ...(guide ? { guide } : {}), ...(link ? { link } : {}) });
      }
    }
  }
  return { issues: [], plan: result };
}

/** Streams `url` into `path` (created new); returns its SHA-256 and size, never more than `limit` bytes. */
async function fetchFile(tools: DependencyKitTools, url: string, path: string, limit: number) {
  const response = await tools.fetch(url, {});
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`cannot fetch ${url} (HTTP ${response.status})`);
  }
  await mkdir(dirname(path), { recursive: true });
  const hash = createHash("sha256");
  const handle = await open(path, "wx");
  let bytes = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(`${url} is larger than ${limit} bytes`);
      }
      hash.update(value);
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), bytes };
}

const mebibytes = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);

function readme(index: DependencyKitIndex): string {
  const example = index.platform === "windows-x64" ? "D:\\\\vera-kit" : "/opt/vera-kit";
  const vendor = index.vendor.length
    ? [
        "| Program | Official download page |",
        "|---|---|",
        ...index.vendor.map(
          (entry) => `| ${entry.program} | ${entry.link ?? entry.guide ?? "see the plugin's README"} |`,
        ),
      ]
    : ["None."];
  return [
    `# VERA dependency kit - ${index.platform}`,
    "",
    `Offline install files for the programs of ${index.plugins.length} official plugins on ${index.platform}:`,
    `${index.downloads.length} download files, ${index.wheels.length} wheels${index.python ? " and the CPython 3.13 archive of VERA's uv" : ""}.`,
    `Size: ${index.bytes} bytes (${mebibytes(index.bytes)} MiB). \`kit.json\` lists every file.`,
    ...(index.skipped ? [`Not in this kit (skipped at build): ${index.skipped.join(", ")}.`] : []),
    "",
    "## Use",
    "",
    "1. Copy this folder to the bench computer.",
    `2. In VERA's \`settings.json\`, set \`"plugins": { "kit": "${example}" }\` to that folder (an absolute path).`,
    "3. Install the plugin, then choose Install dependencies.",
    "",
    "Download files are checked against the SHA-256 pinned in each plugin's manifest: a changed file is refused and",
    "named. One file can also be chosen with Install from dependency archive. While the setting is set, uv installs",
    "pip and script programs only from `wheels/` and CPython only from `python/`, whose archive uv checks against",
    "the SHA-256 built into it. Remove the setting to install from the network again.",
    "",
    "## Vendor programs (not in the kit)",
    "",
    "Install these yourself from their vendor; VERA finds them where the plugin says.",
    "",
    ...vendor,
    "",
  ].join("\n");
}

/**
 * Builds the dependency kit of a catalog source's official plugins for one platform into `out`
 * (spec REQ-DATA-532b02f5). A source with issues builds nothing. Every file is written into a staging sibling that
 * becomes `out` only when complete; any failure throws a DependencyKitError naming the program or file and leaves
 * neither folder, and a non-empty `out` is refused before anything is fetched.
 */
export async function buildDependencyKit(
  source: string,
  platform: DependencyKitPlatform,
  out: string,
  tools: DependencyKitTools,
  options: { skip?: readonly string[] } = {},
): Promise<{ issues: CatalogIssue[]; kit?: DependencyKitIndex }> {
  const skip = [...new Set(options.skip ?? [])].sort(order);
  const planned = await plan(source, platform, skip);
  if (!planned.plan) return { issues: planned.issues };
  const { plugins, downloads, programs, vendor } = planned.plan;
  let existing: string[] | undefined;
  try {
    existing = await readdir(out);
  } catch (error) {
    if (errno(error) !== "ENOENT") throw error;
  }
  if (existing?.length) throw new DependencyKitError(`${out}: the folder is not empty`);
  const staging = `${out}.staging-${randomUUID().slice(0, 8)}`;
  await mkdir(staging, { recursive: true });
  try {
    const index: DependencyKitIndex = {
      format: 1,
      platform,
      plugins,
      downloads: [],
      programs: programs.map(({ program, kind }) => ({ program, kind })),
      wheels: [],
      vendor,
      bytes: 0,
    };
    for (const entry of [...downloads.values()].sort((a, b) => order(a.sha256, b.sha256))) {
      const file = dependencyKitFile(entry);
      const named = entry.programs.join(", ");
      let got: { sha256: string; bytes: number };
      try {
        got = await fetchFile(tools, entry.url, join(staging, ...file.split("/")), entry.bytes ?? FILE_LIMIT);
      } catch (error) {
        throw new DependencyKitError(`${named}: ${failure(error)}`);
      }
      if (got.sha256 !== entry.sha256 || (entry.bytes !== undefined && got.bytes !== entry.bytes))
        throw new DependencyKitError(`${named}: ${entry.url} does not match its pinned SHA-256 and size`);
      index.downloads.push({
        file,
        sha256: entry.sha256,
        bytes: got.bytes,
        url: entry.url,
        programs: entry.programs,
      });
    }
    const wheels = join(staging, "wheels");
    await mkdir(wheels);
    for (const program of programs)
      try {
        await tools.wheels(platform, program.input, wheels);
      } catch (error) {
        throw new DependencyKitError(`${program.program}: ${failure(error)}`);
      }
    for (const name of (await readdir(wheels)).sort(order)) {
      const bytes = await readFile(join(wheels, name));
      index.wheels.push({
        file: `wheels/${name}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
    }
    if (programs.length) {
      let url: string;
      try {
        url = await tools.python(platform);
      } catch (error) {
        throw new DependencyKitError(`CPython: ${failure(error)}`);
      }
      // uv's mirror layout: the release folder and the archive, the last two URL segments.
      const names = segments(url).slice(-2).map(plainName);
      if (!url.startsWith("https://") || names.length !== 2 || names.some((name) => name === undefined))
        throw new DependencyKitError(`CPython: unexpected archive URL ${url}`);
      const file = `python/${names.join("/")}`;
      try {
        const got = await fetchFile(tools, url, join(staging, ...file.split("/")), FILE_LIMIT);
        index.python = { file, bytes: got.bytes };
      } catch (error) {
        throw new DependencyKitError(`CPython: ${failure(error)}`);
      }
    }
    index.bytes =
      index.downloads.reduce((sum, entry) => sum + entry.bytes, 0) +
      index.wheels.reduce((sum, entry) => sum + entry.bytes, 0) +
      (index.python?.bytes ?? 0);
    const ordered: DependencyKitIndex = {
      format: index.format,
      platform: index.platform,
      plugins: index.plugins,
      downloads: index.downloads,
      programs: index.programs,
      wheels: index.wheels,
      ...(index.python ? { python: index.python } : {}),
      vendor: index.vendor,
      ...(skip.length ? { skipped: skip } : {}),
      bytes: index.bytes,
    };
    await writeFile(join(staging, "kit.json"), `${JSON.stringify(ordered, null, 2)}\n`, { flag: "wx" });
    await writeFile(join(staging, "README.md"), readme(ordered), { flag: "wx" });
    if (existing) await rmdir(out);
    await rename(staging, out);
    return { issues: [], kit: ordered };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
