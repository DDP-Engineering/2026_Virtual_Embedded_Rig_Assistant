import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestSha256 } from "../agent/approvals.js";
import { plugin } from "./program-fixtures.test-support.js";
import { findProgram, type ProgramRequestInput, prepareProgramRequest } from "./program-request.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function bench() {
  const root = await mkdtemp(join(tmpdir(), "vera-program-request-"));
  roots.push(root);
  await mkdir(join(root, "build"));
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, "build/app.bin"), "image");
  await writeFile(join(root, "key.bin"), "key");
  await writeFile(join(root, "secret.bin"), "secret");
  await writeFile(join(root, ".vera/.veraignore"), "secret.bin\n");
  return root;
}
const esptool = plugin(
  "esp32-esptool",
  ["esptool"],
  [{ match: "esptool * write-flash *", risk: "device-write", note: "Overwrites firmware." }],
);
const input = (
  workbench: string,
  args: string[],
  extra: Partial<ProgramRequestInput> = {},
): ProgramRequestInput => ({
  workbench,
  plugin: esptool,
  program: "esptool",
  executable: "C:/tools/esptool.exe",
  args,
  sessionId: "ses_1",
  turnId: "turn_1",
  callId: "call_1",
  ...extra,
});

describe("findProgram", () => {
  it("resolves the one enabled plugin that declares the program", () => {
    expect(findProgram([esptool, plugin("serial-monitor", ["monitor"])], "esptool")).toBe(esptool);
  });
  it("refuses a program no enabled plugin declares (REQ-SEC-59880d86)", () => {
    expect(() => findProgram([esptool], "espefuse")).toThrow(
      expect.objectContaining({ code: "DENIED", params: { reason: "undeclared" } }),
    );
    expect(() => findProgram([], "esptool")).toThrow(
      expect.objectContaining({ params: { reason: "undeclared" } }),
    );
  });
  it("refuses a program two enabled plugins declare (REQ-SEC-a4d1ac21)", () => {
    const other = plugin("esp-tools", ["esptool"]);
    expect(() => findProgram([esptool, other], "esptool")).toThrow(
      expect.objectContaining({ code: "DENIED", params: { reason: "ambiguous" } }),
    );
    expect(findProgram([other], "esptool")).toBe(other);
  });
});

describe("prepareProgramRequest", () => {
  it("binds the command line, plugin and named workbench files (REQ-DATA-b4e317de)", async () => {
    const root = await bench();
    const request = await prepareProgramRequest(
      input(root, ["--port", "COM3", "write_flash", "0x10000", "build/app.bin", "--key=key.bin", "build"]),
    );
    expect(request).toEqual({
      tool: "run_program",
      workbench: root,
      sessionId: "ses_1",
      turnId: "turn_1",
      callId: "call_1",
      pluginId: "esp32-esptool",
      pluginSha256: "c".repeat(64),
      trial: false,
      program: "esptool",
      executable: "C:/tools/esptool.exe",
      programVersion: "5.1.0",
      args: ["--port", "COM3", "write_flash", "0x10000", "build/app.bin", "--key=key.bin", "build"],
      cwd: ".",
      risk: "device-write",
      confirm: null,
      notes: ["Overwrites firmware."],
      files: [
        { arg: 4, path: "build/app.bin", sha256: sha("image") },
        { arg: 5, path: "key.bin", sha256: sha("key") },
      ],
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(requestSha256(await prepareProgramRequest(input(root, [...request.args])))).toBe(
      requestSha256(request),
    );
  });
  it("resolves files relative to cwd, accepts absolute workbench paths and skips everything else", async () => {
    const root = await bench();
    const outside = await mkdtemp(join(tmpdir(), "vera-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "other.bin"), "x");
    const request = await prepareProgramRequest(
      input(
        root,
        [
          "app.bin",
          join(root, "key.bin"),
          join(outside, "other.bin"),
          "../secret.bin",
          "missing.bin",
          "COM3:",
          "",
        ],
        { cwd: "build" },
      ),
    );
    expect(request.cwd).toBe("build");
    expect(request.files).toEqual([
      { arg: 0, path: "build/app.bin", sha256: sha("image") },
      { arg: 1, path: "key.bin", sha256: sha("key") },
    ]);
    expect(request.programVersion).toBe("5.1.0");
  });
  it.runIf(process.platform === "win32")("binds the file a Windows alias opens", async () => {
    const root = await bench();
    const request = await prepareProgramRequest(
      input(root, ["build\\app.bin.", "build/app.bin ", "build/app.bin::$DATA", "BUILD/APP.BIN"]),
    );
    expect(request.files).toEqual(
      [0, 1, 2, 3].map((arg) => ({ arg, path: "build/app.bin", sha256: sha("image") })),
    );
  });
  it("stops on abort", async () => {
    const root = await bench();
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareProgramRequest(input(root, ["build/app.bin"], { signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("marks trial plugins and carries the confirmation word of irreversible commands", async () => {
    const root = await bench();
    const efuse = plugin(
      "esp32-efuse",
      ["espefuse"],
      [{ match: "espefuse * burn-key *", risk: "irreversible" }],
      "trial",
    );
    const request = await prepareProgramRequest(
      input(root, ["burn_key", "BLOCK_KEY0", "key.bin"], { plugin: efuse, program: "espefuse" }),
    );
    expect(request).toMatchObject({
      trial: true,
      risk: "irreversible",
      confirm: "burn-key",
      programVersion: "5.1.0",
    });
  });
  it.each([
    ["an argument file", ["@args.txt"], { reason: "argument-file", index: 0 }],
    ["a line break", ["a\nb"], { reason: "control", index: 0 }],
    ["65 arguments", Array.from({ length: 65 }, () => "x"), { reason: "count" }],
    ["a 4097-character argument", ["x".repeat(4097)], { reason: "length", index: 0 }],
  ])("refuses %s before reading the workbench (REQ-SEC-28b53f44)", async (_label, args, params) => {
    await expect(
      prepareProgramRequest(input(join(tmpdir(), "vera-missing-bench"), args)),
    ).rejects.toMatchObject({
      code: "DENIED",
      params,
    });
  });
  it("refuses a program the plugin does not declare", async () => {
    const root = await bench();
    await expect(prepareProgramRequest(input(root, [], { program: "espefuse" }))).rejects.toMatchObject({
      code: "DENIED",
      params: { reason: "undeclared" },
    });
  });
});
