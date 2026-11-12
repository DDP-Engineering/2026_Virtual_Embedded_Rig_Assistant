import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tooling under 02_Tools is outside 05_Software, so Node cannot find 05_Software/node_modules by
// walking up from these files. Resolve every package as 05_Software itself would: one pinned
// dependency tree, no second install and no global tools.

/** Absolute path of 05_Software, the npm workspaces root. */
export const software = fileURLToPath(new URL("../../05_Software/", import.meta.url));

/** `require` and `require.resolve` anchored at 05_Software/package.json. */
export const softwareRequire = createRequire(join(software, "package.json"));

/** Dynamic `import()` of a package installed in 05_Software/node_modules. */
export function importSoftware(specifier) {
  return import(pathToFileURL(softwareRequire.resolve(specifier)).href);
}
