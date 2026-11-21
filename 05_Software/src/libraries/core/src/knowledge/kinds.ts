import { extname, posix } from "node:path";
import {
  advancedSettings,
  binaryDocumentKinds,
  type DocumentKind,
  isDocumentKindIn,
  resolveAdvanced,
  type WorkbenchConfig,
} from "@vera/shared";
import { validateGlob } from "../tools/discovery.js";
import { officeFormat } from "./office-format.js";

const MIB = 1024 * 1024;
/** The default size limits: docs.maxFileMB unset (PDF and Office) and textFileMB unset (text). */
export const PDF_LIMIT = 100 * MIB;
export const TEXT_LIMIT = advancedSettings.textFileMB.default * MIB;
/**
 * The largest sizes any setting allows. Inspection, the viewer, read_doc and citation checks accept sources up
 * to them, so a document a raised limit selected never fails a later check (REQ-FUNC-486d6a86).
 */
export const MAX_BINARY_BYTES = 500 * MIB;
export const MAX_TEXT_BYTES = advancedSettings.textFileMB.max * MIB;
/**
 * Plain text and tabular documents (pinouts, register maps); code, logs and other data files are
 * not indexed (TASK-e5310cdb, RULING-005).
 */
const textExtensions = new Set([".txt", ".csv", ".tsv"]);
export function documentKind(path: string): DocumentKind {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".html" || ext === ".htm") return "html";
  const office = officeFormat(path);
  if (office === "docx" || office === "odt") return "document";
  if (office === "pptx" || office === "odp") return "presentation";
  if (office === "xlsx" || office === "ods") return "spreadsheet";
  return textExtensions.has(ext) ? "text" : "other";
}
/** Binary containers (PDF, office) share the larger source budget and skip the text check. */
export const sourceLimit = (kind: DocumentKind) =>
  isDocumentKindIn(kind, binaryDocumentKinds) ? MAX_BINARY_BYTES : MAX_TEXT_BYTES;
/** The workbench docs a selection reads, with the resolved text size (an internal field, never stored). */
export type SelectionDocs = Pick<WorkbenchConfig["docs"], "maxFileMB"> & { maxTextMB?: number };
/**
 * The size a document may have (REQ-FUNC-133f57ee): docs.maxFileMB for PDF and Office (100 MB when unset, at
 * most 500) and the Maximum text file size for text (20 MiB when unset).
 */
export const sizeLimit = (kind: DocumentKind, docs: SelectionDocs) =>
  isDocumentKindIn(kind, binaryDocumentKinds)
    ? Math.floor((docs.maxFileMB ?? PDF_LIMIT / MIB) * MIB)
    : (docs.maxTextMB ?? TEXT_LIMIT / MIB) * MIB;
/** The docs of a workbench config with its resolved text size, for selection and the ingest size check. */
export function selectionDocs<D extends WorkbenchConfig["docs"]>(config: {
  docs: D;
  advanced?: WorkbenchConfig["advanced"];
}): D & { maxTextMB: number } {
  return { ...config.docs, maxTextMB: resolveAdvanced("textFileMB", { workbench: config.advanced }).value };
}
export const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Match tinyglobby's directory expansion/negation once, for both discovery and admission. */
export function documentSelection(docs: Pick<WorkbenchConfig["docs"], "include" | "exclude">): {
  include: string[];
  exclude: string[];
} {
  const include: string[] = [],
    exclude: string[] = [];
  const normalize = (pattern: string) => {
    validateGlob(pattern);
    let result = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
    if (!result.endsWith("*")) result += "/**";
    return posix.normalize(result);
  };
  for (const pattern of docs.exclude) {
    if (pattern && (!pattern.startsWith("!") || pattern.startsWith("!("))) exclude.push(normalize(pattern));
  }
  for (const pattern of docs.include) {
    if (!pattern) continue;
    if (!pattern.startsWith("!") || pattern.startsWith("!(")) include.push(normalize(pattern));
    else if (!pattern.startsWith("!!") || pattern.startsWith("!!("))
      exclude.push(normalize(pattern.slice(1)));
  }
  return { include, exclude };
}
