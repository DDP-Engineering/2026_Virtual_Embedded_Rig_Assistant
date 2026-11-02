import { expect, it } from "vitest";
import * as shared from "./index.js";

const program = {
  pluginId: "esp32-efuse",
  trial: false,
  program: "espefuse",
  programVersion: "5.1.0",
  executable: "C:/tools/espefuse.exe",
  args: ["--port", "COM3", "burn-key", "BLOCK_KEY0", "key.bin"],
  cwd: ".",
  risk: "irreversible",
  confirm: "burn-key",
  notes: ["Burns a key permanently."],
  files: [{ arg: 4, path: "key.bin", sha256: "b".repeat(64) }],
} as const;
const requested = {
  type: "approval.requested",
  approvalId: "a",
  callId: "c",
  requestSha256: "a".repeat(64),
  tool: "run_program",
  path: "espefuse",
  diff: "",
  bytes: 0,
  program,
} as const;

it("carries run_program approvals with their program payload into session state (REQ-DATA-b4e317de)", () => {
  expect(shared.sessionEventSchema.parse(requested)).toEqual(requested);
  const state = shared.applySessionEvent(
    shared.emptySessionState(),
    shared.sessionEventSchema.parse(requested),
  );
  expect(state.approvals[0]).toMatchObject({ tool: "run_program", program, decision: null });
  expect(shared.sessionStateSchema.parse(state)).toEqual(state);
  for (const bad of [
    { program: undefined },
    { bytes: 1 },
    { diff: "+x" },
    { program: { ...program, risk: "unknown" } },
    { program: { ...program, files: [{ arg: -1, path: "k", sha256: "b".repeat(64) }] } },
    { program: { ...program, extra: true } },
  ])
    expect(shared.sessionEventSchema.safeParse({ ...requested, ...bad }).success).toBe(false);
  expect(
    shared.sessionEventSchema.safeParse({ ...requested, tool: "edit", path: "a.txt", diff: "+x", bytes: 1 })
      .success,
  ).toBe(false);
});

it("accepts the typed confirmation text on approval decisions (REQ-SEC-e8695b28)", () => {
  const contract = shared.channels["session.approval.decide"].request;
  const input = {
    sessionId: `ses_${"0".repeat(26)}`,
    approvalId: `apv_${"0".repeat(26)}`,
    requestSha256: "a".repeat(64),
    decision: "approved",
  };
  expect(contract.safeParse({ ...input, confirmation: "burn-key" }).success).toBe(true);
  expect(contract.safeParse({ ...input, confirmation: "x".repeat(4097) }).success).toBe(false);
});

it("lists irreversible rules in plugin summaries (REQ-DATA-3f62c8c1)", () => {
  const summary = {
    id: "esp32-efuse",
    issues: [],
    enabled: true,
    irreversible: [
      { match: "espefuse * burn-key *", note: "Permanent." },
      { match: "espefuse * burn-efuse *" },
    ],
  };
  expect(shared.pluginSummarySchema.parse(summary)).toEqual(summary);
  expect(shared.pluginSummarySchema.safeParse({ ...summary, irreversible: [{ match: "" }] }).success).toBe(
    false,
  );
});
