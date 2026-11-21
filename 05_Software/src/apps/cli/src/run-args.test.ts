// REQ-FUNC-181db660
import { expect, it } from "vitest";
import { parseCommand, type RunOptions, UsageError } from "./args.js";

const base = ["run", "--workbench", "wb", "--prompt", "Go", "--provider", "replay", "--script", "s.jsonl"];

it("accepts repeated --advanced key=value flags; the last value for a key wins", () => {
  const options = parseCommand([
    ...base,
    "--advanced",
    "toolCallsPerTurn=20",
    "--advanced",
    "toolCallsPerTurn=30",
  ]) as RunOptions;
  expect(options.advanced).toEqual({ toolCallsPerTurn: 30 });
  expect((parseCommand(base) as RunOptions).advanced).toBeUndefined();
});

// REQ-FUNC-181db660 REQ-FUNC-5983a9e0 REQ-FUNC-3e78ae47
it("accepts the session switch and timeout keys, a switch as on or off", () => {
  const options = parseCommand([
    ...base,
    "--advanced",
    "autoCompaction=off",
    "--advanced",
    "noOutputTimeout=600",
  ]) as RunOptions;
  expect(options.advanced).toEqual({ autoCompaction: false, noOutputTimeout: 600 });
  // A workbench-only key and a word that is not a switch value are refused.
  for (const flag of ["compactionTrigger=60", "autoCompaction=maybe", "autoCompaction=1"])
    expect(() => parseCommand([...base, "--advanced", flag])).toThrow(UsageError);
});

it("refuses an unknown key or an out-of-range value as a usage error", () => {
  for (const flag of ["toolCallsPerTurn=0", "toolCallsPerTurn=501", "unknown=1", "toolCallsPerTurn"])
    expect(() => parseCommand([...base, "--advanced", flag])).toThrow(UsageError);
});
