import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionMode, PluginRisk, ProgramPolicy, SessionEvent } from "@vera/shared";
import { afterEach, describe, expect, it } from "vitest";
import { plugin } from "../plugins/program-fixtures.test-support.js";
import { type ProgramChangeRequest, prepareProgramRequest } from "../plugins/program-request.js";
import { openDb } from "../storage/db.js";
import { ApprovalGate, requestSha256 } from "./approvals.js";

const closes: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const rules = [
  { match: "tool version", risk: "safe" },
  { match: "tool read *", risk: "device-read" },
  { match: "tool write *", risk: "device-write", note: "Rewrites flash." },
  { match: "tool burn *", risk: "irreversible", note: "Permanent." },
  { match: "tool monitor", risk: "blocked" },
];
const commands: Record<Exclude<PluginRisk, "blocked">, string[]> = {
  safe: ["version"],
  "device-read": ["read", "mac"],
  "device-write": ["write", "build/app.bin"],
  irreversible: ["burn", "key.bin"],
};
async function setup(initial: PermissionMode = "ask") {
  const root = await mkdtemp(join(tmpdir(), "vera-program-gate-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "build"));
  await writeFile(join(root, "build/app.bin"), "image v1");
  await writeFile(join(root, "key.bin"), "key");
  const handle = await openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  closes.push(() => handle.close());
  handle.db
    .prepare("INSERT INTO sessions(id,title,permission_mode,status) VALUES ('ses_1','t','ask','idle')")
    .run();
  let mode = initial;
  const events: SessionEvent[] = [];
  const gate = new ApprovalGate({
    db: handle.db,
    now: () => new Date().toISOString(),
    active: () => true,
    mode: () => mode,
    assertWritable: () => {},
    record: (_session, event) => {
      events.push(event);
      return () => {};
    },
  });
  let call = 0;
  const prepare = (args: string[], trial = false, callId = `call_${++call}`) =>
    prepareProgramRequest({
      workbench: root,
      plugin: plugin("bench-tool", ["tool"], rules, trial ? "trial" : "local"),
      program: "tool",
      executable: "/opt/tool",
      args,
      sessionId: "ses_1",
      turnId: "turn_1",
      callId,
    });
  const rows = () =>
    handle.db.prepare("SELECT decision,decided_by,consumed_at FROM approvals ORDER BY rowid").all() as {
      decision: string | null;
      decided_by: string | null;
      consumed_at: string | null;
    }[];
  const pending = () => {
    const requested = events.filter((e) => e.type === "approval.requested").at(-1);
    if (requested?.type !== "approval.requested") throw Error("No approval requested");
    return requested;
  };
  return {
    root,
    gate,
    events,
    rows,
    pending,
    prepare,
    setMode: (next: PermissionMode) => {
      mode = next;
    },
  };
}
const settled = <T>(promise: Promise<T>) =>
  Promise.race([
    promise.then((value) => ({ value })),
    new Promise<"pending">((r) => setTimeout(() => r("pending"), 20)),
  ]);
const decide = (
  t: Awaited<ReturnType<typeof setup>>,
  extra: { decision?: "approved" | "denied"; confirmation?: string; switchToAutoEdit?: boolean } = {},
) => {
  const requested = t.pending();
  t.gate.decide({
    sessionId: "ses_1",
    approvalId: requested.approvalId,
    requestSha256: requested.requestSha256,
    decision: extra.decision ?? "approved",
    ...(extra.confirmation !== undefined ? { confirmation: extra.confirmation } : {}),
    ...(extra.switchToAutoEdit ? { switchToAutoEdit: true } : {}),
  });
};

describe("mode matrix (REQ-FUNC-8d305364)", () => {
  const table: Record<PermissionMode, ProgramPolicy[]> = {
    "read-only": ["run", "refuse", "refuse", "refuse"],
    ask: ["run", "user", "user", "confirm"],
    "auto-edit": ["run", "mode", "user", "confirm"],
    bypass: ["run", "mode", "mode", "mode"],
  };
  for (const [mode, policies] of Object.entries(table) as [PermissionMode, ProgramPolicy[]][])
    for (const [index, risk] of (
      ["safe", "device-read", "device-write", "irreversible"] as const
    ).entries()) {
      const policy = policies[index] as ProgramPolicy;
      it(`${mode} ${risk} -> ${policy}`, async () => {
        const t = await setup(mode);
        const request = await t.prepare(commands[risk]);
        expect(request.risk).toBe(risk);
        const result = t.gate.request(request, new AbortController().signal);
        if (policy === "run" || policy === "refuse") {
          expect(await result).toBe(policy === "run" ? "approved" : "aborted");
          expect(t.rows()).toEqual([]);
          expect(t.events).toEqual([]);
          if (policy === "run") t.gate.consume(request);
          else expect(() => t.gate.consume(request)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
          return;
        }
        const requested = t.pending();
        expect(requested).toMatchObject({
          tool: "run_program",
          path: "tool",
          diff: "",
          bytes: 0,
          requestSha256: requestSha256(request),
          program: { risk, program: "tool", args: commands[risk], confirm: request.confirm },
        });
        if (policy === "mode") {
          expect(await result).toBe("approved");
          expect(t.rows()).toEqual([{ decision: "approved", decided_by: "mode", consumed_at: null }]);
        } else {
          expect(await settled(result)).toBe("pending");
          expect(t.rows()).toEqual([{ decision: null, decided_by: null, consumed_at: null }]);
          decide(t, policy === "confirm" ? { confirmation: "burn" } : {});
          expect(await result).toBe("approved");
          expect(t.rows()[0]).toMatchObject({ decision: "approved", decided_by: "user" });
        }
        t.gate.consume(request);
        expect(t.rows()[0]?.consumed_at).not.toBeNull();
        expect(() => t.gate.consume(request)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
      });
    }
});

describe("blocked commands (REQ-SEC-94998c85)", () => {
  for (const mode of ["read-only", "ask", "auto-edit", "bypass"] as const)
    for (const trial of [false, true])
      it(`${mode}${trial ? " trial" : ""} refuses without a record`, async () => {
        const t = await setup(mode);
        const request = await t.prepare(["monitor"], trial);
        expect(request.risk).toBe("blocked");
        expect(await t.gate.request(request, new AbortController().signal)).toBe("aborted");
        expect(t.rows()).toEqual([]);
        expect(t.events).toEqual([]);
      });
});

describe("trial plugins (REQ-SEC-2b4bcdf5)", () => {
  it("a safe command waits for the user in bypass, also across a switch to bypass", async () => {
    const t = await setup("bypass");
    const request = await t.prepare(["version"], true);
    const result = t.gate.request(request, new AbortController().signal);
    expect(await settled(result)).toBe("pending");
    t.gate.approveBypass("ses_1");
    expect(await settled(result)).toBe("pending");
    decide(t);
    expect(await result).toBe("approved");
    expect(t.rows()[0]).toMatchObject({ decided_by: "user" });
    t.gate.consume(request);
  });
  it("an irreversible command needs the typed word in bypass", async () => {
    const t = await setup("bypass");
    const result = t.gate.request(await t.prepare(["burn", "key.bin"], true), new AbortController().signal);
    expect(() => decide(t)).toThrow(
      expect.objectContaining({ code: "INVALID", messageKey: "approval.confirmMismatch" }),
    );
    decide(t, { confirmation: "burn" });
    expect(await result).toBe("approved");
  });
  it("every command is refused in read-only", async () => {
    const t = await setup("read-only");
    expect(await t.gate.request(await t.prepare(["version"], true), new AbortController().signal)).toBe(
      "aborted",
    );
    expect(t.rows()).toEqual([]);
  });
});

describe("typed confirmation (REQ-SEC-e8695b28, REQ-SEC-08fbf962, REQ-SEC-f40ac584)", () => {
  it("accepts trimmed, normalised text and needs none to deny", async () => {
    const t = await setup("auto-edit");
    const first = t.gate.request(await t.prepare(["burn", "key.bin"]), new AbortController().signal);
    decide(t, { confirmation: "  BURN " });
    expect(await first).toBe("approved");
    const second = t.gate.request(await t.prepare(["burn", "key.bin"]), new AbortController().signal);
    decide(t, { decision: "denied" });
    expect(await second).toBe("denied");
  });
  it("refuses a wrong or missing word and keeps the approval pending", async () => {
    const t = await setup("ask");
    const result = t.gate.request(await t.prepare(["burn", "key.bin"]), new AbortController().signal);
    for (const confirmation of [undefined, "", "bur", "burn-key"])
      expect(() => decide(t, confirmation === undefined ? {} : { confirmation })).toThrow(
        expect.objectContaining({ code: "INVALID", messageKey: "approval.confirmMismatch" }),
      );
    expect(t.events.some((e) => e.type === "approval.decided")).toBe(false);
    expect(t.rows()).toEqual([{ decision: null, decided_by: null, consumed_at: null }]);
    expect(await settled(result)).toBe("pending");
    decide(t, { confirmation: "burn" });
    expect(await result).toBe("approved");
  });
  it("refuses switching to auto-edit with a typed confirmation", async () => {
    const t = await setup("ask");
    const result = t.gate.request(await t.prepare(["burn", "key.bin"]), new AbortController().signal);
    expect(() => decide(t, { confirmation: "burn", switchToAutoEdit: true })).toThrow(
      expect.objectContaining({ code: "INVALID" }),
    );
    expect(t.events.some((e) => e.type === "session.updated")).toBe(false);
    expect(await settled(result)).toBe("pending");
    const write = await setup("ask");
    const written = write.gate.request(
      await write.prepare(["write", "build/app.bin"]),
      new AbortController().signal,
    );
    decide(write, { switchToAutoEdit: true });
    expect(await written).toBe("approved");
    expect(write.events).toContainEqual({ type: "session.updated", mode: "auto-edit" });
  });
});

describe("mode changes (REQ-FUNC-43114b84, REQ-SEC-ce28991b)", () => {
  it("switching to bypass approves pending commands of non-trial plugins by mode", async () => {
    const t = await setup("ask");
    const burn = t.gate.request(await t.prepare(["burn", "key.bin"]), new AbortController().signal);
    const trial = t.gate.request(await t.prepare(["read", "mac"], true), new AbortController().signal);
    t.setMode("bypass");
    t.gate.approveBypass("ses_1");
    expect(await burn).toBe("approved");
    expect(await settled(trial)).toBe("pending");
    expect(t.rows().map((row) => row.decided_by)).toEqual(["mode", null]);
  });
  it("revokes a mode-decided approval the current mode would not grant", async () => {
    const t = await setup("bypass");
    const write = await t.prepare(["write", "build/app.bin"]);
    expect(await t.gate.request(write, new AbortController().signal)).toBe("approved");
    t.setMode("ask");
    expect(() => t.gate.consume(write)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    t.setMode("auto-edit");
    const read = await t.prepare(["read", "mac"]);
    expect(await t.gate.request(read, new AbortController().signal)).toBe("approved");
    t.setMode("bypass");
    t.gate.consume(read);
  });
});

describe("single use (REQ-SEC-f98d4fd3, REQ-SEC-ce28991b)", () => {
  it("a user approval covers only its own call and no longer consumes in read-only", async () => {
    const t = await setup("ask");
    const request = await t.prepare(["write", "build/app.bin"], false, "call_a");
    const result = t.gate.request(request, new AbortController().signal);
    decide(t);
    expect(await result).toBe("approved");
    const other = await t.prepare(["write", "build/app.bin"], false, "call_b");
    expect(() => t.gate.consume(other)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    t.setMode("read-only");
    expect(() => t.gate.consume(request)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    t.setMode("ask");
    t.gate.consume(request);
  });
});

describe("file binding (REQ-SEC-f98d4fd3)", () => {
  it("a changed image file voids the approval; an unchanged one consumes once", async () => {
    const t = await setup("ask");
    const request: ProgramChangeRequest = await t.prepare(["write", "build/app.bin"], false, "call_flash");
    const result = t.gate.request(request, new AbortController().signal);
    decide(t);
    expect(await result).toBe("approved");
    await writeFile(join(t.root, "build/app.bin"), "image v2");
    const rebuilt = await t.prepare(["write", "build/app.bin"], false, "call_flash");
    expect(rebuilt.files[0]?.sha256).not.toBe(request.files[0]?.sha256);
    expect(() => t.gate.consume(rebuilt)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(t.rows()[0]?.consumed_at).toBeNull();
    await writeFile(join(t.root, "build/app.bin"), "image v1");
    const same = await t.prepare(["write", "build/app.bin"], false, "call_flash");
    t.gate.consume(same);
    expect(() => t.gate.consume(same)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });
});
