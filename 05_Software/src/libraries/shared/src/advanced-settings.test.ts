// REQ-FUNC-902313e0 REQ-DATA-33a90ef2 REQ-FUNC-2e124a88
import { describe, expect, it, vi } from "vitest";
import {
  advancedDraftValid,
  advancedEditPatch,
  advancedPatchSchema,
  advancedSettings,
  parseAdvancedFlag,
  resolveAdvanced,
} from "./advanced-settings.js";

describe("Advanced settings registry", () => {
  it("registers Tool calls per turn for every scope, 10 to 500, default 50, applied live", () => {
    expect(advancedSettings.toolCallsPerTurn).toMatchObject({
      kind: "int",
      min: 10,
      max: 500,
      default: 50,
      scopes: ["app", "workbench", "session"],
      applies: "live",
    });
  });

  it("resolves session over workbench over app over the default, raising or lowering freely", () => {
    const key = "toolCallsPerTurn" as const;
    expect(resolveAdvanced(key, {})).toEqual({ value: 50, source: "default" });
    expect(resolveAdvanced(key, { app: { toolCallsPerTurn: 100 } })).toEqual({ value: 100, source: "app" });
    expect(
      resolveAdvanced(key, { app: { toolCallsPerTurn: 100 }, workbench: { toolCallsPerTurn: 200 } }),
    ).toEqual({ value: 200, source: "workbench" });
    expect(
      resolveAdvanced(key, {
        app: { toolCallsPerTurn: 100 },
        workbench: { toolCallsPerTurn: 200 },
        session: { toolCallsPerTurn: 12 },
      }),
    ).toEqual({ value: 12, source: "session" });
    expect(resolveAdvanced(key, { session: { toolCallsPerTurn: 300 } })).toEqual({
      value: 300,
      source: "session",
    });
  });

  it("ignores unknown or out-of-range stored values and names them without their value", () => {
    const ignored = vi.fn();
    expect(
      resolveAdvanced(
        "toolCallsPerTurn",
        {
          app: { toolCallsPerTurn: 100, mystery: 1 },
          workbench: { toolCallsPerTurn: 9 },
          session: { toolCallsPerTurn: "300" },
        },
        ignored,
      ),
    ).toEqual({ value: 100, source: "app" });
    expect(ignored.mock.calls).toEqual([
      ["app", "mystery"],
      ["session", "toolCallsPerTurn"],
      ["workbench", "toolCallsPerTurn"],
    ]);
  });

  it("accepts in-range values, null to clear, and refuses everything else when saving", () => {
    const app = advancedPatchSchema("app");
    expect(app.parse({ toolCallsPerTurn: 10 })).toEqual({ toolCallsPerTurn: 10 });
    expect(app.parse({ toolCallsPerTurn: null })).toEqual({ toolCallsPerTurn: null });
    for (const bad of [
      { toolCallsPerTurn: 9 },
      { toolCallsPerTurn: 501 },
      { toolCallsPerTurn: 1.5 },
      { other: 1 },
    ])
      expect(app.safeParse(bad).success).toBe(false);
  });

  it("parses CLI flags against the registry", () => {
    expect(parseAdvancedFlag("toolCallsPerTurn=20")).toEqual({ key: "toolCallsPerTurn", value: 20 });
    for (const bad of ["toolCallsPerTurn=0", "toolCallsPerTurn=abc", "unknown=1", "toolCallsPerTurn", "=5"])
      expect(parseAdvancedFlag(bad)).toBeUndefined();
  });
});

