import { expect, it } from "vitest";
import { channels } from "./ipc.js";

it("validates exact approval identity and disallows invalid decision/switch combinations", () => {
  const contract = (
    channels as unknown as Record<string, { request: { safeParse(value: unknown): { success: boolean } } }>
  )["session.approval.decide"];
  expect(contract).toBeDefined();
  if (!contract) throw Error("Approval contract is missing.");
  const input = {
    sessionId: `ses_${"0".repeat(26)}`,
    approvalId: `apv_${"0".repeat(26)}`,
    requestSha256: "a".repeat(64),
    decision: "approved",
  };
  expect(contract.request.safeParse(input).success).toBe(true);
  expect(contract.request.safeParse({ ...input, switchToAutoEdit: true }).success).toBe(true);
  for (const bad of [
    { requestSha256: "wrong" },
    { decision: "aborted" },
    { approvalId: "other" },
    { decision: "denied", switchToAutoEdit: true },
    { extra: true },
  ])
    expect(contract.request.safeParse({ ...input, ...bad }).success).toBe(false);
});
