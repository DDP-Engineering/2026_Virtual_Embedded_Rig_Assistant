import type { WorkbenchConfig } from "@vera/shared";

/** Renderer configuration is descriptive; masked grants remain available by opaque list identity. */
export function publicWorkbenchFolders<T extends { config: WorkbenchConfig }>(
  value: T,
  scrub: (text: string) => string,
): T {
  return {
    ...value,
    config: {
      ...value.config,
      additional_folders: value.config.additional_folders.filter((path) => scrub(path) === path),
    },
  };
}