// REQ-DATA-96ef3dd6 REQ-DATA-33a90ef2 REQ-DATA-4a030001
describe("Advanced values in the stores", () => {
  const installation = "00000000-0000-4000-8000-000000000000";
  it("keeps app values in settings.json, removes a cleared one and refuses invalid saves", async () => {
    const { defaultSettings, mergeSettings, settingsPatchSchema, settingsSchema } = await import(
      "./settings.js"
    );
    const base = defaultSettings(installation);
    expect(base).not.toHaveProperty("limits");
    expect(base).not.toHaveProperty("advanced");
    const set = mergeSettings(base, { advanced: { toolCallsPerTurn: 120 }, showAdvanced: true });
    expect(set.advanced).toEqual({ toolCallsPerTurn: 120 });
    expect(set.showAdvanced).toBe(true);
    expect(mergeSettings(set, { advanced: { toolCallsPerTurn: null } }).advanced).toEqual({});
    expect(settingsPatchSchema.safeParse({ advanced: { toolCallsPerTurn: 600 } }).success).toBe(false);
    // A hand-edited file with a bad or unknown value still loads.
    expect(
      settingsSchema.safeParse({ ...base, advanced: { toolCallsPerTurn: 0, mystery: true } }).success,
    ).toBe(true);
  });
  it("keeps workbench values in workbench.yaml and loads files with invalid values", async () => {
    const { mergeWorkbench, workbenchPatchSchema, workbenchSchema } = await import("./workbench.js");
    const config = workbenchSchema.parse({ format: 1, id: "wb_00000000000000000000000000", name: "Board" });
    const set = mergeWorkbench(config, { advanced: { toolCallsPerTurn: 200 } });
    expect(set.advanced).toEqual({ toolCallsPerTurn: 200 });
    expect(mergeWorkbench(set, { advanced: { toolCallsPerTurn: null } }).advanced).toEqual({});
    expect(workbenchPatchSchema.safeParse({ advanced: { toolCallsPerTurn: 5 } }).success).toBe(false);
    expect(
      workbenchSchema.safeParse({
        format: 1,
        id: "wb_00000000000000000000000000",
        name: "B",
        advanced: { x: "y" },
      }).success,
    ).toBe(true);
  });
  it("folds session values from session.updated and clears them with null", async () => {
    const { applySessionEvent, emptySessionState } = await import("./session-state.js");
    let state = applySessionEvent(emptySessionState(), {
      type: "session.updated",
      advanced: { toolCallsPerTurn: 300 },
    });
    expect(state.advanced).toEqual({ toolCallsPerTurn: 300 });
    state = applySessionEvent(state, { type: "session.updated", title: "Renamed" });
    expect(state.advanced).toEqual({ toolCallsPerTurn: 300 });
    state = applySessionEvent(state, { type: "session.updated", advanced: { toolCallsPerTurn: null } });
    expect(state.advanced).toEqual({});
  });
});

describe("Advanced draft edits", () => {
  it("diffs a draft into a patch and treats a cleared value as valid", () => {
    expect(advancedEditPatch({ toolCallsPerTurn: 200 }, {}, "workbench")).toEqual({ toolCallsPerTurn: null });
    expect(advancedEditPatch({}, { toolCallsPerTurn: 30 }, "workbench")).toEqual({ toolCallsPerTurn: 30 });
    expect(advancedEditPatch({ toolCallsPerTurn: 30 }, { toolCallsPerTurn: 30 }, "workbench")).toEqual({});
    expect(advancedDraftValid({ toolCallsPerTurn: null })).toBe(true);
    expect(advancedDraftValid({ toolCallsPerTurn: 9 })).toBe(false);
    expect(advancedDraftValid({ toolCallsPerTurn: Number.NaN })).toBe(false);
  });
});

// REQ-FUNC-f6f79cd2 REQ-FUNC-150dcb0b REQ-FUNC-f041ba07 REQ-FUNC-0df8e905 REQ-FUNC-820e2701 REQ-FUNC-da830c44
// REQ-FUNC-5eacaf9f REQ-FUNC-b1a2db33 REQ-FUNC-9455436f REQ-FUNC-5e129df5 REQ-FUNC-8a1eea8b REQ-FUNC-dfe84577
// REQ-FUNC-dd50ebed REQ-FUNC-ddcd96b8 REQ-FUNC-1e7d6449 REQ-FUNC-e1d2f670 REQ-FUNC-ae2806b9
describe("Tool, program and web settings", () => {
  it("registers the plan's ranges, defaults, scopes and timing", () => {
    const rows = {
      toolResultChars: [8000, 128000, 32000, ["app"], "live"],
      readLines: [500, 10000, 2000, ["app"], "live"],
      readChars: [10000, 120000, 30000, ["app"], "live"],
      grepResults: [50, 2000, 500, ["app"], "live"],
      grepFileMB: [1, 50, 5, ["app"], "live"],
      globResults: [100, 5000, 500, ["app"], "live"],
      workerDeadline: [5, 120, 10, ["app"], "new"],
      webSearchResults: [1, 8, 5, ["app"], "live"],
      webReadChars: [1000, 16000, 12000, ["app"], "live"],
      webTimeout: [5, 120, 30, ["app"], "live"],
      downloadMB: [10, 1000, 100, ["app"], "live"],
      downloadTimeout: [30, 1800, 120, ["app"], "live"],
      backgroundPrograms: [1, 16, 4, ["app"], "new"],
      runLogsKept: [20, 2000, 200, ["app"], "live"],
      runLogMB: [8, 1024, 64, ["app"], "live"],
      programTimeout: [60, 3600, 600, ["app", "workbench"], "live"],
      commandTimeout: [60, 3600, 600, ["app", "workbench"], "live"],
    } as const;
    for (const [key, [min, max, value, scopes, applies]] of Object.entries(rows))
      expect(advancedSettings[key as keyof typeof rows], key).toMatchObject({
        kind: "int",
        min,
        max,
        default: value,
        scopes,
        applies,
      });
    expect(advancedPatchSchema("workbench").safeParse({ downloadMB: 200 }).success).toBe(false);
    expect(advancedPatchSchema("workbench").safeParse({ programTimeout: 1800 }).success).toBe(true);
    expect(advancedPatchSchema("session").safeParse({ commandTimeout: 1800 }).success).toBe(false);
  });
});

