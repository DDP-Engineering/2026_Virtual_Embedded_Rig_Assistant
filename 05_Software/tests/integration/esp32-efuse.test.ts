import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  classifyCommand,
  type PermissionMode,
  type PluginManifest,
  type SessionEvent,
  validatePluginManifest,
} from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

const source = new URL("../../plugins/esp32-efuse/", import.meta.url);
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));
const reads = ["summary", "dump", "check-error", "get-custom-mac", "adc-info"];
const burns = [
  "burn-efuse",
  "burn-block-data",
  "burn-bit",
  "burn-key",
  "burn-key-digest",
  "burn-custom-mac",
  "write-protect-efuse",
  "read-protect-efuse",
  "set-flash-voltage",
];
const secure = [
  "decrypt-flash-data",
  "digest-private-key",
  "digest-rsa-public-key",
  "digest-sbv2-public-key",
  "digest-sdc-public-key",
  "digest-secure-bootloader",
  "encrypt-flash-data",
  "extract-public-key",
  "generate-flash-encryption-key",
  "generate-sdc-certificate",
  "generate-signing-key",
  "sign-data",
  "signature-info-v2",
  "verify-signature",
];

it("publishes the official eFuse package disabled in the ESP32 Security group", async () => {
  expect(existsSync(new URL("plugin.yaml", source)), "official eFuse package is missing").toBe(true);
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    format: 1,
    id: "esp32-efuse",
    ecosystem: "esp32",
    platforms: ["windows-x64", "linux-x64"],
  });
  for (const name of ["espefuse", "espsecure"])
    expect(m.programs[name]).toMatchObject({
      install: { pip: "esptool>=5,<6" },
      version: { args: ["--help"], range: ">=5,<6" },
    });
  const packs = parse(await readFile(new URL("../../plugins/packs.yaml", import.meta.url), "utf8"));
  expect(packs.find((p: { id: string }) => p.id === "esp32").groups).toContainEqual({
    name: "Security (irreversible)",
    plugins: ["esp32-efuse"],
    default: false,
  });
  const catalog = parse(await readFile(new URL("../../plugins/catalog.yaml", import.meta.url), "utf8"));
  expect(catalog.official).toContain("esp32-efuse");
});

it("classifies all actual v5 commands, normalized spellings and highest-risk collisions", async () => {
  const m = await manifest();
  const classify = (...args: string[]) => classifyCommand(m.rules ?? [], "espefuse", args);
  for (const command of [...reads, ...burns, "burn-future-command"]) {
    for (const line of [
      [command],
      ["--chip", "esp32", "--virt", "--path-efuse-file", "state.bin", command],
      ["-c", "esp32", "-p", "COM7", "-b", "115200", command.replaceAll("-", "_")],
      ["--chip=esp32", "--port=COM7", command.toUpperCase(), "FIELD", "1"],
      ["--before", "default-reset", "--after", "no-reset", command, "--help"],
    ]) {
      const result = classify(...line);
      const isRead = reads.includes(command);
      expect(result.risk, line.join(" ")).toBe(isRead ? "device-read" : "irreversible");
      expect(result.confirm).toBe(isRead ? null : command);
      expect(result.notes.join(" ")).toMatch(isRead ? /bootloader/ : /one-time programmable.*never.*brick/);
    }
  }
  for (const args of [
    ["summary", "burn-efuse", "JTAG_DISABLE", "1"],
    ["burn_efuse", "JTAG_DISABLE", "1", "summary"],
    ["--help", "burn-key", "BLOCK1", "key.bin"],
    ["summary", "--path-efuse-file=burn-efuse"],
  ])
    expect(classify(...args).risk).toBe("irreversible");
  // Generic matcher is deliberately conservative: a standalone dangerous token in a value
  // may raise risk. Substrings and a single argv item containing spaces do not become commands.
  for (const args of [["summary-extra"], ["path/burn-efuse"], ["summary burn-efuse"]])
    expect(classify(...args).risk).toBe("device-write");
  expect(classify("summary", "my-burn-key.bin").risk).toBe("device-read");
  expect(classify("--help").risk).toBe("safe");
  expect(classify("unrecognized").risk).toBe("device-write");
  const help = await readFile(
    new URL("../fixtures/esp32-efuse/espefuse-5.6.0-help.txt", import.meta.url),
    "utf8",
  );
  for (const command of [...reads, ...burns]) expect(help).toContain(command);
  const commands = [...help.matchAll(/^[│|] ([a-z][a-z0-9-]+) {2,}/gm)].map((v) => v[1]);
  expect(commands.sort()).toEqual([...reads, ...burns].sort());
});

