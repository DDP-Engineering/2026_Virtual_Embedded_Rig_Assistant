import type { StopReason } from "@vera/shared";
import { expect, it } from "vitest";
import { successfulOrdinaryTurn } from "./live-activity.js";

const ordinary = { kind: "ordinary", delegated: false, turnId: "turn" } as const;
const done = (stopReason: StopReason) => ({ type: "turn.done", turnId: "turn", stopReason }) as const;

it("recognizes only a matching live ordinary successful completion", () => {
  expect(successfulOrdinaryTurn(done("end"), ordinary)).toBe(true);
  for (const reason of ["aborted", "error", "limit"] as const)
    expect(successfulOrdinaryTurn(done(reason), ordinary)).toBe(false);
  expect(successfulOrdinaryTurn(done("end"), { ...ordinary, kind: "plan-review" })).toBe(false);
  expect(successfulOrdinaryTurn(done("end"), { ...ordinary, delegated: true })).toBe(false);
  expect(successfulOrdinaryTurn(done("end"), { ...ordinary, turnId: "elsewhere" })).toBe(false);
  expect(successfulOrdinaryTurn(done("end"), undefined)).toBe(false);
  expect(successfulOrdinaryTurn({ type: "turn.started", turnId: "turn" }, ordinary)).toBe(false);
});
