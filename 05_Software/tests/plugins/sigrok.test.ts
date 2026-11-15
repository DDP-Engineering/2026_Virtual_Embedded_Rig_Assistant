import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = new URL("sigrok/", plugins);
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));
const program = "sigrok-cli";

it("publishes a valid official pack and five workflow skills", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m.platforms).toEqual(["windows-x64", "linux-x64", "linux-arm64"]);
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("sigrok");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs).toContainEqual(
    expect.objectContaining({
      id: "general",
      groups: expect.arrayContaining([expect.objectContaining({ plugins: ["sigrok"] })]),
    }),
  );
  for (const skill of [
    "sigrok-capture",
    "sigrok-decode",
    "sigrok-instruments",
    "hantek-dso3062l",
    "atk-dl16",
  ])
    expect(await readFile(new URL(`skills/${skill}/SKILL.md`, source), "utf8")).toContain(`name: ${skill}\n`);
});

it("uses actual option roles and keeps output changes at the highest risk", async () => {
  const m = await manifest();
  const syntax = m.programs[program]?.optionSyntax;
  const classify = (args: string[]) => classifyCommand(m.rules, program, args, syntax);
  const cases = [
    ["safe", ["-V"]],
    ["safe", ["-L"]],
    ["safe", ["-h"]],
    ["safe", ["-LV"]],
    ["safe", ["--input-file=trace.sr", "-P", "uart:rx=D0"]],
    ["safe", ["-i", "trace.sr", "-P", "i2c:scl=D1:sda=D2"]],
    ["device-read", ["--scan"]],
    ["device-read", ["--list-serial"]],
    ["device-read", ["--driver=hantek-dso3062l", "--show"]],
    ["device-read", ["--get=voltage", "--driver=korad-kaxxxxp:conn=COM3"]],
    ["device-read", ["--get=-i", "--driver=korad-kaxxxxp:conn=COM3"]],
    ["device-read", ["--samples=100", "-wd", "atk-dl16", "-c", "samplerate=10m"]],
    ["device-read", ["-i", "file.sr", "--driver=atk-dl16", "--samples=100"]],
    ["device-read", ["-d", "atk-dl16", "--time", "100"]],
    ["device-read", ["-d", "hantek-dso3062l", "--frames", "1"]],
    ["device-read", ["--continuous", "-d", "atk-dl16"]],
    ["device-write", ["-d", "hantek-dso3062l", "--set", "-c", "vdiv=1/1"]],
    ["device-write", ["-i", "file.sr", "-d", "hantek-dso3062l", "--set"]],
    ["device-write", ["--driver=rdtech-um", "--set"]],
    ["device-write", ["--get=voltage", "-c", "vdiv=1/1", "-d", "hantek-dso3062l"]],
    ["device-write", ["--unknown"]],
    ["irreversible", ["--set", "--driver=korad-kaxxxxp:conn=COM3", "--config=enabled=yes"]],
    ["irreversible", ["--driver=demo:sigrok_key=korad-kaxxxxp:conn=COM3", "--set", "-c", "enabled=yes"]],
    ["irreversible", ["-d", "rigol-dg", "--samples=100", "-c", "enabled=yes"]],
    ["irreversible", ["--driver=rdtech-rd", "--samples=100", "--config=enabled=yes"]],
    ["irreversible", ["--get=voltage", "-c", "enabled=yes", "-d", "korad-kaxxxxp:conn=COM3"]],
    ["irreversible", ["--set", "-c", "enabled=yes"]],
    ["irreversible", ["--continuous", "-c", "enabled=yes", "-i", "file.sr"]],
    ["irreversible", ["--config=channel_group=PWM1:enabled=yes", "--driver=atk-dl16", "--set"]],
    ["irreversible", ["-d", "atk-dl16", "-g", "PWM0", "--set", "-c", "output_frequency=1000"]],
    ["irreversible", ["-d", "atk-dl16", "--config=sigrok_key=PWM0:enabled=yes", "--samples", "100"]],
    ["irreversible", ["-d", "kingst-la2016", "-g", "PWM2", "--set", "-c", "enabled=yes"]],
    ["irreversible", ["-d", "atk-dl16", "--config=:samplerate=10m:pwm_enabled=yes", "--samples", "10"]],
  ] as const;
  for (const [risk, args] of cases) expect(classify([...args]).risk, args.join(" ")).toBe(risk);
  for (const driver of [
    "scpi-pps",
    "korad-kaxxxxp",
    "rdtech-dps",
    "rdtech-rd",
    "manson-hcs-3xxx",
    "gwinstek-gpd",
    "gwinstek-psp",
    "atten-pps3203",
    "motech-lps-301",
    "itech-it8500",
    "maynuo-m97",
    "siglent-sdl10x0",
    "arachnid-labs-re-load-pro",
    "zketech-ebc",
    "rigol-dg",
    "juntek-jds6600",
    "icstation-usbrelay",
    "dcttech-usbrelay",
    "devantech-eth008",
    "hpib-pps",
    "hp-59306a",
    "atorch",
    "conrad-digi-35-cpu",
    "rohde-schwarz-sme-03",
  ]) {
    for (const args of [
      ["--set", `--driver=${driver}:conn=COM3`],
      ["-d", driver, "--set"],
    ]) {
      expect(classify(args), args.join(" ")).toMatchObject({ risk: "irreversible", confirm: "--driver" });
    }
  }
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
const archives = process.env.VERA_SIGROK_ARCHIVES;
const windows = process.platform === "win32";
const platform = windows ? "windows-x64" : "linux-x64";

async function saveEvidence(name: string, data: unknown) {
  if (evidence) await writeFile(join(evidence, `${platform}-${name}.json`), JSON.stringify(data, null, 2));
}

it("discovers a local CLI without adding the managed AppImage arguments", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-sigrok-find-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("sigrok");
    const executable = join(root, windows ? "sigrok-cli.exe" : "sigrok-cli");
    await writeFile(executable, "fixture", { mode: 0o755 });
    const calls: (readonly string[])[] = [];
    const provisioner = new core.Provisioner({
      store,
      root: join(root, "runtime"),
      platform,
      host: {
        platform: process.platform,
        env: { PATH: root },
        spawn(_exe, args, options) {
          calls.push(args);
          options.output("stdout", Buffer.from("sigrok-cli 0.7.2\n"));
          return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
        },
        signal: () => true,
      },
      clock: { sleep },
      settings: () => undefined,
      fetch: async () => {
        throw Error("unexpected download");
      },
    });
    try {
      const resolved = await provisioner.resolve(plugin, program);
      expect(resolved?.executable).toBeDefined();
      expect(resolved?.prefix).toBeUndefined();
      expect(resolved?.version).toBe("0.7.2");
      expect(calls).toEqual([["--version"]]);
      expect(await provisioner.statuses("sigrok")).toMatchObject([
        { state: "ready", downloadAvailable: true },
      ]);
      const skills = new core.SkillCatalog({
        root,
        disabled: () => [],
        plugins: async () => [{ id: "sigrok", folder: plugin.folder }],
      });
      const names = (await skills.list())
        .filter((skill) => skill.plugin === "sigrok")
        .map((skill) => skill.name);
      expect(names).toEqual([
        "atk-dl16",
        "hantek-dso3062l",
        "sigrok-capture",
        "sigrok-decode",
        "sigrok-instruments",
      ]);
      for (const name of names)
        expect((await skills.read("plugin", name)).content.length).toBeGreaterThan(500);
    } finally {
      provisioner.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("waits in Ask for the exact typed confirmation before starting the simulated supply command", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-sigrok-ask-")));
  try {
    await mkdir(join(root, ".vera"));
    await mkdir(join(root, "scripts"));
    const args = ["--set", "--config=enabled=yes", "--driver=korad-kaxxxxp:conn=COM3"];
    await writeFile(
      join(root, "scripts/ask.jsonl"),
      [
        { toolCalls: [{ name: "run_program", args: { program, args } }] },
        { text: "Simulated setting finished" },
      ]
        .map((step) => JSON.stringify(step))
        .join("\n"),
    );
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("sigrok");
    const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
    await gateway.models("replay", new AbortController().signal);
    const db = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
    const starts: { executable: string; args: readonly string[] }[] = [];
    const host: core.ProcessHost = {
      platform: process.platform,
      env: {},
      spawn(executable, argv, options) {
        starts.push({ executable, args: [...argv] });
        options.output("stdout", Buffer.from("SIMULATED supply output enabled\n"));
        return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
      },
      signal: () => true,
    };
    const runner = new core.ProgramRunner({ host, clock: { sleep } });
    const service = new core.SessionService({
      root,
      db: db.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => "replay/ask",
      prompt: () => "Simulated supply",
      programs: {
        runner,
        clock: { sleep },
        plugins: async () => [plugin],
        resolver: { resolve: async () => ({ executable: "simulated-sigrok-cli" }) },
      },
    });
    try {
      await service.waitReady();
      const session = service.create(null, "ask");
      service.send(session.id, "Set the fixture supply output");
      const pending = () => service.get(session.id).snapshot.approvals.find((item) => !item.decision);
      await expect.poll(pending).toBeDefined();
      const approval = pending();
      if (!approval) throw Error("Missing approval");
      expect(approval.program).toMatchObject({ risk: "irreversible", confirm: "--driver", args });
      const decision = {
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved" as const,
      };
      expect(() => service.decideApproval(decision)).toThrow();
      expect(() => service.decideApproval({ ...decision, confirmation: "incorrect" })).toThrow();
      expect(pending()).toBeDefined();
      expect(starts).toEqual([]);
      service.decideApproval({ ...decision, confirmation: "--driver" });
      expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
      expect(starts).toEqual([{ executable: "simulated-sigrok-cli", args }]);
      await saveEvidence("ask", { approval: approval.program, starts });
    } finally {
      await service.close();
      await runner.stopAll();
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** 1 MHz samplerate. D0 is UART RX, D1/D2 are I2C SCL/SDA. */
function samples() {
  const uart: number[] = [];
  const i2c: number[] = [];
  const bits = (value: number, lsb: boolean) =>
    Array.from({ length: 8 }, (_, i) => (value >> (lsb ? i : 7 - i)) & 1);
  uart.push(...Array<number>(20).fill(1));
  for (const bit of [0, ...bits(0x56, true), 1]) uart.push(...Array<number>(10).fill(bit));

  const bus = (scl: number, sda: number) => i2c.push(...Array<number>(5).fill((scl << 1) | (sda << 2)));
  bus(1, 1);
  bus(1, 0);
  for (const bit of [...bits(0xa0, false), 0, ...bits(0xa5, false), 0]) {
    bus(0, bit);
    bus(1, bit);
  }
  bus(0, 0);
  bus(1, 0);
  bus(1, 1);
  return Buffer.from(Array.from({ length: 256 }, (_, i) => (uart[i] ?? 1) | (i2c[i] ?? 6)));
}

it.skipIf(!archives)(
  "provisions the exact fork and decodes UART and I2C from srzip without hardware",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-sigrok-native-")));
    try {
      const bench = join(root, "bench");
      await mkdir(join(bench, ".vera"), { recursive: true });
      await mkdir(join(bench, "captures"));
      await writeFile(join(bench, "samples.bin"), samples());
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(fileURLToPath(source));
      const native = new core.NodeProcessHost(spawn);
      const fallback = join(root, windows ? "sigrok-cli.exe" : "sigrok-cli");
      await writeFile(fallback, "simulated upstream", { mode: 0o755 });
      const host: core.ProcessHost = {
        platform: native.platform,
        env: { ...native.env, PATH: [root, native.env.PATH].filter(Boolean).join(delimiter) },
        spawn(executable, args, options) {
          if (executable !== fallback) return native.spawn(executable, args, options);
          options.output("stdout", Buffer.from("sigrok-cli 0.7.2\n"));
          return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
        },
        signal: native.signal.bind(native),
      };
      const requests: string[] = [];
      const provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        host,
        clock: { sleep },
        platform,
        settings: () => undefined,
        fetch: async (url) => {
          requests.push(url);
          return new Response(
            Readable.toWeb(
              createReadStream(join(archives as string, basename(new URL(url).pathname))),
            ) as ReadableStream<Uint8Array>,
          );
        },
      });
      const runner = new core.ProgramRunner({ host: native, clock: { sleep } });
      try {
        const m = await manifest();
        const install = m.programs[program]?.install;
        if (!install || !("download" in install) || !install.download) throw Error("Missing download");
        expect(await provisioner.resolve(await store.load("sigrok"), program)).toMatchObject({
          executable: fallback,
          version: "0.7.2",
        });
        expect(requests).toEqual([]);
        expect(await provisioner.install("sigrok")).toMatchObject([{ state: "ready", version: "0.8.0" }]);
        expect(requests).toEqual([install.download[platform]?.url]);
        const resolved = await provisioner.resolve(await store.load("sigrok"), program);
        if (!resolved) throw Error("CLI was not provisioned");
        expect(resolved.executable).not.toBe(fallback);
        expect(resolved.version).toBe("0.8.0");
        expect(resolved.prefix).toEqual(windows ? undefined : ["--appimage-extract-and-run", "--cli"]);
        const results: unknown[] = [];
        async function run(args: string[]) {
          const result = await (
            await runner.start({
              sessionId: "native",
              workbench: bench,
              executable: resolved?.executable as string,
              args: [...(resolved?.prefix ?? []), ...args],
              timeoutMs: 15_000,
            })
          ).done;
          const output = result.truncated ? await readFile(join(bench, result.log), "utf8") : result.output;
          results.push({ args, ...result, output });
          expect(result.exitCode, result.output).toBe(0);
          return output;
        }
        expect(await run(["-V"])).toContain("sigrok-cli 0.8.0");
        expect(await run(["-h"])).toContain("--list-serial");
        const supported = await run(["-L"]);
        for (const capability of [
          "atk-dl16",
          "hantek-dso3062l",
          "uart",
          "i2c",
          "ethernet",
          "arp",
          "ipv4",
          "udp",
        ])
          expect(supported).toMatch(new RegExp(`^  ${capability}\\s`, "m"));
        await run([
          "-i",
          "samples.bin",
          "-I",
          "binary:numchannels=3:samplerate=1000000",
          "-O",
          "srzip",
          "-o",
          "captures/fixture.sr",
        ]);
        expect((await readFile(join(bench, "captures/fixture.sr"))).subarray(0, 2).toString()).toBe("PK");
        const uart = await run([
          "-i",
          "captures/fixture.sr",
          "-P",
          "uart:rx=0:baudrate=100000",
          "-A",
          "uart=rx-data",
        ]);
        expect(uart).toMatch(/uart.*56/i);
        const i2c = await run([
          "-i",
          "captures/fixture.sr",
          "-P",
          "i2c:scl=1:sda=2",
          "-A",
          "i2c=address-write:data-write",
        ]);
        expect(i2c).toMatch(/i2c.*50/i);
        expect(i2c).toMatch(/i2c.*A5/i);
        await run(["--driver=demo", "--samples=100", "-O", "srzip", "-o", "captures/demo.sr"]);
        expect((await readFile(join(bench, "captures/demo.sr"))).subarray(0, 2).toString()).toBe("PK");
        await saveEvidence("provision-decode", { requests, resolved, results });
      } finally {
        provisioner.close();
        await runner.stopAll();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
