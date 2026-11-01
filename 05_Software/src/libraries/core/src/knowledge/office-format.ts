import { basename, extname } from "node:path";

// Light office helpers for ingest and hosts; the parsers in office.ts load only where extraction runs.
export type OfficeFormat = "docx" | "pptx" | "xlsx" | "odt" | "odp" | "ods";
export interface OfficeLimits {
  entries: number;
  bytes: number;
}
/** Office files are zip containers from the user's folder: bound them before inflating anything. */
export const OFFICE_LIMITS: OfficeLimits = { entries: 10000, bytes: 500 * 1024 * 1024 };
export class OfficeLimitError extends Error {
  constructor() {
    super("Office archive exceeds extraction limits.");
  }
}
const formats: Record<string, OfficeFormat> = {
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".odt": "odt",
  ".odp": "odp",
  ".ods": "ods",
};
/** Word, Excel and PowerPoint write `~$name` owner (lock) files beside an open document. */
export const isOfficeOwnerFile = (path: string) => basename(path).startsWith("~$");
export function officeFormat(path: string): OfficeFormat | undefined {
  return isOfficeOwnerFile(path) ? undefined : formats[extname(path).toLowerCase()];
}
