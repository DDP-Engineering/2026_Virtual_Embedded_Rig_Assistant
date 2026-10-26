import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { promptApproval } from "./approval-prompt.js";
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
  expect(await promise).toBe(decision);
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
  expect(await wait).toBe("aborted");
  expect(input.listenerCount("data")).toBe(0);
  const ended = new PassThrough();
  const eof = promptApproval(request, new AbortController().signal, ended, output);
  ended.end();
  expect(await eof).toBe("denied");
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
