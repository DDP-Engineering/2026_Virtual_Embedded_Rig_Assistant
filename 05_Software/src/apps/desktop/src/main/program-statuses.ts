import type { PluginProgramStatus } from "@vera/shared";

/** Redaction can expand short credentials; cap again before crossing the IPC schema. */
export function scrubProgramStatuses(
  statuses: PluginProgramStatus[],
  scrub: (value: string) => string,
): PluginProgramStatus[] {
  return statuses.map((status) => {
    const result = { ...status };
    if (status.detail !== undefined) result.detail = scrub(status.detail).slice(-2000);
    for (const [key, limit] of [
      ["hint", 1024],
      ["link", 1024],
      ["version", 128],
      ["range", 128],
      ["path", 4096],
    ] as const) {
      if (status[key] === undefined) continue;
      const value = scrub(status[key]).slice(0, limit);
      if (value) result[key] = value;
      else delete result[key];
    }
    return result;
  });
}