// REQ-FUNC-133f57ee REQ-UX-d64e808a REQ-FUNC-4b36dede REQ-FUNC-aa35b135 REQ-FUNC-2fba7b9c REQ-FUNC-bfbd70b6
describe("Document settings", () => {
  it("registers the plan's ranges, defaults, scopes and timing", () => {
    const rows = {
      textFileMB: [1, 64, 20, ["workbench"], "reindex"],
      docVolumeFiles: [500, 100000, 2000, ["app", "workbench"], "live"],
      docVolumeMB: [512, 51200, 2048, ["app", "workbench"], "live"],
      docsResults: [10, 100, 20, ["app", "workbench"], "live"],
      extractionTimeout: [30, 1800, 120, ["app"], "new"],
      indexingPause: [250, 10000, 1000, ["app"], "live"],
      embeddingIdle: [10, 600, 60, ["app"], "new"],
    } as const;
    for (const [key, [min, max, value, scopes, applies]] of Object.entries(rows))
      expect(advancedSettings[key as keyof typeof rows], key).toMatchObject({
        kind: "int",
        min,
        max,
        default: value,
        scopes,
        applies,
      });
  });
});

// REQ-FUNC-7509bd1e REQ-FUNC-240f4e02 REQ-UX-996ae06e REQ-FUNC-ef931b1f REQ-FUNC-a16121c6 REQ-FUNC-ce542246
// REQ-FUNC-4a030008 REQ-UX-a4cf0527 REQ-UX-441b5a9d REQ-UX-6a8a987d REQ-DATA-96ef3dd6
describe("Desktop settings", () => {
  it("registers the desktop ranges, defaults, scopes and timing", () => {
    const rows = {
      terminals: [1, 16, 8, ["app"], "new"],
      terminalBufferK: [64, 1024, 256, ["app"], "new"],
      terminalScrollback: [1000, 50000, 3000, ["app"], "new"],
      terminalAgentChars: [2000, 64000, 12000, ["app"], "live"],
      updateInterval: [1, 168, 6, ["app"], "live"],
      catalogInterval: [1, 168, 24, ["app"], "live"],
      logDays: [1, 90, 7, ["app"], "live"],
      transcriptRows: [20, 200, 40, ["app"], "new"],
      transcriptChunkRows: [50, 500, 100, ["app"], "new"],
    } as const;
    for (const [key, [min, max, value, scopes, applies]] of Object.entries(rows))
      expect(advancedSettings[key as keyof typeof rows], key).toMatchObject({
        kind: "int",
        min,
        max,
        default: value,
        scopes,
        applies,
      });
  });
  it("offers Rows per page as a choice of 10, 20 or 50 and refuses any other value", () => {
    expect(advancedSettings.pageSize).toMatchObject({
      kind: "choice",
      options: [10, 20, 50],
      default: 10,
      scopes: ["app"],
      applies: "live",
    });
    const patch = advancedPatchSchema("app");
    expect(patch.safeParse({ pageSize: 20 }).success).toBe(true);
    expect(patch.safeParse({ pageSize: 15 }).success).toBe(false);
    expect(patch.safeParse({ pageSize: null }).success).toBe(true);
    const ignored = vi.fn();
    expect(resolveAdvanced("pageSize", { app: { pageSize: 15 } }, ignored)).toEqual({
      value: 10,
      source: "default",
    });
    expect(ignored).toHaveBeenCalledWith("app", "pageSize");
    expect(resolveAdvanced("pageSize", { app: { pageSize: 50 } }).value).toBe(50);
    expect(advancedDraftValid({ pageSize: 15 })).toBe(false);
    expect(advancedDraftValid({ pageSize: 20 })).toBe(true);
  });
});

