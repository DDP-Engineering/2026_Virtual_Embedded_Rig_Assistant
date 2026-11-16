// Lighting project files, report records and photometry files (spec REQ-DATA-affb2e6b "Files"): strict format-1
// reading with ID and reference checks, and host-scoped input access. VERA only reads these files.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import {
  type LightingProject,
  type LightingReport,
  lightingDir,
  lightingLimits,
  lightingProjectSchema,
  lightingReportSchema,
  photometryDir,
  photometryFileNamePattern,
} from "@vera/shared";
import { PathGuard } from "../workbench/path-guard.js";
import { jsonPath, type ModelProblem, problemsText } from "./model.js";
import { type Photometry, parsePhotometry } from "./photometry.js";

const PROBLEM_LIMIT = 20;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

export interface LightingFileStamp {
  id: string;
  path: string;
  sha256: string;
}
export interface PhotometryStamp {
  name: string;
  path: string;
  sha256: string;
}

type Checked<T> = { value: T } | { problems: ModelProblem[] };
function problemList() {
  const problems: ModelProblem[] = [];
  const add = (path: string, message: string) => {
    if (problems.length < PROBLEM_LIMIT) problems.push({ path, message });
  };
  return { problems, add };
}

/** The project, or its problems (at most 20): unique IDs and resolved references on top of the schema. */
export function checkLightingProject(raw: unknown, fileId?: string): Checked<LightingProject> {
  const parsed = lightingProjectSchema.safeParse(raw);
  if (!parsed.success)
    return {
      problems: parsed.error.issues
        .slice(0, PROBLEM_LIMIT)
        .map((issue) => ({ path: jsonPath(issue.path), message: issue.message })),
    };
  const project = parsed.data;
  const { problems, add } = problemList();
  if (fileId !== undefined && project.id !== fileId)
    add("id", `the id ${project.id} differs from the file name ${fileId}`);
  const ids = new Set<string>([project.id]);
  const unique = (id: string, path: string) => {
    if (ids.has(id)) add(path, `the id ${id} is used twice`);
    ids.add(id);
  };
  for (const [list, entries] of [
    ["types", project.types],
    ["luminaires", project.luminaires],
    ["requirements", project.requirements],
    ["scenarios", project.scenarios],
  ] as const)
    for (const [index, entry] of entries.entries()) unique(entry.id, `${list}[${index}].id`);
  const types = new Set(project.types.map((type) => type.id));
  const luminaires = new Set(project.luminaires.map((luminaire) => luminaire.id));
  const requirements = new Set(project.requirements.map((requirement) => requirement.id));
  project.luminaires.forEach((luminaire, index) => {
    if (!types.has(luminaire.type))
      add(`luminaires[${index}].type`, `the luminaire type ${luminaire.type} is not in types`);
  });
  project.scenarios.forEach((scenario, index) => {
    if (!requirements.has(scenario.requirement))
      add(
        `scenarios[${index}].requirement`,
        `the requirement ${scenario.requirement} is not in requirements`,
      );
    const seen = new Set<string>();
    (scenario.luminaires ?? []).forEach((id, at) => {
      if (!luminaires.has(id))
        add(`scenarios[${index}].luminaires[${at}]`, `the luminaire ${id} is not in luminaires`);
      if (seen.has(id)) add(`scenarios[${index}].luminaires[${at}]`, `the luminaire ${id} is listed twice`);
      seen.add(id);
    });
  });
  const factors = new Set<string>();
  (project.utilisationFactors ?? []).forEach((entry, index) => {
    if (!types.has(entry.type))
      add(`utilisationFactors[${index}].type`, `the luminaire type ${entry.type} is not in types`);
    const key = [entry.type, entry.roomIndex, entry.ceiling, entry.walls, entry.floor, entry.basis].join("|");
    if (factors.has(key))
      add(
        `utilisationFactors[${index}]`,
        "the same type, room index, reflectances and basis are given twice",
      );
    factors.add(key);
  });
  return problems.length ? { problems } : { value: project };
}

/** The report record, or its problems: one surface per scenario and one photometry file per type. */
export function checkLightingReport(raw: unknown, fileId?: string): Checked<LightingReport> {
  const parsed = lightingReportSchema.safeParse(raw);
  if (!parsed.success)
    return {
      problems: parsed.error.issues
        .slice(0, PROBLEM_LIMIT)
        .map((issue) => ({ path: jsonPath(issue.path), message: issue.message })),
    };
  const report = parsed.data;
  const { problems, add } = problemList();
  if (fileId !== undefined && report.id !== fileId)
    add("id", `the id ${report.id} differs from the file name ${fileId}`);
  const scenarios = new Set<string>();
  report.surfaces.forEach((surface, index) => {
    if (scenarios.has(surface.scenario))
      add(`surfaces[${index}].scenario`, `the scenario ${surface.scenario} has two surfaces`);
    scenarios.add(surface.scenario);
    if (surface.minimum > surface.average)
      add(`surfaces[${index}].minimum`, "the minimum is above the average");
    if (surface.maximum !== undefined && surface.maximum < surface.average)
      add(`surfaces[${index}].maximum`, "the maximum is below the average");
  });
  const types = new Set<string>();
  report.photometry.forEach((entry, index) => {
    if (types.has(entry.type)) add(`photometry[${index}].type`, `the type ${entry.type} is given twice`);
    types.add(entry.type);
  });
  return problems.length ? { problems } : { value: report };
}

