import { extname, posix } from "node:path";
import { binaryDocumentKinds, type DocumentKind, isDocumentKindIn, type WorkbenchConfig } from "@vera/shared";
import { validateGlob } from "../tools/discovery.js";
import { officeFormat } from "./office-format.js";

export const PDF_LIMIT = 100 * 1024 * 1024;
export const TEXT_LIMIT = 20 * 1024 * 1024;
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
  isDocumentKindIn(kind, binaryDocumentKinds) ? PDF_LIMIT : TEXT_LIMIT;
export const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Match tinyglobby's directory expansion/negation once, for both discovery and admission. */
export function documentSelection(docs: WorkbenchConfig["docs"]): { include: string[]; exclude: string[] } {
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
