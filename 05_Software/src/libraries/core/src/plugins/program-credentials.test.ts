// The host credential hand-off of run_program (spec REQ-DATA-96d18686 section 1).
// REQ-SEC-3f57f781 REQ-SEC-dbbd21e5 REQ-SEC-9976af2e REQ-FUNC-00c788bb
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginManifestSchema, veraError } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestSha256 } from "../agent/approvals.js";
import type { ToolContext } from "../tools/context.js";
import { FakeHost } from "./fake-process-host.test-support.js";
import type { ProgramChangeRequest } from "./program-request.js";
import {
  type ProgramCredentials,
  type ProgramHost,
  ProgramSession,
  runProgramTool,
} from "./program-tools.js";
import { ProgramRunner } from "./runner.js";
import type { LoadedPlugin } from "./store.js";

const PASSWORD = "s3cret-Passw0rd!";
function mqttPlugin(
  tier: "official" | "local" | "community" = "official",
  scope: "mqtt" | "wokwi" = "mqtt",
): LoadedPlugin {
  return {
    folder: "/plugins/mqtt-tools",
    manifest: pluginManifestSchema.parse({
      format: 1,
      id: "mqtt-tools",
      version: "1.0.0",
      name: "MQTT tools",
      summary: "Fixture summary.",
      description: "Fixture.",
      ecosystem: "iot",
      platforms: ["windows-x64", "linux-x64"],
      programs: {
        "mqtt-tool": {
          install: { pip: "mqtt-tool" },
          version: { args: ["--version"], match: "(\\d+)" },
          credentials: { option: "--credential", scope },
        },
      },
      rules: [{ match: "mqtt-tool *", risk: "device-read" }],
    }),
    record: {
      format: 1,
      id: "mqtt-tools",
      version: "1.0.0",
      tier,
      source: { kind: "folder", path: "/src/mqtt-tools" },
      sha256: "c".repeat(64),
      installedAt: "2026-11-14T00:00:00.000Z",
      programs: {},
    },
  };
}

let root = "";
let host: FakeHost;
let runner: ProgramRunner;
let plugins: LoadedPlugin[];
let stored: Map<string, { username?: string; password: string }>;
let reads: string[];
let credentials: ProgramCredentials | undefined;
let approved: ProgramChangeRequest | undefined;
let ctx: ToolContext;
const signal = () => new AbortController().signal;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-program-credentials-")));
  await mkdir(join(root, ".vera"));
  host = new FakeHost();
  runner = new ProgramRunner({ host, clock: { sleep: async () => {} } });
  plugins = [mqttPlugin()];
  stored = new Map([["bench", { username: "bench-user", password: PASSWORD }]]);
  reads = [];
  approved = undefined;
  credentials = {
    has: async (scope, ref) =>
      stored.has(ref) && scope === (plugins[0]?.manifest.programs["mqtt-tool"]?.credentials?.scope ?? "mqtt"),
    read: async (scope, ref) => {
      reads.push(`${scope}:${ref}`);
      return stored.get(ref);
    },
  };
  const programHost = (): ProgramHost => ({
    runner,
    clock: { sleep: async () => {} },
    plugins: async () => plugins,
    resolver: { resolve: async () => ({ executable: "/usr/bin/mqtt-tool" }) },
    ...(credentials ? { credentials } : {}),
  });
  ctx = {
    root,
    lastReads: new Map(),
    permissionMode: () => "ask",
    get programs() {
      return {
        host: programHost(),
        session: new ProgramSession(),
        sessionId: "ses_1",
        turnId: "turn_1",
        callId: "call_1",
        consume: (request: ProgramChangeRequest) => {
          if (approved && requestSha256(request) !== requestSha256(approved)) throw veraError("CONFLICT");
        },
      };
    },
  } as ToolContext;
});
afterEach(async () => {
  await runner.stopAll();
  await rm(root, { recursive: true, force: true });
});

async function prepare(args: string[]) {
  const prepared = await runProgramTool.prepare?.(ctx, { program: "mqtt-tool", args }, signal());
  if (!prepared) throw Error("run_program must prepare.");
  approved = prepared.request as ProgramChangeRequest;
  return prepared;
}

