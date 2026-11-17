import { createRequire } from "node:module";

/**
 * The CLI's own version. Resolved by package name, so it holds for the source, the built `dist` and the
 * private bundles in `node_modules/.cache`, which do not sit beside the package file.
 */
export const cliVersion: string = createRequire(import.meta.url)("@vera/cli/package.json").version;
