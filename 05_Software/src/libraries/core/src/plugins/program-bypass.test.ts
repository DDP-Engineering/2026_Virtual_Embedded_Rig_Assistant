import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PermissionMode, veraError } from "@vera/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestSha256 } from "../agent/approvals.js";
import { type ToolContext, toolPathGuard } from "../tools/context.js";
import { FakeHost } from "./fake-process-host.test-support.js";
import { plugin } from "./program-fixtures.test-support.js";
import { type ProgramChangeRequest, programApproval, verifyProgramFiles } from "./program-request.js";
import { ProgramSession, runProgramTool } from "./program-tools.js";
import { ProgramRunner } from "./runner.js";

let scratch: string;
let root: string;
let outside: string;
let managed: string;
let mode: PermissionMode;
let scope: AbortController;
let host: FakeHost;
let runner: ProgramRunner;
let ctx: ToolContext;
let approved: ProgramChangeRequest;
let verify: (() => Promise<void>) | undefined;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "vera-program-bypass-")));
  root = join(scratch, "bench");
  outside = join(scratch, "second-repo");
  managed = join(scratch, "application-data");
  for (const path of [root, outside, managed]) await mkdir(path);
  await writeFile(join(outside, "input.bin"), "approved bytes");
  await writeFile(join(managed, "settings.json"), "protected bytes");
  mode = "bypass";
  scope = new AbortController();
  verify = undefined;
  host = new FakeHost();
  runner = new ProgramRunner({ host, clock: { sleep: async () => {} } });
  const loaded = plugin("fixture", ["fixture"], [{ match: "fixture *", risk: "safe" }]);
  loaded.verify = async () => verify?.();
  ctx = {
    root,
    managedRoots: [managed],
    lastReads: new Map(),
    permissionMode: () => mode,
    bypassSignal: () => scope.signal,
    programs: {
      session: new ProgramSession(),
      sessionId: "session",
      turnId: "turn",
      callId: "call",
      consume: (request) => {
        if (requestSha256(request) !== requestSha256(approved)) throw veraError("CONFLICT");
      },
      host: {
        runner,
        clock: { sleep: async () => {} },
        plugins: async () => [loaded],
        resolver: { resolve: async () => ({ executable: "/fixture" }) },
      },
    },
  };
});
afterEach(async () => {
  await runner.stopAll();
  await rm(scratch, { recursive: true, force: true });
});
async function prepare(args: Record<string, unknown>) {
  const call = await runProgramTool.prepare?.(
    ctx,
    { program: "fixture", ...args },
    new AbortController().signal,
  );
  if (!call) throw Error("Missing prepared run");
  approved = call.request as ProgramChangeRequest;
  return call;
}

it.each(["read-only", "ask", "auto-edit"] as const)(
  "refuses outside cwd and recognized file arguments in %s",
  async (value) => {
    mode = value;
    await expect(prepare({ cwd: outside })).rejects.toThrow();
    await expect(prepare({ args: [join(outside, "input.bin")] })).rejects.toThrow(/outside|workbench/);
    await expect(prepare({ args: ["../second-repo/input.bin"] })).rejects.toThrow(/outside|workbench/);
    await expect(prepare({ args: ["-C", outside, "status"] })).rejects.toThrow(/outside|workbench/);
    expect(host.programs).toHaveLength(0);
  },
);