describe("credential hand-off (REQ-SEC-3f57f781)", () => {
  it("writes the stored credential as one stdin line and nowhere else", async () => {
    const prepared = await prepare(["subscribe", "--credential", "bench", "--topic", "vera-test/a"]);
    expect(reads).toEqual([]);
    const result = prepared.apply(signal());
    await vi.waitFor(() => expect(host.programs).toHaveLength(1));
    const process = host.programs[0] as NonNullable<(typeof host.programs)[number]>;
    expect(reads).toEqual(["mqtt:bench"]);
    expect(JSON.parse(String(process.options.input))).toEqual({
      format: 1,
      scope: "mqtt",
      ref: "bench",
      username: "bench-user",
      password: PASSWORD,
    });
    expect(String(process.options.input).endsWith("\n")).toBe(true);
    expect(process.args.join(" ")).not.toContain(PASSWORD);
    expect(JSON.stringify(process.options.env)).not.toContain(PASSWORD);
    process.print("connected\n");
    process.finish({ code: 0, signal: null });
    const { log } = (await result) as { log: string };
    expect(await readFile(join(root, log), "utf8")).not.toContain(PASSWORD);
    expect(await readFile(join(root, log.replace(/\.log$/, ".json")), "utf8")).not.toContain(PASSWORD);
  });
  it("omits the username when none is stored", async () => {
    stored.set("anon-pass", { password: PASSWORD });
    const prepared = await prepare(["connect-test", "--credential", "anon-pass"]);
    const result = prepared.apply(signal());
    await vi.waitFor(() => expect(host.programs).toHaveLength(1));
    const process = host.programs[0] as NonNullable<(typeof host.programs)[number]>;
    expect(JSON.parse(String(process.options.input))).not.toHaveProperty("username");
    process.finish({ code: 0, signal: null });
    await result;
  });
  it("starts a call without the option with stdin closed and reads nothing", async () => {
    const prepared = await prepare(["check-profile", "--profile", "p.json"]);
    const result = prepared.apply(signal());
    await vi.waitFor(() => expect(host.programs).toHaveLength(1));
    const process = host.programs[0] as NonNullable<(typeof host.programs)[number]>;
    expect(process.options.input).toBeUndefined();
    expect(reads).toEqual([]);
    process.finish({ code: 0, signal: null });
    await result;
  });
});

describe("SSH agent socket (REQ-SEC-adb91424)", () => {
  const withAgent = (tier: "official" | "local") => {
    const plugin = mqttPlugin(tier);
    const declared = plugin.manifest.programs["mqtt-tool"] as NonNullable<
      (typeof plugin.manifest.programs)[string]
    >;
    const { credentials: _credentials, ...rest } = declared;
    return {
      ...plugin,
      manifest: { ...plugin.manifest, programs: { "mqtt-tool": { ...rest, sshAgent: true as const } } },
    };
  };
  it("gives an official program declaring sshAgent the host's SSH_AUTH_SOCK, and no other program", async () => {
    host = new FakeHost("linux", { PATH: "/usr/bin", SSH_AUTH_SOCK: "/run/user/1000/ssh-agent.sock" });
    runner = new ProgramRunner({ host, clock: { sleep: async () => {} } });
    plugins = [withAgent("official")];
    const result = (await prepare(["identify", "--board", "pi"])).apply(signal());
    await vi.waitFor(() => expect(host.programs).toHaveLength(1));
    expect(host.programs[0]?.options.env?.SSH_AUTH_SOCK).toBe("/run/user/1000/ssh-agent.sock");
    host.programs[0]?.finish({ code: 0, signal: null });
    await result;
    plugins = [mqttPlugin()];
    const other = (await prepare(["check-profile"])).apply(signal());
    await vi.waitFor(() => expect(host.programs).toHaveLength(2));
    expect(host.programs[1]?.options.env).not.toHaveProperty("SSH_AUTH_SOCK");
    host.programs[1]?.finish({ code: 0, signal: null });
    await other;
  });
  it("refuses a non-official plugin declaring sshAgent before approval", async () => {
    plugins = [withAgent("local")];
    await expect(prepare(["identify"])).rejects.toThrow(/SSH agent.*official/);
  });
});

