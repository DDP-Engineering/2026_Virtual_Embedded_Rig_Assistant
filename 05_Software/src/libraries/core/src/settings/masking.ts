import { type MaskingArea, maskingDefaults, type Settings, type WorkbenchConfig } from "@vera/shared";

/** Binds maskingFor to the host's live, validated settings without capturing stale app defaults. */
export function createMaskingResolver(getSettings: () => Pick<Settings, "privacy">) {
  return function maskingFor(workbench: Pick<WorkbenchConfig, "privacy">, area: MaskingArea): boolean {
    const choice = workbench.privacy?.mask?.[area];
    return choice === "on" || choice === "off"
      ? choice === "on"
      : (getSettings().privacy?.mask?.[area] ?? maskingDefaults[area]);
  };
}