it("binds outside cwd and relative/absolute files and retains workbench logs", async () => {
  const file = join(outside, "input.bin").replaceAll("\\", "/");
  const call = await prepare({ cwd: outside, args: ["input.bin", `--file=${file}`], background: true });
  expect(programApproval(approved)).toMatchObject({
    cwd: outside.replaceAll("\\", "/"),
    files: [
      { arg: 0, path: file },
      { arg: 1, path: file },
    ],
  });
  const result = await call.apply(new AbortController().signal);
  expect(host.programs[0]?.options.cwd).toBe(outside);
  expect(result.log).toMatch(/^\.vera\/runs\//);
  expect(await readFile(join(root, String(result.log)), "utf8")).toBe("");
});

it("rehashes outside files after approval consumption and after plugin verification", async () => {
  const call = await prepare({ cwd: outside, args: ["input.bin"], background: true });
  verify = async () => writeFile(join(outside, "input.bin"), "changed just before spawn");
  await expect(call.apply(new AbortController().signal)).rejects.toThrow(/changed|approval/);
  expect(host.programs).toHaveLength(0);
});

it("refuses an outside file changed between approval and apply", async () => {
  const call = await prepare({ args: [join(outside, "input.bin")], background: true });
  await writeFile(join(outside, "input.bin"), "changed after approval");
  await expect(
    verifyProgramFiles(approved, undefined, [managed], await toolPathGuard(ctx)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(call.apply(new AbortController().signal)).rejects.toThrow(/changed|approval/);
  expect(host.programs).toHaveLength(0);
});

it("retains outside background revocation beyond normal turn completion", async () => {
  const call = await prepare({ cwd: outside, background: true });
  const turn = new AbortController();
  const result = await call.apply(turn.signal);
  const run = ctx.programs?.session.get(String(result.handle));
  expect(run?.read().running).toBe(true);
  turn.abort();
  expect(run?.read().running).toBe(true);
  mode = "ask";
  scope.abort();
  await vi.waitFor(() => expect(run?.read().running).toBe(false));
  expect(await run?.done).toMatchObject({ stopped: true });
});

it.each(["before apply", "after consume"] as const)(
  "retains the revoked Bypass epoch across re-entry %s with no file arguments",
  async (when) => {
    const revoke = () => {
      mode = "ask";
      scope.abort();
      scope = new AbortController();
      mode = "bypass";
    };
    const consume = ctx.programs?.consume;
    if (when === "after consume" && ctx.programs)
      ctx.programs.consume = (request) => {
        consume?.(request);
        revoke();
      };
    const call = await prepare({ cwd: outside, background: true });
    expect(approved.files).toEqual([]);
    if (when === "before apply") revoke();
    await call.apply(new AbortController().signal).catch(() => undefined);
    expect(host.programs).toHaveLength(0);
  },
);

it("refuses mode revocation during pre-spawn plugin verification", async () => {
  const call = await prepare({ cwd: outside, background: true });
  verify = async () => {
    mode = "ask";
    scope.abort();
  };
  await expect(call.apply(new AbortController().signal)).rejects.toThrow();
  expect(host.programs).toHaveLength(0);
});

it("rechecks an argument alias after consumption even when the replacement bytes match", async () => {
  const original = join(outside, "original"),
    replacement = join(outside, "replacement"),
    alias = join(outside, "alias");
  for (const path of [original, replacement]) {
    await mkdir(path);
    await writeFile(join(path, "input.bin"), "approved bytes");
  }
  await symlink(original, alias, process.platform === "win32" ? "junction" : "dir");
  const call = await prepare({ args: [join(alias, "input.bin")], background: true });
  verify = async () => {
    await rm(alias);
    await symlink(replacement, alias, process.platform === "win32" ? "junction" : "dir");
  };
  await expect(call.apply(new AbortController().signal)).rejects.toThrow(/changed|approval/);
  expect(host.programs).toHaveLength(0);
});

it("refuses a workbench argument alias that resolves to an outside file outside Bypass", async () => {
  await symlink(outside, join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
  mode = "ask";
  await expect(prepare({ args: ["alias/input.bin"] })).rejects.toThrow(/outside|workbench/);
  await expect(prepare({ args: ["-C", "alias", "status"] })).rejects.toThrow(/outside|workbench/);
  expect(host.programs).toHaveLength(0);
});

it("validates outside directory arguments in Bypass without hashing directory contents", async () => {
  const call = await prepare({ args: ["-C", outside, "status"], background: true });
  expect(approved.files).toEqual([]);
  await writeFile(join(outside, "new-file.txt"), "directory contents can change");
  await call.apply(new AbortController().signal);
  expect(host.programs[0]?.args).toEqual(["-C", outside, "status"]);
  expect(host.programs[0]?.options.cwd).toBe(root);
});

it("records canonical outside directory aliases without rewriting argv or hashing contents", async () => {
  await symlink(outside, join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
  await prepare({ args: ["-C", "alias", "status"], background: true });
  expect(programApproval(approved)).toMatchObject({
    args: ["-C", "alias", "status"],
    cwd: ".",
    files: [],
    directories: [{ arg: 1, path: outside.replaceAll("\\", "/") }],
  });
});

it("refuses an outside directory argument alias redirected after consumption", async () => {
  const alias = join(root, "alias"),
    replacement = join(scratch, "replacement");
  await mkdir(replacement);
  await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  const call = await prepare({ args: ["-C", "alias", "status"], background: true });
  verify = async () => {
    await rm(alias);
    await symlink(replacement, alias, process.platform === "win32" ? "junction" : "dir");
  };
  await expect(call.apply(new AbortController().signal)).rejects.toThrow(/changed after approval/);
  expect(host.programs).toHaveLength(0);
});

it.each(["read-only", "ask", "auto-edit"] as const)(
  "rechecks an unbound directory argument's scope before spawn in %s",
  async (value) => {
    mode = value;
    const directory = join(root, "target");
    await mkdir(directory);
    const call = await prepare({ args: ["-C", "target", "status"], background: true });
    expect(approved.files).toEqual([]);
    verify = async () => {
      await rm(directory, { recursive: true });
      await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
    };
    await expect(call.apply(new AbortController().signal)).rejects.toThrow(/changed after approval/);
    expect(host.programs).toHaveLength(0);
  },
);

it("refuses an outside cwd redirected to application data during final verification", async () => {
  const call = await prepare({ cwd: outside, background: true });
  verify = async () => {
    await rm(outside, { recursive: true });
    await symlink(managed, outside, process.platform === "win32" ? "junction" : "dir");
  };
  await expect(call.apply(new AbortController().signal)).rejects.toThrow(/VERA application data/);
  expect(host.programs).toHaveLength(0);
});

it.each(["read-only", "ask", "auto-edit", "bypass"] as const)(
  "rechecks application-data exclusions for an initially missing argument in %s",
  async (value) => {
    mode = value;
    const call = await prepare({ args: ["future/settings.json"], background: true });
    expect(approved.files).toEqual([]);
    verify = async () => {
      await symlink(managed, join(root, "future"), process.platform === "win32" ? "junction" : "dir");
    };
    await expect(call.apply(new AbortController().signal)).rejects.toThrow(/VERA application data/);
    expect(host.programs).toHaveLength(0);
  },
);

it.runIf(process.platform === "win32")(
  "binds outside Windows aliases and refuses their named streams",
  async () => {
    const file = join(outside, "input.bin");
    const call = await prepare({
      cwd: outside,
      args: ["input.bin.", "input.bin::$DATA", `\\\\?\\${file}`, `${file.slice(0, 2)}input.bin`],
    });
    expect((call.request as ProgramChangeRequest).files.map((entry) => entry.path)).toEqual(
      Array(4).fill(file.replaceAll("\\", "/")),
    );
    for (const value of [`${file}:payload`, `${file}:payload:$DATA`])
      await expect(prepare({ args: [value] })).rejects.toThrow(/stream/);
    mode = "auto-edit";
    for (const value of [`${file}.`, `${file}::$DATA`, `\\\\?\\${file}`])
      await expect(prepare({ args: [value] })).rejects.toThrow(/outside|workbench/);
  },
);

it.runIf(process.platform === "win32")(
  "rechecks an initially missing Windows stream base before spawn",
  async () => {
    const call = await prepare({ args: ["--file=future/settings.json:payload"], background: true });
    expect(approved.files).toEqual([]);
    verify = async () => {
      await symlink(managed, join(root, "future"), "junction");
    };
    await expect(call.apply(new AbortController().signal)).rejects.toThrow(/VERA application data/);
    expect(host.programs).toHaveLength(0);
  },
);

it.each(["read-only", "ask", "auto-edit", "bypass"] as const)(
  "preserves direct, cwd-relative and alias application-data refusal in %s",
  async (value) => {
    mode = value;
    await symlink(managed, join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    const paths = [
      join(managed, "settings.json"),
      "../application-data/settings.json",
      "alias/settings.json",
      "../application-data/missing.bin",
    ];
    if (process.platform === "win32")
      paths.push(`${managed}/SETTINGS.JSON::$DATA`, `${managed}/settings.json:payload`);
    for (const path of paths)
      await expect(prepare({ args: [path] })).rejects.toThrow(/VERA application data/);
    await expect(prepare({ cwd: managed })).rejects.toThrow();
    expect(host.programs).toHaveLength(0);
  },
);
