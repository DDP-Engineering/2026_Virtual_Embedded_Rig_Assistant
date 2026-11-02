import { pluginManifestSchema } from "@vera/shared";
import type { LoadedPlugin } from "./store.js";

/** A loaded plugin without files on disk; the first program gets version 5.1.0. */
export function plugin(
  id: string,
  programs: string[],
  rules: { match: string; risk: string; note?: string }[] = [],
  tier: "local" | "trial" = "local",
): LoadedPlugin {
  return {
    folder: `/plugins/${id}`,
    manifest: pluginManifestSchema.parse({
      format: 1,
      id,
      version: "1.0.0",
      name: id,
      description: "Fixture plugin.",
      ecosystem: "general",
      platforms: ["windows-x64", "linux-x64"],
      programs: Object.fromEntries(
        programs.map((name) => [
          name,
          { install: { pip: name }, version: { args: ["--version"], match: "(\\d+)" } },
        ]),
      ),
      rules,
    }),
    record: {
      format: 1,
      id,
      version: "1.0.0",
      tier,
      source: { kind: "folder", path: `/src/${id}` },
      sha256: "c".repeat(64),
      installedAt: "2026-11-02T00:00:00.000Z",
      programs: { [programs[0] as string]: "5.1.0" },
    },
  };
}
