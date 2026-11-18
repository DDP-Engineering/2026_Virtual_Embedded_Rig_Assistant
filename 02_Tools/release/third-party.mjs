import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The workspaces whose code the desktop bundle contains. */
const bundledWorkspaces = ["src/apps/desktop", "src/libraries/core", "src/libraries/shared"];

/**
 * The third-party libraries of the desktop application with version and license: the direct dependencies
 * of every bundled workspace, as package-lock.json pins them. `software` is the 05_Software folder.
 */
export function thirdPartyComponents(software) {
  const lock = JSON.parse(readFileSync(join(software, "package-lock.json"), "utf8")).packages ?? {};
  const components = new Map();
  for (const workspace of bundledWorkspaces) {
    const manifest = JSON.parse(readFileSync(join(software, workspace, "package.json"), "utf8"));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (name.startsWith("@vera/")) continue;
      // A workspace's own copy wins over the hoisted one, as Node resolves it.
      const entry = lock[`${workspace}/node_modules/${name}`] ?? lock[`node_modules/${name}`] ?? {};
      const version = String(entry.version ?? "");
      components.set(`${name}@${version}`, { name, version, license: String(entry.license ?? "") });
    }
  }
  return [...components.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
  );
}

/** The same list as plain text, one component per line, for the file that ships beside the license. */
export function thirdPartyNotices(software) {
  const lines = thirdPartyComponents(software).map((item) =>
    [item.name, item.version, item.license || "license not declared"].join("  "),
  );
  return `VERA includes these third-party components (name, version, license):\n\n${lines.join("\n")}\n`;
}
