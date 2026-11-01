import { expect, it } from "vitest";
import { channels } from "./ipc.js";

const workbenchId = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
// REQ-FUNC-9dd7413b
it("validates strict plugin list, install, uninstall and toggle requests and responses", () => {
  expect(channels["plugins.list"].request.parse({})).toEqual({});
  expect(channels["plugins.list"].request.parse({ workbenchId })).toEqual({ workbenchId });
  expect(channels["plugins.list"].request.safeParse({ workbenchId: "wb_bad" }).success).toBe(false);
  expect(
    channels["plugins.list"].response.parse([
      {
        id: "esp32-esptool",
        enabled: true,
        issues: [],
        version: "1.2.0",
        name: "ESP32 esptool",
        description: "Flash ESP32 chips.",
        ecosystem: "esp32",
        platforms: ["windows-x64", "linux-x64"],
        tier: "local",
        source: "zip",
        sha256: "a".repeat(64),
        installedAt: "2026-11-01T10:00:00.000Z",
      },
      {
        id: "broken",
        enabled: false,
        issues: [{ code: "field", path: "programs.x.timeout", issue: "too_big" }],
      },
    ]),
  ).toHaveLength(2);
  for (const path of ["C:\\plugins\\esp32-esptool", "C:/p/x.zip", "/home/u/p", "\\\\server\\share\\p"])
    expect(channels["plugins.install"].request.parse({ path })).toEqual({ path });
  for (const request of [{ path: "relative/folder" }, { path: "" }, { path: "/x", extra: 1 }])
    expect(channels["plugins.install"].request.safeParse(request).success).toBe(false);
  expect(channels["plugins.uninstall"].request.parse({ id: "esp32-esptool" })).toBeTruthy();
  expect(channels["plugins.uninstall"].request.safeParse({ id: "../x" }).success).toBe(false);
  expect(
    channels["plugins.toggle"].request.parse({ workbenchId, id: "esp32-esptool", enabled: true }),
  ).toBeTruthy();
  for (const request of [
    { workbenchId, id: "Bad", enabled: true },
    { id: "esp32-esptool", enabled: true },
    { workbenchId, id: "esp32-esptool", enabled: true, extra: 1 },
  ])
    expect(channels["plugins.toggle"].request.safeParse(request).success).toBe(false);
});