it("keeps espsecure local file operations safe and blocks HSM forms", async () => {
  const m = await manifest();
  for (const name of secure) {
    const args = [name, "--keyfile", "key.pem", "--output=image.bin", "input.bin"];
    expect(classifyCommand(m.rules ?? [], "espsecure", args).risk).toBe("safe");
    expect(
      classifyCommand(
        m.rules ?? [],
        "espsecure",
        args.map((a) => a.replaceAll("-", "_")),
      ).risk,
    ).toBe("safe");
  }
  for (const option of ["--hsm", "--hsm-config", "--hsm_config", "--hsm-config=hsm.ini", "--HSM"])
    for (const args of [
      ["sign-data", option],
      ["verify-signature", option, "--help"],
    ]) {
      const result = classifyCommand(m.rules ?? [], "espsecure", args);
      expect(result.risk).toBe("blocked");
      expect(result.notes.join(" ")).toMatch(/local.*HSM/);
    }
  expect(classifyCommand(m.rules ?? [], "espsecure", ["sign-data", "--output=hsm.bin"]).risk).toBe("safe");
  const help = await readFile(
    new URL("../fixtures/esp32-efuse/espsecure-5.6.0-help.txt", import.meta.url),
    "utf8",
  );
  for (const command of secure) expect(help).toContain(command);
});

