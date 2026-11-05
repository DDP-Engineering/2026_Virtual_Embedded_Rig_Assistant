import type { PluginProgramStatus } from "@vera/shared";

/** Redaction can expand short credentials; cap again before crossing the IPC schema. */
export function scrubProgramStatuses(
  statuses: PluginProgramStatus[],
  scrub: (value: string) => string,
): PluginProgramStatus[] {
  return statuses.map((status) => {
    const result = { ...status };
    if (status.detail !== undefined) result.detail = scrub(status.detail).slice(-2000);
    for (const key of ["hint", "link"] as const) {
      if (status[key] === undefined) continue;
      const value = scrub(status[key]).slice(0, 1024);
      if (value) result[key] = value;
      else delete result[key];
    }
    return result;
  });
}
