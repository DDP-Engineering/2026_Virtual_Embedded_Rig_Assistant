import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { flagDecision, promptApproval } from "./approval-prompt.js";
import { parseCommand } from "./args.js";

const request = {
  type: "approval.requested" as const,
  approvalId: "apv",
  callId: "call",
  requestSha256: "a".repeat(64),
  tool: "edit" as const,
  path: "file.txt",
  diff: "-old\n+new\u001b[2Jsecret",
  bytes: 4,
};
it.each([
  ["A\n", "approved"],
  ["D\n", "denied"],
] as const)("TTY prompt accepts %s and closes input listeners", async (answer, decision) => {
  const input = new PassThrough(),
    output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  const promise = promptApproval(request, new AbortController().signal, input, output, (s) =>
    s.replaceAll("secret", "[redacted]"),
  );
  input.write("invalid\n");
  input.write(answer);
  expect(await promise).toEqual({ decision });
  expect(text).toContain("-old\n+new");
  expect(text).toContain("Choose A");
  expect(text).not.toContain("secret");
  expect(text).not.toContain("\u001b");
  expect(input.listenerCount("data")).toBe(0);
});
it("prompt abort and EOF release waits safely", async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    signal = new AbortController();
  const wait = promptApproval(request, signal.signal, input, output);
  signal.abort();
  expect(await wait).toEqual({ decision: "aborted" });
  expect(input.listenerCount("data")).toBe(0);
  const ended = new PassThrough();
  const eof = promptApproval(request, new AbortController().signal, ended, output);
  ended.end();
  expect(await eof).toEqual({ decision: "denied" });
});
it("approval flags accept exactly all/none and reject duplicate or invalid choices", () => {
  const base = [
    "run",
    "--workbench",
    ".",
    "--prompt",
    "edit",
    "--provider",
    "replay",
    "--script",
    "script.jsonl",
  ];
  for (const choice of ["all", "none"])
    expect(parseCommand([...base, "--approve", choice])?.approve).toBe(choice);
  expect(() => parseCommand([...base, "--approve", "yes"])).toThrow("Invalid --approve");
  expect(() => parseCommand([...base, "--approve", "all", "--approve", "none"])).toThrow("Repeated option");
});

const burn = {
  type: "approval.requested" as const,
  approvalId: "apv",
  callId: "call",
  requestSha256: "a".repeat(64),
  tool: "run_program" as const,
  path: "espefuse",
  diff: "",
  bytes: 0,
  program: {
    pluginId: "esp32-efuse",
    trial: false,
    program: "espefuse",
    programVersion: "5.1.0",
    executable: "/opt/espefuse",
    args: ["--port", "COM3", "burn-key", "BLOCK_KEY0", "my key.bin"],
    cwd: ".",
    risk: "irreversible" as const,
    confirm: "burn-key",
    notes: ["Burns a key permanently."],
    files: [{ arg: 4, path: "my key.bin", sha256: "b".repeat(64) }],
  },
};
// REQ-FUNC-7cf311ae
it("asks for the typed word before approving an irreversible program command", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  const promise = promptApproval(burn, new AbortController().signal, input, output);
  input.write("a\n");
  input.write("burn\n");
  input.write("a\n");
  input.write("BURN_KEY\n");
  expect(await promise).toEqual({ decision: "approved", confirmation: "BURN_KEY" });
  expect(text).toContain("irreversible");
  expect(text).toContain('espefuse --port COM3 burn-key BLOCK_KEY0 "my key.bin"');
  expect(text).toContain("Burns a key permanently.");
  expect(text).toContain(`my key.bin ${"b".repeat(64)}`);
  expect(text).toContain("Type burn-key to confirm");
  expect(text).toContain("does not match");
});
it("denies a typed confirmation under approval flags or without a terminal, and lets other approvals through", () => {
  expect(flagDecision(burn, "all", true)).toBe("denied");
  expect(flagDecision(burn, "none", true)).toBe("denied");
  expect(flagDecision(burn, undefined, false)).toBe("denied");
  expect(flagDecision(burn, undefined, true)).toBeUndefined();
  expect(flagDecision(request, "all", false)).toBe("approved");
  expect(flagDecision(request, "none", true)).toBe("denied");
  expect(flagDecision(request, undefined, false)).toBe("denied");
  expect(flagDecision(request, undefined, true)).toBeUndefined();
  const flash = { ...burn, program: { ...burn.program, risk: "device-write" as const, confirm: null } };
  expect(flagDecision(flash, "all", false)).toBe("approved");
});
