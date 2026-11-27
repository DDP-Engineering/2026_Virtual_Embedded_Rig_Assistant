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

export async function revealArtifact(
  service: SessionService,
  id: string,
  show: (path: string) => void,
): Promise<Record<string, never>> {
  const { path } = await service.verifiedArtifact(id);
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
/** The verified artifact name a save dialog offers; a name that holds a secret is refused. */
export async function exportName(
  service: SessionService,
  id: string,
  scrub: (text: string) => string,
): Promise<string> {
  const {
    artifact: { name },
  } = await service.verifiedArtifact(id);
  if (scrub(name) !== name) throw veraError("INVALID");
  return name;
}
export async function exportArtifact(
  service: SessionService,
  id: string,
  options: {
    root: string;
    choose(name: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    scrub(text: string): string;
    masking?(): boolean;
  },
): Promise<{ exported: boolean }> {
  const path = await options.choose(await exportName(service, id, options.scrub));
  if (path === null) return { exported: false };
  const { artifact } = await service.verifiedArtifact(id);
  await options.write(
    exportDestination(options.root, path),
    options.masking?.() === false ? artifact.content : options.scrub(artifact.content),
  );
  return { exported: true };
}