// REQ-FUNC-1cec8616 REQ-FUNC-8ac5ec27 REQ-FUNC-4e63e8d4 REQ-FUNC-28f652c7 REQ-FUNC-e816fc22 REQ-FUNC-a786b11d
// REQ-FUNC-cae0533c REQ-FUNC-5983a9e0 REQ-FUNC-261cdc27 REQ-FUNC-3e78ae47 REQ-FUNC-73ca575e REQ-UX-91d7a481
describe("Agent and context settings", () => {
  it("registers the plan's ranges, defaults and scopes", () => {
    const rows = {
      noOutputTimeout: [30, 3600, 300, ["app", "session"]],
      headerWait: [10, 300, 30, ["app"]],
      summaryToolResultChars: [500, 8000, 2000, ["app"]],
      summaryPasses: [1, 10, 5, ["app"]],
      calibrationMargin: [100, 150, 110, ["app"]],
      delegations: [1, 8, 3, ["app"]],
      compactionTrigger: [50, 95, 80, ["app", "workbench"]],
      recentTailTokens: [0, 100000, 20000, ["app", "workbench"]],
    } as const;
    for (const [key, [min, max, value, scopes]] of Object.entries(rows))
      expect(advancedSettings[key as keyof typeof rows]).toMatchObject({
        kind: "int",
        min,
        max,
        default: value,
        scopes,
        applies: "live",
      });
    expect(advancedSettings.backgroundCompaction).toMatchObject({
      kind: "switch",
      default: true,
      scopes: ["app", "workbench"],
    });
    expect(advancedSettings.providerTokenCounts).toMatchObject({
      kind: "switch",
      default: true,
      scopes: ["app"],
    });
    expect(advancedSettings.autoCompaction).toMatchObject({
      kind: "switch",
      default: true,
      scopes: ["session"],
    });
  });

  it("stores, resolves and parses switches as booleans, inheriting when absent", () => {
    expect(resolveAdvanced("backgroundCompaction", {})).toEqual({ value: true, source: "default" });
    expect(
      resolveAdvanced("backgroundCompaction", {
        app: { backgroundCompaction: false },
        workbench: { backgroundCompaction: true },
      }),
    ).toEqual({ value: true, source: "workbench" });
    const ignored = vi.fn();
    expect(resolveAdvanced("backgroundCompaction", { app: { backgroundCompaction: 1 } }, ignored)).toEqual({
      value: true,
      source: "default",
    });
    expect(ignored).toHaveBeenCalledWith("app", "backgroundCompaction");
    const workbench = advancedPatchSchema("workbench");
    expect(workbench.parse({ backgroundCompaction: false })).toEqual({ backgroundCompaction: false });
    expect(workbench.parse({ backgroundCompaction: null })).toEqual({ backgroundCompaction: null });
    expect(workbench.safeParse({ backgroundCompaction: 0 }).success).toBe(false);
    expect(workbench.safeParse({ summaryPasses: 3 }).success).toBe(false);
    expect(advancedPatchSchema("session").safeParse({ compactionTrigger: 60 }).success).toBe(false);
    expect(advancedEditPatch({ autoCompaction: false }, {}, "session")).toEqual({ autoCompaction: null });
    expect(advancedEditPatch({}, { autoCompaction: false }, "session")).toEqual({ autoCompaction: false });
    expect(advancedDraftValid({ autoCompaction: true, noOutputTimeout: 29 })).toBe(false);
    expect(parseAdvancedFlag("autoCompaction=off")).toEqual({ key: "autoCompaction", value: false });
    expect(parseAdvancedFlag("autoCompaction=true")).toEqual({ key: "autoCompaction", value: true });
    expect(parseAdvancedFlag("noOutputTimeout=60")).toEqual({ key: "noOutputTimeout", value: 60 });
    for (const bad of ["autoCompaction=2", "noOutputTimeout=on", "headerWait=20"])
      expect(parseAdvancedFlag(bad)).toBeUndefined();
  });

  // REQ-DATA-33a90ef2
  it("ignores a stored value at a scope the setting does not list, and names it", () => {
    const ignored = vi.fn();
    // A hand-edited workbench.yaml cannot raise an application-only limit.
    expect(
      resolveAdvanced("delegations", { workbench: { delegations: 8 }, app: { delegations: 2 } }, ignored),
    ).toEqual({ value: 2, source: "app" });
    expect(ignored).toHaveBeenCalledWith("workbench", "delegations");
    expect(resolveAdvanced("noOutputTimeout", { workbench: { noOutputTimeout: 3600 } })).toEqual({
      value: 300,
      source: "default",
    });
    // A session event holding a workbench key is skipped too.
    expect(resolveAdvanced("compactionTrigger", { session: { compactionTrigger: 60 } })).toEqual({
      value: 80,
      source: "default",
    });
  });
});
