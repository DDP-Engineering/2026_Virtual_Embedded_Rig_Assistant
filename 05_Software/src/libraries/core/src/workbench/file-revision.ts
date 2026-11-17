import type { Stats } from "node:fs";

/** Binds a verified snapshot to subsequent positional reads, including same-size replacements. */
export function fileRevision(stat: Stats): string {
  return JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
}