describe("official plugins only (REQ-SEC-dbbd21e5)", () => {
  it.each(["local", "community"] as const)(
    "refuses a %s plugin's credential call before approval",
    async (tier) => {
      plugins = [mqttPlugin(tier)];
      await expect(prepare(["subscribe", "--credential", "bench"])).rejects.toThrow(/official/);
      await expect(prepare(["subscribe", "--credential=bench"])).rejects.toThrow(/official/);
      expect(reads).toEqual([]);
    },
  );
  it("still runs a call of that plugin that names no credential, with stdin closed", async () => {
    plugins = [mqttPlugin("local")];
    const prepared = await prepare(["check-profile", "--profile", "p.json"]);
    const result = prepared.apply(signal());
    await vi.waitFor(() => expect(host.programs).toHaveLength(1));
    const process = host.programs[0] as NonNullable<(typeof host.programs)[number]>;
    expect(process.options.input).toBeUndefined();
    process.finish({ code: 0, signal: null });
    await result;
    expect(reads).toEqual([]);
  });
});

describe("revocation by disabling the plugin (REQ-SEC-9976af2e)", () => {
  it("refuses an approved run once the plugin is disabled, without reading or spawning", async () => {
    const prepared = await prepare(["subscribe", "--credential", "bench"]);
    plugins = [];
    await expect(prepared.apply(signal())).rejects.toThrow(/not declared by an enabled plugin/);
    expect(reads).toEqual([]);
    expect(host.programs).toHaveLength(0);
  });
});

describe("unresolvable references (REQ-FUNC-00c788bb)", () => {
  it.each([
    [["subscribe", "--credential", "bench", "--credential", "bench"], /once/],
    [["subscribe", "--credential", "Bad_Ref"], /reference/],
    [["subscribe", "--credential"], /reference/],
    [["subscribe", "--credential", "missing"], /missing.*not stored|not stored.*missing/],
  ])("refuses %j at prepare", async (args, message) => {
    await expect(prepare(args)).rejects.toThrow(message);
    expect(reads).toEqual([]);
  });
  it("refuses when the host has no credential port", async () => {
    credentials = undefined;
    await expect(prepare(["subscribe", "--credential", "bench"])).rejects.toThrow(/credentials/i);
  });
  it("refuses at apply when the credential was removed after approval", async () => {
    const prepared = await prepare(["subscribe", "--credential", "bench"]);
    stored.delete("bench");
    await expect(prepared.apply(signal())).rejects.toThrow(/bench/);
    expect(host.programs).toHaveLength(0);
  });
});

describe("the wokwi scope (REQ-SEC-3f57f781)", () => {
  it("hands a stored Wokwi token over as a wokwi line without a username", async () => {
    plugins = [mqttPlugin("official", "wokwi")];
    stored.set("ci", { password: PASSWORD });
    const prepared = await prepare(["run-scenario", "--credential", "ci"]);
    const result = prepared.apply(signal());
    await vi.waitFor(() => expect(host.programs).toHaveLength(1));
    const process = host.programs[0] as NonNullable<(typeof host.programs)[number]>;
    expect(reads).toEqual(["wokwi:ci"]);
    expect(JSON.parse(String(process.options.input))).toEqual({
      format: 1,
      scope: "wokwi",
      ref: "ci",
      password: PASSWORD,
    });
    expect(process.args.join(" ")).not.toContain(PASSWORD);
    process.finish({ code: 0, signal: null });
    await result;
  });
  it("names the Wokwi settings and CLI variable when the token is not stored", async () => {
    plugins = [mqttPlugin("official", "wokwi")];
    await expect(prepare(["run-scenario", "--credential", "bench-2"])).rejects.toThrow(
      /Settings > Wokwi tokens.*VERA_WOKWI_TOKEN_BENCH_2/,
    );
  });
});
