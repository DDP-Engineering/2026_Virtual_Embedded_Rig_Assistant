import { readFile } from "node:fs/promises";
import {
  buildCatalogRelease,
  buildDependencyKit,
  type CatalogIssue,
  checkCatalogSource,
  generateCatalogKeys,
  signCatalogRelease,
} from "@vera/core";
import type { CatalogOptions } from "./args.js";
import { cliKitTools } from "./kit-tools.js";
import { cliUv } from "./provisioning.js";

const line = (issue: CatalogIssue) => `${issue.where}: ${issue.code}: ${issue.detail}\n`;
/** The reason only: a key file's content never reaches the output. */
const failed = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  process.stderr.write(
    `vera: ${code === "EEXIST" ? "the key file already exists" : error instanceof Error ? error.message : "failed"}\n`,
  );
  return 1;
};

/**
 * `vera catalog check` prints one line per issue of a catalog source; `vera catalog build` writes its
 * release (zips and index.json) only when there is none; `keygen` writes a new signing key pair,
 * `sign` the channel index signatures of a release and `kit` the offline dependency kit of one platform, whose
 * size it prints. Exit 0 on success, 1 otherwise.
 */
export async function runCatalog(options: CatalogOptions): Promise<number> {
  if (options.kind === "catalog-check") {
    const issues = await checkCatalogSource(options.source);
    for (const issue of issues) process.stdout.write(line(issue));
    return issues.length ? 1 : 0;
  }
  if (options.kind === "catalog-keygen") {
    try {
      await generateCatalogKeys(options.privateKey, options.publicKey);
    } catch (error) {
      return failed(error);
    }
    process.stdout.write(
      `key pair written: ${options.privateKey} (private), ${options.publicKey} (public)\n`,
    );
    return 0;
  }
  if (options.kind === "catalog-sign") {
    try {
      const signed = await signCatalogRelease(
        options.release,
        await readFile(options.key, "utf8"),
        options.publicKey === undefined ? undefined : await readFile(options.publicKey, "utf8"),
      );
      process.stdout.write(`signed ${signed.length} indexes in ${options.release}\n`);
      // Signing with a development key stays possible, but a wrong key must not go unnoticed.
      if (options.publicKey === undefined)
        process.stderr.write(
          "vera: warning: the signing key was not checked; pass --public <file> with the catalog public key that VERA pins\n",
        );
      return 0;
    } catch (error) {
      return failed(error);
    }
  }
  if (options.kind === "catalog-kit") {
    const uv = cliUv();
    if (!uv) {
      process.stderr.write("vera: the pinned uv is missing; run npm run prepare:uv\n");
      return 1;
    }
    try {
      const { issues, kit } = await buildDependencyKit(
        options.source,
        options.platform,
        options.out,
        cliKitTools(uv),
        { skip: options.skip ?? [] },
      );
      for (const issue of issues) process.stdout.write(line(issue));
      if (!kit) return 1;
      process.stdout.write(
        `kit ${kit.platform}: ${kit.downloads.length} downloads, ${kit.wheels.length} wheels, python ${kit.python ? "yes" : "no"}, ${kit.skipped ? `skipped ${kit.skipped.join(", ")}, ` : ""}${kit.bytes} bytes (${(kit.bytes / 1024 ** 2).toFixed(1)} MiB) in ${options.out}\n`,
      );
      return 0;
    } catch (error) {
      return failed(error);
    }
  }
  const { issues, index } = await buildCatalogRelease(options.source, options.out);
  for (const issue of issues) process.stdout.write(line(issue));
  if (!index) return 1;
  process.stdout.write(`${index.plugins.length} plugins written to ${options.out}\n`);
  return 0;
}
