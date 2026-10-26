import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SessionService } from "@vera/core";
import { type ArtifactSummary, veraError } from "@vera/shared";

export function publicArtifact<T extends ArtifactSummary>(artifact: T, scrub: (text: string) => string): T {
  if (scrub(artifact.name) !== artifact.name) throw veraError("INVALID");
  return {
    ...artifact,
    description: artifact.description === null ? null : scrub(artifact.description),
    ...("content" in artifact && typeof artifact.content === "string"
      ? { content: scrub(artifact.content) }
      : {}),
  };
}

export function revealArtifact(
  service: SessionService,
  id: string,
  show: (path: string) => void,
): Record<string, never> {
  const { path } = service.verifiedArtifact(id);
  show(path);
  return {};
}
export function exportDestination(root: string, path: string): string {
  if (!isAbsolute(path)) throw veraError("INVALID");
  let existing = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      existing = realpathSync(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      suffix.unshift(relative(parent, existing));
      existing = parent;
    }
  }
  const target = join(existing, ...suffix),
    runtime = join(realpathSync(root), ".vera");
  const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const inside = relative(key(runtime), key(target));
  if (inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)))
    throw veraError("DENIED");
  return target;
}
export async function exportArtifact(
  service: SessionService,
  id: string,
  options: {
    root: string;
    choose(name: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    scrub(text: string): string;
  },
): Promise<{ exported: boolean }> {
  const name = service.verifiedArtifact(id).artifact.name;
  if (options.scrub(name) !== name) throw veraError("INVALID");
  const path = await options.choose(name);
  if (path === null) return { exported: false };
  const { artifact } = service.verifiedArtifact(id);
  await options.write(exportDestination(options.root, path), options.scrub(artifact.content));
  return { exported: true };
}
