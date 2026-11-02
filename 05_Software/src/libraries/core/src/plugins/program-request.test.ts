import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestSha256 } from "../agent/approvals.js";
import { plugin } from "./program-fixtures.test-support.js";
import {
  findProgram,
  type ProgramRequestInput,
  prepareProgramRequest,
  verifyProgramFiles,
} from "./program-request.js";

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
      executableArgs: [],
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

const windows = it.runIf(process.platform === "win32");
describe("Windows spellings of named files", () => {
  windows("binds drive-relative arguments per Win32 rules (REQ-SEC-0e45a496)", async () => {
    const root = await bench();
    const drive = root.slice(0, 1);
    const other = drive.toUpperCase() === "Q" ? "R" : "Q";
    const atRoot = await prepareProgramRequest(
      input(root, [`${drive}:build/app.bin`, `${other}:build/app.bin`]),
    );
    expect(atRoot.files).toEqual([{ arg: 0, path: "build/app.bin", sha256: sha("image") }]);
    const inBuild = await prepareProgramRequest(
      input(root, [`--image=${drive.toLowerCase()}:app.bin`, `${drive}:`], { cwd: "build" }),
    );
    expect(inBuild.files).toEqual([{ arg: 0, path: "build/app.bin", sha256: sha("image") }]);
  });
  windows("binds alias spellings to the file Windows opens (REQ-SEC-13954028)", async () => {
    const root = await bench();
    const spellings = [
      "build/app.bin::$DATA.",
      "build/app.bin::$DATA ",
      "build/app.bin. .",
      "build./app.bin",
      "build::$INDEX_ALLOCATION/app.bin",
      "build:$I30:$INDEX_ALLOCATION\\app.bin",
      "build/app.bin::$data",
    ];
    const request = await prepareProgramRequest(input(root, [...spellings, "build/app.bin.::$DATA"]));
    expect(request.files).toEqual(
      spellings.map((_, arg) => ({ arg, path: "build/app.bin", sha256: sha("image") })),
    );
  });
  windows("refuses named streams of workbench files (REQ-SEC-43a0b743)", async () => {
    const root = await bench();
    await expect(prepareProgramRequest(input(root, ["x", "build/app.bin:payload"]))).rejects.toMatchObject({
      code: "DENIED",
      params: { reason: "stream", index: 1 },
    });
    await expect(
      prepareProgramRequest(input(root, ["--image=build/app.bin:payload:$DATA"])),
    ).rejects.toMatchObject({ code: "DENIED", params: { reason: "stream", index: 0 } });
    const ordinary = await prepareProgramRequest(input(root, ["missing.bin:payload", "host:1234"]));
    expect(ordinary.files).toEqual([]);
    const device = `\\\\?\\${root}\\build\\app.bin:payload`;
    await expect(prepareProgramRequest(input(root, [device]))).rejects.toMatchObject({
      params: { reason: "stream", index: 0 },
    });
  });
  windows("binds device-namespace and rooted spellings (REQ-SEC-13954028)", async () => {
    const root = await bench();
    const absolute = join(root, "build", "app.bin");
    const request = await prepareProgramRequest(
      input(root, [
        `\\\\?\\${absolute}`,
        `\\\\.\\${absolute}`,
        absolute.slice(2),
        absolute.slice(2).replaceAll("\\", "/"),
      ]),
    );
    expect(request.files).toEqual(
      [0, 1, 2, 3].map((arg) => ({ arg, path: "build/app.bin", sha256: sha("image") })),
    );
  });
  windows("refuses existing UNC paths it cannot map into the workbench (REQ-SEC-aaeae5cb)", async () => {
    const root = await bench();
    const unc = `\\\\localhost\\${root.slice(0, 1)}$${root.slice(2)}\\build\\app.bin`;
    await expect(prepareProgramRequest(input(root, ["x", unc]))).rejects.toMatchObject({
      params: { reason: "unbound", index: 1 },
    });
    await expect(prepareProgramRequest(input(root, [`${unc}:payload`]))).rejects.toMatchObject({
      code: "DENIED",
    });
    // A local share path is refused without reading it; a remote one is an ordinary argument and is never
    // opened, so an agent cannot make VERA connect to another host before the approval.
    await expect(
      prepareProgramRequest(input(root, ["\\\\localhost\\share\\missing.bin"])),
    ).rejects.toMatchObject({ params: { reason: "unbound", index: 0 } });
    const started = Date.now();
    const remote = await prepareProgramRequest(
      input(root, ["\\\\attacker.invalid\\s\\x.bin", "//attacker.invalid/s/y"]),
    );
    expect(remote.files).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
    // Other spellings of this machine are local too.
    const local = [
      `${hostname()}.localdomain`,
      "127.0.0.1",
      "[::1]",
      "0--1.ipv6-literal.net",
      ...Object.values(networkInterfaces())
        .flat()
        .flatMap((address) => (address?.family === "IPv4" ? [address.address] : [])),
    ];
    for (const host of local)
      await expect(prepareProgramRequest(input(root, [`\\\\${host}\\share\\app.bin`]))).rejects.toMatchObject(
        { params: { reason: "unbound", index: 0 } },
      );
  });
  windows(
    "reads NT \\??\\ paths like \\\\?\\ and //?/ like \\\\.\\ (REQ-SEC-13954028, REQ-SEC-43a0b743)",
    async () => {
      const root = await bench();
      const absolute = join(root, "build", "app.bin");
      const bound = await prepareProgramRequest(
        input(root, [`\\??\\${absolute}`, `//?/${absolute.replaceAll("\\", "/")}.`]),
      );
      expect(bound.files).toEqual(
        [0, 1].map((arg) => ({ arg, path: "build/app.bin", sha256: sha("image") })),
      );
      await expect(prepareProgramRequest(input(root, [`\\??\\${absolute}:payload`]))).rejects.toMatchObject({
        params: { reason: "stream", index: 0 },
      });
      const started = Date.now();
      const remote = await prepareProgramRequest(input(root, ["\\??\\UNC\\attacker.invalid\\s\\x"]));
      expect(remote.files).toEqual([]);
      expect(Date.now() - started).toBeLessThan(1000);
    },
  );
  windows("takes \\\\?\\ names literally and \\\\.\\ names like plain paths (REQ-SEC-13954028)", async () => {
    const root = await bench();
    await writeFile(join(root, "build", "app.bin."), "other");
    const absolute = join(root, "build", "app.bin.");
    await expect(prepareProgramRequest(input(root, [`\\\\?\\${absolute}`]))).rejects.toMatchObject({
      params: { reason: "unbound", index: 0 },
    });
    const normalised = await prepareProgramRequest(
      input(root, [`\\\\.\\${join(root, "build", "app.bin")}.`]),
    );
    expect(normalised.files).toEqual([{ arg: 0, path: "build/app.bin", sha256: sha("image") }]);
  });
  windows(
    "refuses volume and GLOBALROOT paths and keeps bare devices ordinary (REQ-SEC-aaeae5cb)",
    async () => {
      const root = await bench();
      for (const path of [
        "\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\build\\app.bin",
        "\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\build\\app.bin:payload",
        "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\build\\app.bin",
      ])
        await expect(prepareProgramRequest(input(root, [path]))).rejects.toMatchObject({
          params: { reason: "unbound", index: 0 },
        });
      const ports = await prepareProgramRequest(input(root, ["--port", "\\\\.\\COM10"]));
      expect(ports.files).toEqual([]);
    },
  );
  windows("refuses a literal trailing-dot file reached through ::$DATA (REQ-SEC-aaeae5cb)", async () => {
    const root = await bench();
    // Node writes the trailing-dot name through the \\?\ namespace, which Win32 programs can open.
    await writeFile(join(root, "build", "app.bin."), "other");
    await expect(prepareProgramRequest(input(root, ["build/app.bin.::$DATA"]))).rejects.toMatchObject({
      params: { reason: "unbound", index: 0 },
    });
  });
  windows("voids an approval when a drive-relative file changes (REQ-SEC-0e45a496)", async () => {
    const root = await bench();
    const request = await prepareProgramRequest(input(root, [`${root.slice(0, 1)}:build/app.bin`]));
    expect(request.files).toHaveLength(1);
    await writeFile(join(root, "build/app.bin"), "rebuilt");
    await expect(verifyProgramFiles(request)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
describe("names that only look like parent paths", () => {
  it("binds a workbench file whose name starts with two dots", async () => {
    const root = await bench();
    await writeFile(join(root, "..app.bin"), "dots");
    const request = await prepareProgramRequest(input(root, ["..app.bin"]));
    expect(request.files).toEqual([{ arg: 0, path: "..app.bin", sha256: sha("dots") }]);
  });
});
describe("files the guard cannot bind outside Windows (REQ-SEC-aaeae5cb)", () => {
  it("refuses an existing reserved-name file and keeps missing ones ordinary", async () => {
    const root = await bench();
    // Node writes a trailing-dot name through the \?\ namespace on Windows, as Linux would.
    await writeFile(join(root, "image.bin."), "odd");
    await expect(
      prepareProgramRequest(input(root, ["x", "image.bin."], { platform: "linux" })),
    ).rejects.toMatchObject({ code: "DENIED", params: { reason: "unbound", index: 1 } });
    const ordinary = await prepareProgramRequest(input(root, ["aux.bin"], { platform: "linux" }));
    expect(ordinary.files).toEqual([]);
  });
  it.runIf(process.platform === "linux")("refuses an existing aux.bin natively", async () => {
    const root = await bench();
    await writeFile(join(root, "aux.bin"), "aux");
    await expect(prepareProgramRequest(input(root, ["aux.bin"]))).rejects.toMatchObject({
      params: { reason: "unbound", index: 0 },
    });
  });
});
describe("verifyProgramFiles (REQ-SEC-370f2d9b)", () => {
  it("passes for unchanged files and is CONFLICT once a named file changes", async () => {
    const root = await bench();
    const request = await prepareProgramRequest(input(root, ["write_flash", "0x0", "build/app.bin"]));
    await expect(verifyProgramFiles(request)).resolves.toBeUndefined();
    await writeFile(join(root, "build/app.bin"), "rebuilt");
    await expect(verifyProgramFiles(request)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
