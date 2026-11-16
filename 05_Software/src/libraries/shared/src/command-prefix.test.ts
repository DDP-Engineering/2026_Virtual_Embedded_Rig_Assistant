import { describe, expect, it } from "vitest";
import { commandPrefixes, commandPrefixMatches } from "./command-prefix.js";
import { channels } from "./ipc.js";
import { workbenchPatchSchema, workbenchSchema } from "./workbench.js";

describe("command prefix storage and user IPC", () => {
  it("defaults workbench format1 grants to empty and validates eligible grants", () => {
    const config = workbenchSchema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Bench" });
    expect(config.agent).toHaveProperty("allowed_commands", []);
    expect(workbenchPatchSchema.safeParse({ agent: { allowed_commands: ["npm test"] } }).success).toBe(true);
    for (const prefix of ["", "git push --force", "rm -rf .", "npm test; echo bad", "npm test\necho bad"])
      expect(workbenchPatchSchema.safeParse({ agent: { allowed_commands: [prefix] } }).success).toBe(false);
  });
  it("accepts an explicit user prefix only on an approved exact request", () => {
    const input = {
      sessionId: "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      approvalId: "apv_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      requestSha256: "a".repeat(64),
      decision: "approved",
      commandPrefix: "npm test",
    };
    const schema = channels["session.approval.decide"].request;
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, decision: "denied" }).success).toBe(false);
    expect(schema.safeParse({ ...input, commandPrefix: "git push --force" }).success).toBe(false);
  });
  it("validates workbench-bound opaque removal identities without accepting display labels", () => {
    const schema = channels["workbench.config.update"].request;
    const input = {
      workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      patch: {},
      removeCommandPrefixes: ["a".repeat(64)],
    };
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, workbenchId: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...input, removeCommandPrefixes: ["npm [REDACTED]"] }).success).toBe(false);
    expect(schema.safeParse({ ...input, patch: { agent: { allowed_commands: [] } } }).success).toBe(false);
    expect(
      channels["workbench.commandPrefixes.list"].request.safeParse({ workbenchId: input.workbenchId })
        .success,
    ).toBe(true);
  });
});

describe("conservative command prefix policy", () => {
  it("matches complete literal words and offers the chosen prefix", () => {
    expect(commandPrefixes("npm test")).toEqual(["npm", "npm test"]);
    expect(commandPrefixMatches("npm test -- --watch=false", "npm test")).toBe(true);
    expect(commandPrefixMatches("npm testing", "npm test")).toBe(false);
    expect(commandPrefixMatches("npm test", "np")).toBe(false);
    expect(commandPrefixMatches("NPM test", "npm test")).toBe(false);
  });
  it.each([
    "npm test; echo bad",
    "npm test|echo bad",
    "npm test && echo bad",
    "npm test || echo bad",
    "npm test\necho bad",
    "npm test\recho bad",
    "npm test\targ",
    "npm test $(echo bad)",
    "npm test `echo bad`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal hostile shell expansion.
    "npm test ${value}",
    "npm test > file",
    "npm test < file",
    "npm test & echo bad",
    "npm test # comment",
    "npm test 'x'",
    'npm test "x"',
    "npm test foo\\bar",
    "npm test *",
    "npm test %PATH%",
    "npm test @args",
    "npm test (echo bad)",
    "npm.cmd test",
    "npm.exe test",
    "./npm test",
    "/bin/npm test",
    "npm  test",
    "git push --force",
    "git push --force-with-lease",
    "git push -f",
    "git push -vf",
    "git push origin +main",
    "git push origin :main",
    "git push --mirror",
    "git push --delete main",
    "git reset --hard",
    "git clean victim",
    "git clean -dq",
    "git reset --ha",
    "git reset --har",
    "git push --mir",
    "git -ccore.sshCommand=bad push",
    "git -c alias.x=bad x",
    "rm -rf .",
    "rmdir /s /q .",
    "Remove-Item . -Recurse -Force",
    "format C:",
    "diskpart",
    "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sda",
    "Clear-Disk 0",
    "Remove-Volume 0",
    "fsutil volume dismount C:",
    "sudo rm -rf .",
    "bash -c reboot",
    "env sh -c reboot",
    "cmd /c del",
    "pwsh -Command reboot",
    "nice /bin/rm -rv ./victim",
    "time /bin/dd if=/dev/zero of=/dev/sda",
    "nohup /bin/dd if=/dev/zero of=/dev/sda",
    "timeout 1 /usr/bin/dd if=/dev/zero of=/dev/sda",
    "launcher C:/Windows/System32/format.com C:",
    "launcher C:/Windows/System32/format.com. C:",
    "launcher --program=dd if=/dev/zero of=/dev/sda",
  ])("requires exact approval for %s", (command) => {
    const prefix = command.startsWith("git") ? "git" : "npm test";
    expect(commandPrefixMatches(command, prefix)).toBe(false);
    expect(commandPrefixes(command)).toEqual([]);
    expect(commandPrefixMatches(command, command.split(" ")[0] ?? "")).toBe(false);
  });
});