it("teaches an explicit single burn review with summary and a session artifact plan", async () => {
  const skill = await readFile(new URL("skills/esp32-efuse-review/SKILL.md", source), "utf8");
  for (const text of [
    "name: esp32-efuse-review",
    "summary",
    "each requested burn",
    "Refuse to batch",
    "session artifact",
    "before any irreversible",
    "artifact_save",
    "explicitly requests",
    "--do-not-confirm",
    "burn-efuse",
  ])
    expect(skill).toContain(text);
});

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const uv = process.env.VERA_EFUSE_UV;
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Explicit real-CLI acceptance: VERA_EFUSE_UV points to the pinned bundled uv. This user-action
// provisioning may download Python/esptool; default tests have no dependency on network/hardware.
it.skipIf(!uv)(
  "provisions real v5 and proves virtual state and durable approvals through replay",
  async () => {
    const root = await realpath(await mkdtemp(join(process.env.VERA_EFUSE_SCRATCH ?? tmpdir(), "efuse-")));
    const host = new core.NodeProcessHost(spawn);
    const starts: { executable: string; args: readonly string[]; output: string; exit?: unknown }[] = [];
    const native: core.ProcessHost = {
      platform: host.platform,
      env: host.env,
      spawn(executable, args, options) {
        const record: (typeof starts)[number] = { executable, args: [...args], output: "" };
        starts.push(record);
        const child = host.spawn(executable, args, {
          ...options,
          output(stream, bytes) {
            record.output += Buffer.from(bytes).toString("utf8");
            options.output(stream, bytes);
          },
        });
        return {
          ...child,
          exit: child.exit.then((result) => {
            record.exit = result;
            return result;
          }),
        };
      },
      signal: host.signal.bind(host),
    };
    const runner = new core.ProgramRunner({ host: native, clock: { sleep } });
    let provisioner: core.Provisioner | undefined;
    const receipts: unknown[] = [];
    const completed: unknown[] = [];
    let passed = false;
    try {
      const release = await core.buildCatalogRelease(
        fileURLToPath(new URL("../../plugins/", import.meta.url)),
        join(root, "release"),
      );
      expect(release.issues).toEqual([]);
      expect(release.index?.plugins.find((p) => p.id === "esp32-efuse")?.tier).toBe("official");
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(join(root, "release/esp32-efuse-1.0.0.zip"));
      provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        uv: { executable: uv as string },
        host: native,
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("No download program in this package");
        },
      });
      expect((await provisioner.statuses("esp32-efuse")).map((s) => s.state)).toEqual(["missing", "missing"]);
      const statuses = await provisioner.install("esp32-efuse");
      receipts.push({ statuses });
      expect(statuses).toHaveLength(2);
      for (const status of statuses)
        expect(status).toMatchObject({
          state: "ready",
          kind: "pip",
          range: ">=5,<6",
          version: expect.stringMatching(/^5\./),
        });
      const installed = provisioner;
      const plugins = async () => [await store.load("esp32-efuse")];
      for (const mode of ["ask", "auto-edit", "bypass", "read-only"] as PermissionMode[]) {
        const bench = join(root, mode);
        await mkdir(join(bench, ".vera"), { recursive: true });
        const virtual = ["--chip", "esp32", "--virt", "--path-efuse-file", "efuses.bin"];
        const summary = [...virtual, "summary", "JTAG_DISABLE"];
        const burn = [...virtual, "--do-not-confirm", "burn-efuse", "JTAG_DISABLE", "1"];
        const programs: core.ProgramHost = { runner, resolver: installed, plugins, clock: { sleep } };
        const skills = new core.SkillCatalog({
          root: bench,
          disabled: () => [],
          plugins: async () => (await plugins()).map((p) => ({ id: p.manifest.id, folder: p.folder })),
        });
        expect((await skills.list()).map((s) => s.name)).toContain("esp32-efuse-review");
        expect(await core.programPromptEntries(programs, await skills.list())).toContainEqual(
          expect.objectContaining({ name: "espefuse", skills: ["esp32-efuse-review"] }),
        );
        const disabled = new core.SkillCatalog({ root: bench, disabled: () => [], plugins: async () => [] });
        expect((await disabled.list()).map((s) => s.name)).not.toContain("esp32-efuse-review");
        const scripts = join(bench, "replay");
        await mkdir(scripts);
        const run = (program: string, args: string[]) => ({
          toolCalls: [{ name: "run_program", args: { program, args } }],
        });
        const steps = [run("espefuse", summary), run("espefuse", burn), run("espefuse", summary)];
        if (mode === "bypass") steps.push(run("espsecure", ["generate-flash-encryption-key", "key.bin"]));
        await writeFile(
          join(scripts, "efuse.jsonl"),
          [...steps, { text: "Reviewed virtual state" }].map((s) => JSON.stringify(s)).join("\n"),
        );
        const gateway = new ReplayGateway({ dir: scripts, now: () => Date.now() });
        await gateway.models("replay", new AbortController().signal);
        const database = await core.openDb(join(bench, ".vera/vera.db"), {
          workbenchId: `wb_${mode}`,
          appVersion: "0",
        });
        const service = new core.SessionService({
          root: bench,
          db: database.db,
          gateway,
          clock: { now: () => new Date(), sleep: async () => {} },
          model: () => "replay/efuse",
          prompt: () => "Explicit virtual fixture only",
          programs,
          skills,
        });
        const events: SessionEvent[] = [];
        receipts.push({ mode, events });
        const offset = starts.length;
        let beforeHash: string | undefined;
        try {
          await service.waitReady();
          const session = service.create(null, mode);
          service.subscribe(session.id, 0, (_seq, event) => events.push(event));
          const pending = async () => {
            await expect
              .poll(() => service.get(session.id).snapshot.approvals.find((a) => !a.decision), {
                timeout: 20_000,
              })
              .toBeDefined();
            const approval = service.get(session.id).snapshot.approvals.find((a) => !a.decision);
            if (!approval) throw Error("Expected approval");
            return approval;
          };
          const approve = (approval: Awaited<ReturnType<typeof pending>>, confirmation?: string) =>
            service.decideApproval({
              sessionId: session.id,
              approvalId: approval.approvalId,
              requestSha256: approval.requestSha256,
              decision: "approved",
              ...(confirmation === undefined ? {} : { confirmation }),
            });
          service.send(
            session.id,
            "Read virtual summary; explicitly burn JTAG_DISABLE once; read back. This is only a virtual fixture.",
          );
          if (mode === "ask") {
            const read = await pending();
            expect(read.program).toMatchObject({ risk: "device-read", confirm: null, args: summary });
            approve(read);
          }
          if (mode === "ask" || mode === "auto-edit") {
            const approval = await pending();
            expect(approval.program).toMatchObject({
              risk: "irreversible",
              confirm: "burn-efuse",
              args: burn,
            });
            const before = await readFile(join(bench, "efuses.bin"));
            beforeHash = hash(before);
            expect(starts.slice(offset).filter((s) => s.args.includes("burn-efuse"))).toEqual([]);
            expect(() => approve(approval, "BURN")).toThrow(
              expect.objectContaining({ code: "INVALID", messageKey: "approval.confirmMismatch" }),
            );
            expect(
              service.get(session.id).snapshot.approvals.find((a) => a.approvalId === approval.approvalId)
                ?.decision,
            ).toBeNull();
            expect(hash(await readFile(join(bench, "efuses.bin")))).toBe(beforeHash);
            expect(starts.slice(offset).filter((s) => s.args.includes("burn-efuse"))).toEqual([]);
            receipts.push({
              mode,
              beforeHash,
              wrongWord: "BURN",
              pending: approval,
              noBurnSpawnBeforeApproval: true,
            });
            approve(approval, "burn-efuse");
            if (mode === "ask") {
              const readback = await pending();
              expect(readback.program?.args).toEqual(summary);
              approve(readback);
            }
          }
          expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
          if (beforeHash !== undefined)
            expect(hash(await readFile(join(bench, "efuses.bin")))).not.toBe(beforeHash);
          const done = events.filter((e) => e.type === "tool.done");
          const approvals = database.db
            .prepare("SELECT decided_by, decision FROM approvals ORDER BY rowid")
            .all();
          receipts.push({ mode, events, approvals, starts: starts.slice(offset) });
          if (mode === "read-only") {
            expect(done).toHaveLength(3);
            for (const result of done) expect(result.ok).toBe(false);
            expect(starts.slice(offset)).toEqual([]);
            expect(existsSync(join(bench, "efuses.bin"))).toBe(false);
          } else {
            expect(done).toHaveLength(mode === "bypass" ? 4 : 3);
            const parsed = done.map((event) => {
              expect(event.ok, event.summary).toBe(true);
              const result = JSON.parse(event.summary);
              expect(result.exitCode, event.summary).toBe(0);
              return result;
            });
            expect(parsed[0]).toMatchObject({
              risk: "device-read",
              output: expect.stringMatching(/JTAG_DISABLE[^\n]*False[^\n]*0b0/),
            });
            expect(parsed[1]).toMatchObject({
              risk: "irreversible",
              output: expect.stringContaining("Successful."),
            });
            expect(parsed[2]).toMatchObject({
              risk: "device-read",
              output: expect.stringMatching(/JTAG_DISABLE[^\n]*True[^\n]*0b1/),
            });
            expect(approvals).toEqual(
              Array.from({ length: 3 }, () => ({
                decided_by: mode === "ask" ? "user" : "mode",
                decision: "approved",
              })).map((a, i) => (mode === "auto-edit" && i === 1 ? { ...a, decided_by: "user" } : a)),
            );
            expect(service.get(session.id).snapshot.approvals.every((a) => a.decision)).toBe(true);
            if (mode === "bypass") {
              expect(events.filter((e) => e.type === "approval.decided").every((e) => e.by === "mode")).toBe(
                true,
              );
              expect(await readFile(join(bench, "key.bin"))).toHaveLength(32);
            }
            const launchedBurns = starts.slice(offset).filter((s) => s.args.includes("burn-efuse"));
            expect(launchedBurns).toHaveLength(1);
            expect(launchedBurns[0]?.args).toContain("--virt");
            completed.push({ mode, parsed, virtualSha256: hash(await readFile(join(bench, "efuses.bin"))) });
          }
        } finally {
          await service.close();
          database.close();
        }
      }
      passed = true;
    } finally {
      await runner.stopAll();
      provisioner?.close();
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(
          join(evidence, "efuse-receipts.json"),
          JSON.stringify(
            {
              platform: process.platform,
              arch: process.arch,
              node: process.version,
              uv,
              root,
              passed,
              receipts,
              completed,
              starts,
            },
            null,
            2,
          ),
        );
      }
      // Failure diagnostics survive; successful owned test trees can be cleaned by the coordinator.
      if (passed && !evidence) await rm(root, { recursive: true, force: true });
    }
  },
  300_000,
);