function parseJson<T>(text: string, label: string, check: (raw: unknown) => Checked<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);
  } catch {
    throw Error(`Invalid ${label}: the file is not JSON.`);
  }
  const checked = check(raw);
  if ("problems" in checked) throw Error(problemsText(label, checked.problems));
  return checked.value;
}
export const parseLightingProject = (text: string, fileId?: string) =>
  parseJson(text, "lighting project", (raw) => checkLightingProject(raw, fileId));
export const parseLightingReport = (text: string, fileId?: string) =>
  parseJson(text, "lighting report record", (raw) => checkLightingReport(raw, fileId));

async function confined(
  root: string,
  path: string,
  label: string,
  limit: number,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
) {
  const target = await (
    inputGuard ?? (await PathGuard.create(root, root, "workbench", undefined, excludedRoots))
  ).resolve(path);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`The ${label} ${path} does not exist.`);
    throw error;
  }
  if (!info.isFile()) throw Error(`The ${label} ${path} is not an ordinary file.`);
  if (info.size > limit) throw Error(`The ${label} ${path} is larger than ${limit / 1024 / 1024} MiB.`);
  return target;
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function readJsonFile(
  root: string,
  id: string,
  label: string,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
) {
  if (!ID.test(id) || id.length > 64) throw Error(`The ${label} id ${JSON.stringify(id)} is not a valid id.`);
  const path = `${lightingDir}/${id}.json`;
  const target = await confined(root, path, label, lightingLimits.fileBytes, excludedRoots, inputGuard);
  const bytes = await readFile(target.absolute);
  inputGuard?.assertAuthorized();
  return { bytes, stamp: { id, path: target.relative, sha256: sha256(bytes) } };
}

/** Reads `electrical-automation-lighting/<id>.json` as a lighting project, using the host input guard (confined by default). */
export async function readLightingProject(
  root: string,
  id: string,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
): Promise<{ project: LightingProject; stamp: LightingFileStamp }> {
  const { bytes, stamp } = await readJsonFile(root, id, "lighting project", excludedRoots, inputGuard);
  return { project: parseLightingProject(bytes.toString("utf8"), id), stamp };
}

/** Reads `electrical-automation-lighting/<id>.json` as a lighting report record, using the host input guard (confined by default). */
export async function readLightingReport(
  root: string,
  id: string,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
): Promise<{ report: LightingReport; stamp: LightingFileStamp }> {
  const { bytes, stamp } = await readJsonFile(root, id, "lighting report record", excludedRoots, inputGuard);
  return { report: parseLightingReport(bytes.toString("utf8"), id), stamp };
}

/** Reads `electrical-automation-photometry/<name>` (.ies or .ldt, Latin-1), using the host input guard (confined by default). */
export async function readPhotometryFile(
  root: string,
  name: string,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
): Promise<{ photometry: Photometry; stamp: PhotometryStamp }> {
  if (!photometryFileNamePattern.test(name))
    throw Error(`The photometry file name ${JSON.stringify(name)} is not a valid .ies or .ldt name.`);
  const path = `${photometryDir}/${name}`;
  const target = await confined(
    root,
    path,
    "photometry file",
    lightingLimits.photometryBytes,
    excludedRoots,
    inputGuard,
  );
  const bytes = await readFile(target.absolute);
  inputGuard?.assertAuthorized();
  return {
    photometry: parsePhotometry(name, bytes.toString("latin1")),
    stamp: { name, path: target.relative, sha256: sha256(bytes) },
  };
}

/** The sha256 of an evidence file (an exported engine report) allowed by the host input guard, streamed. */
export async function hashEvidenceFile(
  root: string,
  path: string,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
): Promise<string> {
  const target = await confined(
    root,
    path,
    "evidence file",
    lightingLimits.evidenceBytes,
    excludedRoots,
    inputGuard,
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target.absolute)) {
    inputGuard?.assertAuthorized();
    hash.update(chunk as Buffer);
  }
  inputGuard?.assertAuthorized();
  return hash.digest("hex");
}
