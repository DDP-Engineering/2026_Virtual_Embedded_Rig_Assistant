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
  const sha256 = "a".repeat(64);
  for (const path of ["C:\\plugins\\esp32-esptool", "C:/p/x.zip", "/home/u/p", "\\\\server\\share\\p"]) {
    expect(channels["plugins.install"].request.parse({ path, sha256 })).toEqual({ path, sha256 });
    expect(channels["plugins.review"].request.parse({ path })).toEqual({ path });
  }
  for (const request of [
    { path: "relative/folder", sha256 },
    { path: "", sha256 },
    { path: "/x", sha256, extra: 1 },
    // REQ-SEC-8e281f52: an install names the hash the user reviewed.
    { path: "/x" },
    { path: "/x", sha256: "A".repeat(64) },
  ])
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

// REQ-FUNC-a5be5e53, REQ-FUNC-6c76f25a
it("validates the plugin picker and review", () => {
  for (const kind of ["folder", "zip"])
    expect(channels["plugins.choose"].request.parse({ kind })).toEqual({ kind });
  expect(channels["plugins.choose"].request.safeParse({ kind: "file" }).success).toBe(false);
  expect(channels["plugins.choose"].response.parse({ path: null })).toEqual({ path: null });
  expect(channels["plugins.choose"].response.parse({ path: "C:/p/x.zip" })).toEqual({ path: "C:/p/x.zip" });
  const review = {
    path: "C:/plugins/echo-tools",
    kind: "folder",
    sha256: "b".repeat(64),
    issues: [],
    manifest: {
      format: 1,
      id: "echo-tools",
      version: "1.0.0",
      name: "Echo tools",
      description: "Echo arguments.",
      ecosystem: "general",
      platforms: ["windows-x64"],
      programs: {
        echo: { install: { find: { windows: ["%PATH%"] } }, version: { args: [], match: "v(\\d+)" } },
      },
      rules: [{ match: "echo burn *", risk: "irreversible", note: "Burns a fuse." }],
    },
    installed: { version: "0.9.0" },
  };
  expect(channels["plugins.review"].response.parse(review).manifest?.requires).toEqual([]);
  expect(
    channels["plugins.review"].response.parse({
      path: "/p/broken",
      kind: "zip",
      sha256: "c".repeat(64),
      issues: [{ code: "field", path: "rules.0.risk", issue: "invalid_value" }],
    }).manifest,
  ).toBeUndefined();
  expect(channels["plugins.review"].response.safeParse({ ...review, sha256: "x" }).success).toBe(false);
});

// REQ-FUNC-39617f81, REQ-FUNC-f024d73c, REQ-FUNC-8c38d223
it("validates the runs list, log and stop channels", () => {
  const id = "01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  expect(channels["runs.list"].request.parse({ workbenchId })).toEqual({ workbenchId });
  expect(channels["runs.list"].request.safeParse({}).success).toBe(false);
  const run = {
    id,
    sessionId: "s1",
    plugin: "echo-tools",
    program: "echo",
    args: ["serve"],
    background: true,
    startedAt: "2026-11-03T10:00:00.000Z",
    state: "running",
    log: `.vera/runs/${id}.log`,
  };
  expect(channels["runs.list"].response.parse({ runs: [run] }).runs).toHaveLength(1);
  expect(
    channels["runs.list"].response.parse({
      runs: [{ ...run, state: "exited", end: "exited", exitCode: 0, durationMs: 12 }],
    }).runs[0]?.exitCode,
  ).toBe(0);
  expect(channels["runs.list"].response.safeParse({ runs: [{ ...run, state: "paused" }] }).success).toBe(
    false,
  );
  for (const name of ["runs.log", "runs.stop"] as const) {
    expect(channels[name].request.parse({ workbenchId, id })).toEqual({ workbenchId, id });
    for (const bad of ["../x", "01jb8z6q4m7n2k5r9t3v8x1y0c", ""])
      expect(channels[name].request.safeParse({ workbenchId, id: bad }).success).toBe(false);
  }
  expect(
    channels["runs.log"].response.parse({ id, text: "boot\n", truncated: false, running: true }),
  ).toBeTruthy();
  expect(channels["runs.stop"].response.parse({})).toEqual({});
});

// REQ-FUNC-f244f8f6, REQ-FUNC-98ded47a
it("validates the catalog view, review and install channels and the catalog app event", async () => {
  const { appEventSchema } = await import("./events.js");
  const sha256 = "c".repeat(64);
  expect(channels["plugins.catalog"].request.parse({ refresh: true })).toEqual({ refresh: true });
  expect(channels["plugins.catalog"].request.safeParse({}).success).toBe(false);
  const view = {
    source: "remote",
    url: "https://catalog.test/vera/",
    checkedAt: "2026-11-03T12:00:00.000Z",
    plugins: [
      {
        id: "serial-monitor",
        version: "1.0.1",
        tier: "official",
        ecosystem: "general",
        platforms: ["windows-x64", "linux-x64"],
        name: "Serial monitor",
        description: "Lists ports.",
        requires: [],
        url: "serial-monitor-1.0.1.zip",
        sha256,
        bytes: 900,
        installed: { version: "1.0.0", tier: "official" },
        update: true,
      },
    ],
    packs: [
      { id: "esp32", name: "ESP32", groups: [{ name: "Core", plugins: ["serial-monitor"], default: true }] },
    ],
  };
  expect(channels["plugins.catalog"].response.parse(view)).toEqual(view);
  expect(channels["plugins.catalog"].response.safeParse({ ...view, source: "mirror" }).success).toBe(false);
  expect(channels["plugins.catalog"].response.parse({ source: "none", plugins: [], packs: [] }).source).toBe(
    "none",
  );
  expect(channels["plugins.catalogReview"].request.parse({ id: "serial-monitor" })).toEqual({
    id: "serial-monitor",
  });
  expect(channels["plugins.catalogReview"].request.safeParse({ id: "../x" }).success).toBe(false);
  const review = {
    review: { path: "C:/data/plugins/catalog/x.zip", kind: "zip", sha256, issues: [] },
    id: "serial-monitor",
    version: "1.0.1",
    tier: "official",
    required: false,
  };
  expect(channels["plugins.catalogReview"].response.parse(review)).toEqual(review);
  expect(channels["plugins.catalogInstall"].request.parse({ id: "serial-monitor", sha256 })).toEqual({
    id: "serial-monitor",
    sha256,
  });
  expect(channels["plugins.catalogInstall"].request.safeParse({ id: "serial-monitor" }).success).toBe(false);
  expect(
    channels["plugins.catalogInstall"].response.parse({
      id: "serial-monitor",
      issues: [],
      tier: "official",
      source: "catalog",
    }).source,
  ).toBe("catalog");
  expect(appEventSchema.parse({ type: "plugins.catalog" })).toEqual({ type: "plugins.catalog" });
});

// REQ-UX-13ab0006
it("binds scoped review and trust to a workbench id and exact hash", () => {
  const review = channels["plugins.scopedReview"];
  const trust = channels["plugins.scopedTrust"];
  expect(review.request.parse({ workbenchId, id: "echo-tools" })).toEqual({ workbenchId, id: "echo-tools" });
  expect(trust.request.safeParse({ workbenchId, id: "echo-tools" }).success).toBe(false);
  expect(trust.request.parse({ workbenchId, id: "echo-tools", sha256: "a".repeat(64) })).toBeTruthy();
  expect(trust.request.safeParse({ workbenchId, id: "../escape", sha256: "a".repeat(64) }).success).toBe(
    false,
  );
});
