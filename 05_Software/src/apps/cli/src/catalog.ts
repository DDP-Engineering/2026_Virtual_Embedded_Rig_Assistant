import { buildCatalogRelease, type CatalogIssue, checkCatalogSource } from "@vera/core";
import type { CatalogOptions } from "./args.js";

const line = (issue: CatalogIssue) => `${issue.where}: ${issue.code}: ${issue.detail}\n`;

/**
 * `vera catalog check` prints one line per issue of a catalog source; `vera catalog build` writes its
 * release (zips and index.json) only when there is none. Exit 0 without issues, 1 otherwise.
 */
export async function runCatalog(options: CatalogOptions): Promise<number> {
  if (options.kind === "catalog-check") {
    const issues = await checkCatalogSource(options.source);
    for (const issue of issues) process.stdout.write(line(issue));
    return issues.length ? 1 : 0;
  }
  const { issues, index } = await buildCatalogRelease(options.source, options.out);
  for (const issue of issues) process.stdout.write(line(issue));
  if (!index) return 1;
  process.stdout.write(`${index.plugins.length} plugins written to ${options.out}\n`);
  return 0;
}
