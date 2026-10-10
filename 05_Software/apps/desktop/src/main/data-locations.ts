import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PathProvider } from "@vera/core";

export function isPortable(executable: string): boolean {
  try {
    return statSync(join(dirname(executable), "vera.portable")).isFile();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
export function configureDataLocations(
  host: { getPath(name: "userData"): string; setPath(name: "userData", path: string): void },
  executable: string,
  override?: string,
): { portable: boolean; paths: PathProvider } {
  const portable = isPortable(executable);
  const selected = portable ? join(dirname(executable), "data") : override;
  if (selected) {
    // Electron requires overrides to exist, including the first portable launch.
    mkdirSync(selected, { recursive: true });
    host.setPath("userData", selected);
  }
  const userData = host.getPath("userData");
  return {
    portable,
    paths: { userData, settings: join(userData, "settings.json"), logs: join(userData, "logs") },
  };
}
