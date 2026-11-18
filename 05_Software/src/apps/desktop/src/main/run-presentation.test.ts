import { createMaskingResolver } from "@vera/core";
import {
  channels,
  type PluginProgramStatus,
  type ProgramRunInfo,
  type Settings,
  type WorkbenchSnapshot,
  workbenchSchema,
} from "@vera/shared";
import { expect, it, vi } from "vitest";
import { RunPresentation } from "./run-presentation.js";

const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const other = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0D";
const secret = "mqtt-password-one";
const run: ProgramRunInfo = {
  id: "01JC00000000000000000000R2",
  sessionId: "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  args: [secret],
  command: { text: `echo ${secret}`, cwd: `/owned/${secret}` },
  state: "exited",
  background: false,
  startedAt: "2026-11-17T00:00:00.000Z",
  log: ".vera/runs/01JC00000000000000000000R2.log",
  error: `failed ${secret}`,
};
const statuses: PluginProgramStatus[] = [
  {
    name: "tool",
    kind: "find",
    state: "unavailable",
    detail: secret,
    hint: secret,
    path: `/tools/${secret}`,
    version: secret,
  },
];
function fixture() {
  let app: Pick<Settings, "privacy"> = {};
  let config = workbenchSchema.parse({ format: 1, id, name: "Runs" });
  let folder = "/owned";
  let open = true;
  const runner = {
    list: vi.fn(async () => [run]),
    log: vi.fn(async () => ({ id: run.id, text: secret, truncated: false, running: false })),
  };
  const presentation = new RunPresentation({
    current: () => {
      if (!open) throw Error("No open workbench");
      return { config, folder } as WorkbenchSnapshot;
    },
    maskingFor: createMaskingResolver(() => app),
    scrub: (text) => text.replaceAll(secret, "[REDACTED]"),
    runner,
  });
  return {
    presentation,
    runner,
    close: () => {
      open = false;
    },
    relocate: () => {
      folder = "/replaced";
    },
    app: (runs: boolean) => {
      app = { privacy: { mask: { runs, display: !runs, agent: true } } };
    },
    choice: (runs: "on" | "off" | "default") => {
      config = { ...config, privacy: { mask: { runs } } };
    },
    switch: () => {
      config = { ...config, id: other };
      folder = "/other";
    },
  };
}

it("projects args, command/canonical cwd, error, tail/full logs and statuses using live runs alone", async () => {
  const f = fixture();
  const check = async (masked: boolean) => {
    const expected = masked ? "[REDACTED]" : secret;
    const list = channels["runs.list"].response.parse(await f.presentation.list(id));
    expect(list.runs[0]?.args).toEqual([expected]);
    expect(list.runs[0]?.command).toEqual({ text: `echo ${expected}`, cwd: `/owned/${expected}` });
    expect(list.runs[0]?.error).toBe(`failed ${expected}`);
    for (const full of [false, true])
      expect(channels["runs.log"].response.parse(await f.presentation.log(id, run.id, full)).text).toBe(
        expected,
      );
    expect((await f.presentation.statuses(async () => statuses, id))[0]?.detail).toBe(expected);
  };
  await check(false);
  f.app(true);
  await check(true);
  f.choice("off");
  await check(false);
  f.app(false);
  f.choice("on");
  await check(true);
  f.choice("default");
  await check(false);
  // A full log is bounded: the runner returns its last 8 MiB and marks it truncated.
  expect(f.runner.log).toHaveBeenCalledWith("/owned", run.id, 8 * 1024 * 1024);
  expect(run.args).toEqual([secret]);
  expect(statuses[0]?.detail).toBe(secret);
  f.choice("on");
  expect((await f.presentation.statuses(async () => statuses))[0]?.detail).toBe(secret);
  f.app(true);
  expect((await f.presentation.statuses(async () => statuses))[0]?.detail).toBe("[REDACTED]");
});

it.each(["list", "log", "status"])(
  "refuses foreign owners and owner changes during %s publication",
  async (kind) => {
    const f = fixture();
    await expect(f.presentation.list(other)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.presentation.log(other, run.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.presentation.statuses(async () => statuses, other)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const pending =
      kind === "list"
        ? f.presentation.list(id)
        : kind === "log"
          ? f.presentation.log(id, run.id)
          : f.presentation.statuses(async () => statuses, id);
    f.switch();
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await f.presentation.list(other)).runs[0]?.args).toEqual([secret]);
  },
);

it("uses the policy at publication after a read started", async () => {
  const f = fixture();
  const pending = f.presentation.log(id, run.id);
  f.app(true);
  expect((await pending).text).toBe("[REDACTED]");
});

it.each(["close", "relocate"] as const)("refuses a pending log when its owner is %s", async (change) => {
  const f = fixture();
  const pending = f.presentation.log(id, run.id);
  f[change]();
  await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
});
