import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  captureLimits,
  captureReferenceSchema,
  classifyCommand,
  type PluginManifest,
  validatePluginManifest,
} from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { reportSkip } from "../support/skip-marker.js";

const plugins = new URL("../../plugins/", import.meta.url);
const source = new URL("wireshark-tshark/", plugins);
const sample = fileURLToPath(new URL("../fixtures/wireshark-tshark/sample.pcapng", import.meta.url));
const trafficSample = fileURLToPath(new URL("../fixtures/wireshark-tshark/traffic.pcapng", import.meta.url));
const untimedSample = fileURLToPath(new URL("../fixtures/wireshark-tshark/untimed.pcapng", import.meta.url));
const automotiveSample = new URL("../fixtures/wireshark-tshark/automotive.pcapng", import.meta.url);
const automotiveCoverageSample = new URL(
  "../fixtures/wireshark-tshark/automotive-coverage.pcapng",
  import.meta.url,
);
const automotiveMixedVlanSample = new URL(
  "../fixtures/wireshark-tshark/automotive-mixed-vlan.pcapng",
  import.meta.url,
);

it("projects offline Automotive Ethernet PDUs, transport context, and coverage", async (ctx) => {
  const source = { path: "captures/automotive.pcapng" };
  const coverageSource = { path: "captures/automotive-coverage.pcapng" };
  const mixedSource = { path: "captures/automotive-mixed-vlan.pcapng" };
  const someip = { transport: "udp", port: 30501, protocol: "someip" };
  const rig = await workbench({
    automotive: [
      typed("automotive", { source, automotiveProfile: "doip" }),
      typed("automotive", { source, automotiveProfile: "someip", decodeAs: [someip] }),
      typed("automotive", { source, automotiveProfile: "someip_sd" }),
      typed("automotive", {
        source,
        automotiveProfile: "doip",
        vlan: 7,
        addresses: ["192.168.7.10"],
        ports: [13400],
        expectedPoints: [
          { section: 1, interfaceId: 1 },
          { section: 1, interfaceId: 7 },
        ],
      }),
      typed("automotive", { source, automotiveProfile: "doip", scanFrames: 1 }),
      typed("automotive", { source, automotiveProfile: "doip", decodeAs: [someip] }),
      typed("automotive", { source, automotiveProfile: "doip", limit: 1 }),
      typed("automotive", {
        source: coverageSource,
        automotiveProfile: "doip",
        addresses: ["192.168.7.10"],
        ports: [13400],
      }),
      typed("automotive", { source: mixedSource, automotiveProfile: "doip" }),
      typed("automotive", { source: mixedSource, automotiveProfile: "doip", vlan: 42 }),
      typed("automotive", { source: mixedSource, automotiveProfile: "someip", vlan: 42, decodeAs: [someip] }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("Native TShark is unavailable.");
      return;
    }
    await writeFile(join(rig.bench, source.path), await readFile(automotiveSample));
    await writeFile(join(rig.bench, coverageSource.path), await readFile(automotiveCoverageSample));
    await writeFile(join(rig.bench, mixedSource.path), await readFile(automotiveMixedVlanSample));
    rig.resultBudget(32_000, (text) => text.replaceAll("192.168.7.10", "[masked]"));
    const service = await rig.start();
    const session = rig.session(service, "automotive", "bypass");
    service.send(session.id, "Analyze saved Automotive Ethernet evidence.");
    await service.waitIdle(session.id);
    expect(
      session.outputs.map(({ ok }) => ok),
      session.outputs
        .filter(({ ok }) => !ok)
        .map(({ summary }) => summary)
        .join("\n"),
    ).toEqual([true, true, true, true, true, false, true, true, true, true, true]);
    const [doip, tp, sd, vlan, prefix, invalid, page, tail, mixed, scopedMixed, scopedMixedTp] =
      session.outputs.map(({ summary }) => JSON.parse(summary));
    expect(mixed.automotive.rows).toMatchObject([
      { frames: [1, 2], pdu: { reassembly: { observationContext: "mixed" } } },
    ]);
    expect(scopedMixed.coverage).toMatchObject({
      scanComplete: true,
      partial: true,
      matchedInScope: 1,
      returned: 0,
    });
    expect(scopedMixed.automotive.scopeCoverage).toMatchObject({
      undecodedPayloadFrames: 1,
      issueFrames: { undecodedPayload: 1 },
    });
    expect(scopedMixedTp.coverage).toMatchObject({
      scanComplete: true,
      partial: true,
      matchedInScope: 1,
      returned: 1,
    });
    expect(scopedMixedTp.automotive.rows).toMatchObject([
      {
        frames: [3, 4],
        pdu: { reassembly: { someipTp: "fragment", completedIn: 4, observationContext: "mixed" } },
      },
    ]);
    expect(scopedMixedTp.automotive.scopeCoverage).toMatchObject({
      unverifiedReassemblyContextPdus: 1,
      issueFrames: { unverifiedReassemblyContext: 3 },
    });
    expect(tail.coverage).toMatchObject({
      scanComplete: true,
      partial: true,
      matchedInScope: 2,
      returned: 1,
    });
    expect(tail.automotive.scopeCoverage).toMatchObject({
      undecodedPayloadFrames: 1,
      unresolvedTransportFrames: 1,
      issueFrames: { undecodedPayload: 1, unresolvedTransport: 2 },
    });
    expect(tail.automotive.rows).toMatchObject([{ frames: [1], pdu: { fields: { "doip.type": 7 } } }]);
    expect(doip.analysis).toMatchObject({ tool: "tshark", automotiveProfile: "doip" });
    expect(doip.automotive.rows).toMatchObject([
      { frames: [1, 2], pdu: { occurrence: 1, fields: { "doip.type": 0x8001 }, payloadBytes: 15 } },
      { frames: [2], pdu: { occurrence: 2, fields: { "doip.type": 7 } } },
      { frames: [3], pdu: { occurrence: 1, fields: { "doip.diag_ack_code": 0 } } },
      { frames: [3], pdu: { occurrence: 2, fields: { "doip.diag_nack_code": 3 } } },
      { frames: [4], pdu: { occurrence: 1, fields: { "doip.type": 1 } } },
    ]);
    expect(
      doip.automotive.evidence.find(({ frame }: { frame: { number: number } }) => frame.number === 1),
    ).toMatchObject({
      frame: { interfaceId: 0, timestampEpoch: "1767225600.000000000" },
      direction: "inbound",
    });
    expect(doip.automotive.conversations[0]).toMatchObject({
      transport: "tcp",
      forward: { pdus: 2 },
      reverse: { pdus: 2 },
    });
    expect(doip.automotive.scopeCoverage).toMatchObject({
      unsupportedEncapsulationFrames: 1,
      truncatedFrames: 1,
      knownDrops: "2",
      framesWithoutTimestamp: 1,
      undecodedPayloadFrames: 2,
      issueFrames: { undecodedPayload: 5, truncated: 10, unsupportedEncapsulation: 11 },
    });
    expect(doip.coverage.partial).toBe(true);
    expect(tp.automotive.rows).toMatchObject([
      {
        frames: [6, 7],
        pdu: { reassembly: { someipTp: "fragment", completedIn: 7, observationContext: "same" } },
      },
      {
        frames: [6, 7],
        pdu: {
          reassembly: { someipTp: "reassembled", completedIn: 7 },
          payloadBytes: 20,
          fields: {
            "someip.serviceid": 0x1234,
            "someip.methodid": 2,
            "someip.clientid": 9,
            "someip.sessionid": 5,
            "someip.protoversion": 1,
            "someip.interfaceversion": 2,
          },
        },
      },
      { frames: [8], pdu: { reassembly: { someipTp: "fragment", completedIn: null } } },
    ]);
    expect(tp.automotive.scopeCoverage.unfinishedTpFragments).toBe(1);
    expect(sd.analysis.decodeAs).toMatchObject([{ transport: "udp", port: 30490, protocol: "someip" }]);
    expect(sd.automotive.rows).toMatchObject([
      {
        frames: [9],
        pdu: {
          entries: [
            { "someipsd.entry.serviceid": 0x1234, "someipsd.entry.ttl": 5 },
            { "someipsd.entry.serviceid": 0x1235, "someipsd.entry.ttl": 0 },
          ],
        },
      },
    ]);
    expect(vlan.automotive.rows).toMatchObject([{ frames: [4] }]);
    expect(vlan.automotive.evidence).toMatchObject([
      { frame: { number: 4, interfaceId: 1 }, vlans: [7, 42] },
    ]);
    expect(vlan.automotive.scopeCoverage.missingExpectedPoints).toEqual([{ section: 1, interfaceId: 7 }]);
    expect(prefix.coverage).toMatchObject({ scannedThrough: 1, scanComplete: false, partial: true });
    expect(prefix.automotive.scopeCoverage.undecodedPayloadFrames).toBe(1);
    expect(invalid.reason).toBe("invalid_decode_as");
    expect(page.automotive.page.next).toMatchObject({ offset: 1 });
    expect(page.coverage.partial).toBe(true);
    const modelPage = rig.modelResults
      .map((result) => JSON.parse(result))
      .find(({ automotive }) => automotive?.selection.vlan === 7);
    expect(modelPage.automotive.selection.addresses).toEqual(["[masked]"]);
    expect(modelPage.automotive.conversations[0].b.address).toBe("[masked]");
    expect(JSON.stringify(session.outputs)).not.toContain("VERA_DOIP_LOCAL");
    expect(
      rig.starts.filter((options) => options.includes("-r")).every((options) => options.includes("-n")),
    ).toBe(true);
    const cursor = page.automotive.page.next;
    const ref = page.automotive.rows[0].pdu.ref;
    await rig.writeReplay("next", [
      typed("automotive", { source, automotiveProfile: "doip", limit: 1, automotiveCursor: cursor }),
      typed("automotive", { source, automotiveProfile: "doip", limit: 1, vlan: 7, automotiveCursor: cursor }),
      { text: `The next PDU is in the same source frame [[${ref}]].` },
    ]);
    const next = rig.session(service, "next", "bypass");
    service.send(next.id, "Continue the page and cite the packet.");
    await service.waitIdle(next.id);
    const [continued, stale] = next.outputs.map(({ summary }) => JSON.parse(summary));
    expect(continued.automotive.rows).toMatchObject([{ frames: [2], pdu: { occurrence: 2, ref } }]);
    expect(stale.reason).toBe("cursor_mismatch");
    const assistant = service.get(next.id).snapshot.items.findLast((item) => item.kind === "assistant");
    expect(assistant).toMatchObject({ citations: [{ ref, valid: true }] });
    expect(service.openCaptureCitation(next.id, assistant?.id ?? "", ref).evidence).toMatchObject({
      frame: { number: 2, captureSha256: page.capture.sha256 },
      analysis: { automotiveProfile: "doip" },
    });
  } finally {
    await rig.close();
  }
}, 90_000);

it("reconciles offline Automotive Ethernet with the upstream SOME/IP samples", async (ctx) => {
  const folder = process.env.VERA_WIRESHARK_AUTOMOTIVE_SAMPLES;
  if (!folder) {
    ctx.skip("Set VERA_WIRESHARK_AUTOMOTIVE_SAMPLES to the upstream sample directory.");
    return;
  }
  const samples = [
    { name: "someip_sd_sample.pcap", profile: "someip_sd" },
    { name: "someip-udp-method-call.pcapng", profile: "someip", port: 49201 },
    { name: "someip-tp.pcap", profile: "someip", port: 18193 },
  ];
  const rig = await workbench({
    upstream: [
      ...samples.map(({ name, profile, port }) =>
        typed("automotive", {
          source: { path: `captures/${name}` },
          automotiveProfile: profile,
          ...(port ? { decodeAs: [{ transport: "udp", port, protocol: "someip" }] } : {}),
        }),
      ),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) throw Error("Native TShark is required for upstream sample reconciliation.");
    for (const { name } of samples)
      await writeFile(join(rig.bench, "captures", name), await readFile(join(folder, name)));
    const service = await rig.start();
    const session = rig.session(service, "upstream", "bypass");
    service.send(session.id, "Reconcile the published SOME/IP protocol samples.");
    await service.waitIdle(session.id);
    expect(
      session.outputs.map(({ ok }) => ok),
      JSON.stringify(session.outputs),
    ).toEqual([true, true, true]);
    const [sd, method, tp] = session.outputs.map(({ summary }) => JSON.parse(summary).automotive);
    expect(sd.rows).toHaveLength(6);
    expect(sd.rows[0]).toMatchObject({
      frames: [1],
      pdu: { entries: [{ "someipsd.entry.type": 1, "someipsd.entry.ttl": 30 }] },
    });
    expect(sd.evidence[0]).toMatchObject({ encapsulation: 97, frame: { interfaceId: null, number: 1 } });
    expect(method.rows).toMatchObject([
      {
        frames: [2],
        pdu: { fields: { "someip.serviceid": 0x1234, "someip.methodid": 8, "someip.messagetype": 0 } },
      },
      {
        frames: [3],
        pdu: { fields: { "someip.serviceid": 0x1234, "someip.methodid": 8, "someip.messagetype": 0x80 } },
      },
    ]);
    expect(tp.rows).toHaveLength(9);
    expect(tp.rows.at(-1)).toMatchObject({
      frames: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      pdu: { payloadBytes: 12292, reassembly: { someipTp: "reassembled", completedIn: 9 } },
    });
  } finally {
    await rig.close();
  }
}, 90_000);
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));
const hint =
  "Install Wireshark (Windows: includes TShark and offers Npcap) from https://www.wireshark.org/download.html, or your distribution's tshark package.";

it("publishes the official find-only tshark package, its pack and two skills", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "wireshark-tshark",
    ecosystem: "wireshark",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(m.programs.tshark?.install).toEqual({
    find: { windows: ["%PATH%", "%ProgramFiles%/Wireshark/tshark.exe"], linux: ["$PATH", "/usr/bin/tshark"] },
    hint,
  });
  expect(m.programs.tshark?.version).toEqual({
    args: ["--version"],
    match: "^TShark \\(Wireshark\\) (\\d+\\.\\d+\\.\\d+)",
  });
  expect(m.programs.tshark?.optionSyntax).toBe("tshark");
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("wireshark-tshark");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs).toContainEqual({
    id: "wireshark",
    name: "Wireshark",
    groups: [{ name: "Capture analysis", plugins: ["wireshark-tshark"], default: true }],
  });
});

it("classifies parsed tshark option roles at the highest risk", async () => {
  const m = await manifest();
  const classify = (args: string[]) =>
    classifyCommand(m.rules, "tshark", args, m.programs.tshark?.optionSyntax);
  const cases = [
    // Information-only commands exit before any capture.
    ["safe", ["--version"]],
    ["safe", ["-v"]],
    ["safe", ["-nv"]],
    ["safe", ["-h"]],
    ["safe", ["--help"]],
    ["safe", ["--vers"]],
    ["safe", ["-D"]],
    ["safe", ["-nD"]],
    ["safe", ["--list-interfaces"]],
    ["safe", ["--list-i"]],
    ["safe", ["--list-sources"]],
    ["safe", ["-G", "protocols"]],
    ["safe", ["-G"]],
    ["safe", ["-n", "-G", "protocols"]],
    ["safe", ["-nGfields"]],
    // Reading a capture file, with every output and processing option.
    ["safe", ["-r", "cap.pcapng"]],
    ["safe", ["-rcap.pcapng"]],
    ["safe", ["--read-file", "cap.pcapng"]],
    ["safe", ["--read-file=cap.pcapng"]],
    ["safe", ["-nr", "cap.pcapng", "-Y", "coap"]],
    ["safe", ["-r", "cap.pcapng", "-T", "fields", "-e", "frame.number", "-E", "header=y"]],
    ["safe", ["-r", "cap.pcapng", "-q", "-z", "io,phs"]],
    ["safe", ["-r", "cap.pcapng", "-x", "-V", "-O", "coap"]],
    ["safe", ["-r", "cap.pcapng", "--hexdump", "frames"]],
    ["safe", ["-r", "cap.pcapng", "-2", "-R", "udp", "-w", "-"]],
    ["safe", ["-r", "cap.pcapng", "-w-"]],
    ["safe", ["-r", "cap.pcapng", "-W", "n", "-U", "tap"]],
    ["safe", ["-r", "cap.pcapng", "-o", "tcp.check_checksum:TRUE", "-d", "udp.port==5684,coap"]],
    ["safe", ["-r", "cap.pcapng", "-X", "read_format:pcapng"]],
    ["safe", ["-r", "cap.pcapng", "--selected-frame", "3", "--print-timers"]],
    ["safe", ["-r", "cap.pcapng", "-Y", "-i"]],
    ["safe", ["-r", "cap.pcapng", "-e", "-I"]],
    ["safe", ["-r", "cap.pcapng", "coap"]],
    ["safe", ["-r", "cap.pcapng", "--", "-v"]],
    // Reading a capture file while writing a file or folder.
    ["device-read", ["-r", "cap.pcapng", "-2", "-R", "udp", "-w", "udp.pcapng"]],
    ["device-read", ["-r", "cap.pcapng", "-wudp.pcapng"]],
    ["device-read", ["-nw", "/tmp/udp.pcapng", "-r", "cap.pcapng"]],
    ["device-read", ["-r", "cap.pcapng", "--export-objects", "http,objects"]],
    ["device-read", ["-r", "cap.pcapng", "--export-o=http,objects"]],
    ["device-read", ["-r", "cap.pcapng", "--export-tls-session-keys", "keys.log"]],
    ["device-read", ["-r", "cap.pcapng", "--log-file=tshark.log"]],
    ["device-read", ["-r", "cap.pcapng", "coap", "-w", "udp.pcapng"]],
    ["device-read", ["-r", "cap.pcapng", "--", "--export-objects", "http,objects"]],
    ["device-read", ["-v", "-w", "udp.pcapng"]],
    // Live capture: an interface option, a link or timestamp type query, or no capture file at all.
    ["device-read", ["-i", "eth0"]],
    ["device-read", ["-ieth0"]],
    ["device-read", ["--interface", "eth0", "-c", "10"]],
    ["device-read", ["--interface=1", "-a", "duration:5", "-w", "live.pcapng"]],
    ["device-read", ["--inter=eth0"]],
    ["device-read", ["--source", "eth0"]],
    ["device-read", ["-ni", "eth0"]],
    ["device-read", ["-pI", "-i", "wlan0"]],
    ["device-read", ["-L", "-i", "eth0"]],
    ["device-read", ["--list-data-link-types"]],
    ["device-read", ["--list-time-stamp-types"]],
    ["device-read", ["--monitor-mode"]],
    ["device-read", ["-r", "cap.pcapng", "-i", "eth0"]],
    ["device-read", ["-c", "5"]],
    ["device-read", ["-Y", "coap"]],
    ["device-read", ["-n"]],
    ["device-read", []],
    ["device-read", ["udp", "port", "5683"]],
    ["device-read", ["foo", "-v"]],
    ["device-read", ["foo", "-r", "cap.pcapng"]],
    ["device-read", ["--", "-r", "cap.pcapng"]],
    ["device-read", ["-v", "-i", "eth0"]],
    ["device-read", ["-G", "protocols", "-i", "eth0"]],
    ["device-read", ["-r", "cap.pcapng", "coap", "-i", "eth0"]],
    ["device-read", ["-r", "cap.pcapng", "--", "--source=eth0"]],
    // Unrecognised or ambiguous options.
    ["device-write", ["-r", "cap.pcapng", "--log", "x"]],
    ["device-write", ["--read=cap.pcapng"]],
    ["device-write", ["-r", "cap.pcapng", "--no-such-option"]],
    ["device-write", ["-r", "cap.pcapng", "-k"]],
    ["device-write", ["-r", "cap.pcapng", "-Z", "user"]],
    // Lua scripts and command-line RPCAP credentials.
    ["blocked", ["-r", "cap.pcapng", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "-Xlua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "-X", "lua_script1:argument"]],
    ["blocked", ["-r", "cap.pcapng", "-Xlua_script1:argument"]],
    ["blocked", ["-nXlua_script1:argument", "-r", "cap.pcapng"]],
    ["blocked", ["-r", "cap.pcapng", "-X", "LUA_SCRIPT:dissector.lua"]],
    ["blocked", ["-nX", "lua_script:dissector.lua", "-r", "cap.pcapng"]],
    ["blocked", ["-v", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-G", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "coap", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-r", "cap.pcapng", "--", "-X", "lua_script:dissector.lua"]],
    ["blocked", ["-i", "rpcap://host/eth0", "-A", "user:secret"]],
    ["blocked", ["-Auser:secret", "-i", "rpcap://host/eth0"]],
    ["blocked", ["-r", "cap.pcapng", "coap", "-A", "user:secret"]],
  ] as const;
  for (const [risk, args] of cases) expect(classify([...args]).risk, args.join(" ")).toBe(risk);
  expect(classify(["-i", "eth0"]).notes.join(" ")).toContain("Npcap");
  const writes = m.rules.find((rule) => rule.match.includes("<write>"))?.note;
  expect(writes).toContain("--export-objects");
  expect(classify(["-r", "cap.pcapng", "-w", "udp.pcapng"]).notes).toContain(writes);
  expect(classify(["-i", "eth0", "-w", "live.pcapng"]).notes).toContain(writes);
  expect(classify(["-r", "cap.pcapng", "-Y", "-w"]).notes).not.toContain(writes);
  expect(classify(["-r", "cap.pcapng", "-X", "lua_script:x.lua"]).notes.join(" ")).toContain("Lua");
});

const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
const version = "TShark (Wireshark) 4.6.8 (v4.6.8-0-ge677bf052328).\n";

it("finds tshark on PATH or in the Wireshark folder and shows the hint when it is missing", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-tshark-find-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("wireshark-tshark");
    const onPath = join(root, "bin");
    const programFiles = join(root, "Program Files");
    await mkdir(onPath);
    await mkdir(join(programFiles, "Wireshark"), { recursive: true });
    const spawned: string[] = [];
    const provisioner = (system: "win32" | "linux", env: Record<string, string>) =>
      new core.Provisioner({
        store,
        root: join(root, "runtime"),
        platform: system === "win32" ? "windows-x64" : "linux-x64",
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("tshark must never download");
        },
        host: {
          platform: system,
          env,
          spawn(executable, _args, options) {
            spawned.push(executable);
            options.output("stdout", Buffer.from(version));
            return { pid: 1, exit: Promise.resolve({ code: 0, signal: null }) };
          },
          signal: () => true,
        },
      });
    const missing = provisioner("win32", { PATH: join(root, "empty"), ProgramFiles: join(root, "empty") });
    expect(await missing.statuses("wireshark-tshark")).toEqual([
      {
        name: "tshark",
        kind: "find",
        state: "missing",
        problem: "notFound",
        hint,
        link: "https://www.wireshark.org/download.html",
      },
    ]);
    expect(await missing.resolve(plugin, "tshark")).toBeUndefined();
    expect(spawned).toEqual([]);
    missing.close();

    const standard = join(programFiles, "Wireshark", "tshark.exe");
    await writeFile(standard, "fixture");
    const installed = provisioner("win32", { PATH: join(root, "empty"), ProgramFiles: programFiles });
    expect(await installed.resolve(plugin, "tshark")).toMatchObject({
      executable: standard,
      version: "4.6.8",
    });
    installed.close();

    const path = join(onPath, "tshark.exe");
    await writeFile(path, "fixture");
    const first = provisioner("win32", { PATH: onPath, ProgramFiles: programFiles });
    expect(await first.resolve(plugin, "tshark")).toMatchObject({ executable: path, version: "4.6.8" });
    first.close();

    // A Linux PATH splits on ':', which a Windows drive letter would break.
    if (!windows) {
      const linux = join(onPath, "tshark");
      await writeFile(linux, "fixture", { mode: 0o755 });
      const onLinux = provisioner("linux", { PATH: onPath });
      expect(await onLinux.resolve(plugin, "tshark")).toMatchObject({ executable: linux, version: "4.6.8" });
      onLinux.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const step = (args: readonly string[]) => ({
  toolCalls: [{ name: "run_program", args: { program: "tshark", args } }],
});
const script = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n");
const typed = (operation: string, args: Record<string, unknown> = {}) => ({
  toolCalls: [{ name: "wireshark_capture", args: { operation, ...args } }],
});
const importCapture = (path: string) => ({ toolCalls: [{ name: "wireshark_import", args: { path } }] });

it("offers the typed capture contract in the model tool registry", () => {
  const spec = new core.ToolRegistry().available().find(({ name }) => name === "wireshark_capture");
  expect(spec?.params.safeParse({ operation: "capabilities" }).success).toBe(true);
  expect(spec?.params.safeParse({ operation: "capabilities", argv: ["-i", "1"] }).success).toBe(false);
  expect(spec?.params.safeParse({ operation: "inspect" }).success).toBe(false);
  expect(
    spec?.params.safeParse({ operation: "inspect", source: { path: classicPath }, profile: "custom" })
      .success,
  ).toBe(false);
  expect(
    new core.ToolRegistry().specs().find(({ name }) => name === "wireshark_capture")?.parameters,
  ).toMatchObject({
    type: "object",
    properties: { operation: { type: "string" } },
  });
});

/**
 * A workbench with the catalog-installed plugin, its skills and the host's real tshark. The host keeps
 * PATH and ProgramFiles for discovery but isolates the personal Wireshark profile through HOME.
 */
async function workbench(
  scripts: Record<string, unknown[]>,
  state: "enabled" | "missing_binary" | "local" = "enabled",
  permissions?: core.PermissionEngine,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-tshark-replay-")));
  const bench = join(root, "bench");
  const home = join(root, "home");
  const personal = windows ? join(home, "AppData", "Wireshark") : join(home, ".config", "wireshark");
  const native = new core.NodeProcessHost(spawn);
  const starts: (readonly string[])[] = [];
  const configurations: string[] = [];
  const host: core.ProcessHost = {
    platform: native.platform,
    env: { ...native.env, HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData") },
    spawn(executable, args, options) {
      starts.push([...args]);
      configurations.push(options.env.WIRESHARK_CONFIG_DIR ?? "");
      return native.spawn(executable, args, options);
    },
    signal: native.signal.bind(native),
  };
  const runner = new core.ProgramRunner({ host, clock: { sleep } });
  const opened: {
    service?: core.SessionService;
    provisioner?: core.Provisioner;
    database?: Awaited<ReturnType<typeof core.openDb>>;
  } = {};
  const close = async () => {
    await opened.service?.close();
    await runner.stopAll();
    opened.provisioner?.close();
    opened.database?.close();
    await rm(root, { recursive: true, force: true });
  };
  await mkdir(join(bench, ".vera"), { recursive: true });
  await mkdir(join(bench, "captures"));
  await mkdir(home);
  await mkdir(personal, { recursive: true });
  await writeFile(join(bench, "captures/sample.pcapng"), await readFile(sample));
  await mkdir(join(root, "scripts"));
  const writeReplay = (name: string, items: unknown[]) =>
    writeFile(join(root, `scripts/${name}.jsonl`), script(items));
  for (const [name, items] of Object.entries(scripts)) await writeReplay(name, items);
  const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
  expect(release.issues).toEqual([]);
  expect(release.index?.plugins.find((item) => item.id === "wireshark-tshark")?.tier).toBe("official");
  const store = new core.PluginStore({ root: join(root, "plugins") });
  await store.install(
    join(root, `release/wireshark-tshark-${(await manifest()).version}.zip`),
    undefined,
    state === "local" ? undefined : { tier: "official", url: "https://fixture.invalid/wireshark.zip" },
  );
  const plugin = await store.load("wireshark-tshark");
  const skills = new core.SkillCatalog({
    root: bench,
    disabled: () => [],
    plugins: async () => [{ id: "wireshark-tshark", folder: plugin.folder }],
  });
  const provisioner = new core.Provisioner({
    store,
    host,
    root: join(root, "runtime"),
    platform: windows ? "windows-x64" : "linux-x64",
    clock: { sleep },
    settings: () => undefined,
    fetch: async () => {
      throw Error("tshark must never download");
    },
  });
  opened.provisioner = provisioner;
  const tshark = await provisioner.resolve(plugin, "tshark");
  let model = "";
  let resultChars = 32_000;
  let redact = (text: string) => text;
  const modelResults: string[] = [];
  const start = async () => {
    const gateway = new (class extends ReplayGateway {
      override async *stream(request: Parameters<ReplayGateway["stream"]>[0]) {
        for (const message of request.messages) {
          if (message.role === "toolResult" && message.toolName === "wireshark_capture")
            for (const item of message.content) if (item.type === "text") modelResults.push(item.text);
        }
        yield* super.stream(request);
      }
    })({ dir: join(root, "scripts"), now: Date.now, contextWindow: 131_072 });
    await gateway.models("replay", new AbortController().signal);
    opened.database = await core.openDb(join(bench, ".vera/vera.db"), {
      workbenchId: "wb_test",
      appVersion: "0",
    });
    opened.service = new core.SessionService({
      root: bench,
      db: opened.database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => model,
      maxToolCallsPerTurn: 50,
      advanced: { app: () => ({ toolResultChars: resultChars }), workbench: () => undefined },
      scrub: (text) => redact(text),
      ...(permissions && { permissions }),
      prompt: () => "Use the Wireshark plugin",
      skills,
      programs: {
        runner,
        clock: { sleep },
        plugins: async () => [plugin],
        resolver: state === "missing_binary" ? core.unresolvedPrograms : provisioner,
      },
      wiresharkPackage: state === "local" ? undefined : plugin.record.sha256,
    });
    await opened.service.waitReady();
    return opened.service;
  };
  const session = (service: core.SessionService, name: string, mode: "ask" | "bypass") => {
    model = `replay/${name}`;
    const created = service.create(null, mode);
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(created.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    const pending = () => service.get(created.id).snapshot.approvals.find((item) => !item.decision);
    return { id: created.id, outputs, pending };
  };
  return {
    bench,
    skills,
    tshark,
    starts,
    configurations,
    start,
    session,
    close,
    writeReplay,
    modelResults,
    resultBudget(limit: number, scrub: (text: string) => string) {
      resultChars = limit;
      redact = scrub;
    },
    async personalProfileControl() {
      if (!tshark) throw Error("TShark is required.");
      await writeFile(join(personal, "disabled_protos"), "coap\n");
      const { stdout } = await promisify(execFile)(
        tshark.executable,
        ["-n", "-r", sample, "-Y", "coap", "-T", "fields", "-e", "frame.number"],
        {
          env: { ...host.env, WIRESHARK_CONFIG_DIR: personal },
          timeout: 10_000,
          windowsHide: true,
        },
      );
      return stdout.trim();
    },
  };
}

const results = (outputs: { summary: string }[]) =>
  outputs.map((output) => JSON.parse(output.summary) as { exitCode: number; output: string });

const classicPath = "captures/independent.pcap";
const classicPcap = Buffer.from(
  "d4c3b2a1020004000000000000000000ffff000001000000" +
    "0100000020a107002e0000002e000000" +
    "0200000000020200000000010800450000200001000040110000c0000201c0000202bf3f1634000c000040010001",
  "hex",
);

it("gates typed capture capabilities on the official plugin independently of the executable", async () => {
  const hash = createHash("sha256").update(classicPcap).digest("hex");
  const reference = {
    format: 1,
    bytes: classicPcap.length,
    sha256: hash,
    fileFormat: "pcap",
    source: { kind: "managed" },
  };
  for (const state of ["missing_binary", "local"] as const) {
    const rig = await workbench(
      {
        test: [
          typed("capabilities"),
          typed("inspect", { source: { path: classicPath } }),
          typed("verify_reference", { source: { reference } }),
          importCapture(classicPath),
          { text: "Done." },
        ],
      },
      state,
      core.readPermissions,
    );
    try {
      await mkdir(join(rig.bench, ".vera/captures"));
      await writeFile(join(rig.bench, ".vera/captures", `${hash}.pcap`), classicPcap);
      const service = await rig.start();
      const session = rig.session(service, "test", "ask");
      const firstStart = rig.starts.length;
      service.send(session.id, "Check the offline capture capability.");
      await service.waitIdle(session.id);
      expect(rig.starts.length).toBe(firstStart);
      if (state === "local") {
        expect(session.outputs.every(({ ok }) => !ok)).toBe(true);
        expect(JSON.stringify(session.outputs)).not.toContain("managedStorage");
      } else {
        expect(JSON.parse(session.outputs[0]?.summary ?? "")).toMatchObject({
          tshark: { available: false },
          managedStorage: { readable: true, writable: true, importAvailable: false },
        });
        expect(JSON.parse(session.outputs[1]?.summary ?? "")).toMatchObject({ reason: "tshark_unavailable" });
        expect(JSON.parse(session.outputs[2]?.summary ?? "")).toEqual({ capture: reference, verified: true });
        expect(session.outputs[3]).toMatchObject({ ok: false, summary: "Tool permission denied." });
      }
    } finally {
      await rig.close();
    }
  }
}, 90_000);

it("replays typed Windows or Linux offline analysis with independent PCAP and PCAPNG evidence", async (ctx) => {
  const pcapng = { path: "captures/sample.pcapng" };
  const pcap = { path: classicPath };
  const decodeAs = [{ transport: "udp", port: 5684, protocol: "coap" }];
  const hash = createHash("sha256").update(classicPcap).digest("hex");
  const managed = {
    format: 1,
    bytes: classicPcap.length,
    sha256: hash,
    fileFormat: "pcap",
    source: { kind: "managed" },
  };
  const decodeFields = ["coap.code", "udp.dstport"];
  const rig = await workbench({
    test: [
      typed("capabilities"),
      typed("discover", { kind: "fields", search: "uri_path_recon" }),
      typed("discover", { kind: "protocols", search: "coap", limit: 2 }),
      typed("discover", { kind: "decoders", search: "coap" }),
      typed("validate_filter", { filter: "(" }),
      typed("validate_filter", { filter: "coap" }),
      typed("inspect", { source: pcapng }),
      typed("query", {
        source: pcapng,
        filter: "coap",
        fields: ["coap.opt.uri_path_recon"],
        scanFrames: 5,
        limit: 1,
      }),
      typed("frame", { source: pcap, frame: 1, fields: decodeFields, decodeAs }),
      typed("frame", { source: pcap, frame: 2 }),
      typed("query", { source: pcap, fields: ["udp.payload"] }),
      typed("query", { source: pcap, fields: decodeFields, cursor: { querySha256: hash, afterFrame: 1 } }),
      importCapture(classicPath),
      typed("frame", { source: { reference: managed }, frame: 1, fields: decodeFields, decodeAs }),
      typed("inspect", { source: { path: "captures/corrupt.pcap" } }),
      typed("inspect", { source: { path: "captures/huge.pcap" } }),
      typed("inspect", { source: { path: "../outside.pcap" } }),
      typed("inspect", { source: { reference: { ...managed, bytes: managed.bytes + 1 } } }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1")
        throw Error("Native TShark is required for this acceptance run.");
      ctx.skip("TShark unavailable for typed offline capture acceptance.");
      return;
    }
    expect(await rig.personalProfileControl()).toBe("");
    await writeFile(join(rig.bench, classicPath), classicPcap);
    await writeFile(join(rig.bench, "captures/corrupt.pcap"), classicPcap.subarray(0, 31));
    await writeFile(join(rig.bench, "captures/huge.pcap"), classicPcap);
    await truncate(join(rig.bench, "captures/huge.pcap"), captureLimits.captureBytes + 1);
    const service = await rig.start();
    const session = rig.session(service, "test", "ask");
    const firstStart = rig.starts.length;
    service.send(session.id, "Analyze the saved fixtures offline.");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const outputs = session.outputs.map(({ summary }) => JSON.parse(summary));
    expect(outputs).toHaveLength(18);
    expect(outputs[0]).toMatchObject({ tshark: { available: true }, profile: "vera-offline-v1" });
    expect(outputs[1].entries).toEqual([expect.objectContaining({ name: "coap.opt.uri_path_recon" })]);
    expect(outputs[2].entries).toContainEqual(expect.objectContaining({ name: "coap" }));
    expect(outputs[3].entries).toContainEqual(expect.objectContaining({ name: "coap", transport: "udp" }));
    expect(outputs[4]).toMatchObject({ isError: true, reason: "invalid_filter" });
    expect(outputs[5]).toMatchObject({ valid: true });
    const inspected = captureReferenceSchema.parse(outputs[6].capture);
    expect(inspected.fileFormat).toBe("pcapng");
    expect(inspected.sha256).toBe(
      createHash("sha256")
        .update(await readFile(sample))
        .digest("hex"),
    );
    expect(outputs[6].coverage).toMatchObject({ scannedThrough: 8, scanComplete: true, partial: false });
    expect(outputs[7]).toMatchObject({
      packets: [
        {
          frame: {
            number: 3,
            captureSha256: inspected.sha256,
            interfaceId: 0,
            timestampEpoch: "1767225600.200000000",
          },
          fields: { "coap.opt.uri_path_recon": ["/sensors/temp"] },
        },
      ],
      packetData: "untrusted_capture_data",
      coverage: { scannedThrough: 5, scanComplete: false, partial: true, returned: 1 },
      page: { limit: 1, next: { afterFrame: 3 } },
    });
    expect(outputs[8]).toMatchObject({
      analysis: { profile: "vera-offline-v1", decodeAs },
      packet: {
        frame: { captureSha256: hash, number: 1, timestampEpoch: "1.500000000" },
        fields: { "coap.code": ["1"], "udp.dstport": ["5684"] },
      },
    });
    expect(outputs[9]).toMatchObject({ reason: "frame_not_found" });
    expect(outputs[10]).toMatchObject({ reason: "field_unavailable" });
    expect(outputs[11]).toMatchObject({ reason: "cursor_mismatch" });
    expect(outputs[12]).toMatchObject({ capture: managed });
    const { ref: sourceCitation, ...sourcePacket } = outputs[8].packet;
    expect(outputs[13]).toMatchObject({ capture: managed, packet: sourcePacket });
    expect(sourceCitation).toMatch(/^capture:[a-f0-9]{64}#f=1$/);
    expect(outputs[13].packet.ref).toMatch(/^capture:[a-f0-9]{64}#f=1$/);
    expect(outputs[13].packet.ref).not.toBe(sourceCitation);
    expect(outputs[14]).toMatchObject({ reason: "invalid_capture" });
    expect(outputs[15]).toMatchObject({ reason: "capture_byte_limit" });
    expect(outputs[16]).toMatchObject({ reason: "capture_inaccessible" });
    expect(outputs[17]).toMatchObject({ reason: "capture_changed" });
    const stored = join(rig.bench, ".vera/captures");
    expect(await readdir(stored)).toEqual([`${hash}.pcap`]);
    expect(await readFile(join(stored, `${hash}.pcap`))).toEqual(classicPcap);
    expect(service.get(session.id).snapshot.approvals).toEqual([]);
    expect(
      rig.starts
        .slice(firstStart)
        .every((args) => args[0] === "-G" || (args[0] === "-n" && args.includes("-r"))),
    ).toBe(true);
    expect(rig.configurations.slice(firstStart).every((folder) => folder.includes("vera-offline-"))).toBe(
      true,
    );

    const cursor = outputs[7].page.next;
    const changed = Buffer.from(classicPcap);
    changed[changed.length - 1] = 9;
    await writeFile(join(stored, `${hash}.pcap`), changed);
    const nextCapture = "captures/next.pcap";
    await writeFile(join(rig.bench, nextCapture), changed);
    for (let index = 1; index < captureLimits.managedFiles; index++)
      await writeFile(join(stored, `${index.toString(16).padStart(64, "0")}.pcap`), classicPcap);
    const nextPage = {
      source: { reference: inspected },
      filter: "coap",
      fields: ["coap.opt.uri_path_recon"],
      scanFrames: 5,
      limit: 1,
      cursor,
    };
    await rig.writeReplay("continue", [
      typed("query", nextPage),
      typed("query", { ...nextPage, filter: "udp" }),
      typed("inspect", { source: { reference: managed } }),
      importCapture(nextCapture),
      typed("validate_filter", { filter: "udp.payload contains 12:34" }),
      typed("validate_filter", { filter: 'ip.addr == "not-resolved.example"' }),
      typed("validate_filter", {
        filter: "udp",
        decodeAs: [{ transport: "udp", port: 5684, protocol: "absent" }],
      }),
      { text: "Done." },
    ]);
    const continuation = rig.session(service, "continue", "ask");
    service.send(continuation.id, "Continue the saved query.");
    expect(await service.waitIdle(continuation.id)).toEqual({ stopReason: "end" });
    const more = continuation.outputs.map(({ summary }) => JSON.parse(summary));
    expect(more[0]).toMatchObject({
      packets: [{ frame: { number: 4, captureSha256: inspected.sha256 } }],
      page: { limit: 1, afterFrame: 3, next: null },
      coverage: { matchedInScope: 2, partial: true },
    });
    expect(more.slice(1).map(({ reason }) => reason)).toEqual([
      "cursor_mismatch",
      "capture_changed",
      "storage_quota",
      "filter_unavailable",
      "filter_unavailable",
      "invalid_decode_as",
    ]);
    expect(await readdir(stored)).toHaveLength(captureLimits.managedFiles);

    const repeated = "captures/repeated.pcap";
    const frameBytes = classicPcap.subarray(24);
    await writeFile(
      join(rig.bench, repeated),
      Buffer.concat([classicPcap.subarray(0, 24), ...Array<Buffer>(28).fill(frameBytes)]),
    );
    await rig.writeReplay("budget", [
      typed("query", { source: { path: repeated }, fields: ["ip.src"], limit: 28 }),
      { text: "Done." },
    ]);
    const mask = (text: string) => text.replaceAll("192.0.2.1", "[masked]".repeat(22));
    for (const limit of [8000, 32_000]) {
      rig.resultBudget(limit, mask);
      rig.modelResults.length = 0;
      const budget = rig.session(service, "budget", "ask");
      service.send(budget.id, "Summarize this controlled capture.");
      expect(await service.waitIdle(budget.id)).toEqual({ stopReason: "end" });
      const text = rig.modelResults.at(-1) ?? "";
      expect(text.length).toBeLessThanOrEqual(limit);
      expect(text).not.toContain("192.0.2.1");
      const page = JSON.parse(text);
      expect(page.packets[0].fields["ip.src"]).toEqual(["[masked]".repeat(22)]);
      if (limit === 8000) {
        expect(page.packets.length).toBeLessThan(28);
        expect(page.coverage).toMatchObject({
          partial: true,
          truncated: true,
          returned: page.packets.length,
        });
        expect(page.page.next.afterFrame).toBe(page.packets.at(-1).frame.number);
      } else {
        expect(page.packets).toHaveLength(28);
        expect(page.coverage).toMatchObject({ partial: false, truncated: false, returned: 28 });
        expect(page.page.next).toBeNull();
      }
    }
  } finally {
    await rig.close();
  }
}, 120_000);

it("reconciles typed offline traffic statistics and directional streams with native TShark", async (ctx) => {
  const source = { path: "captures/sample.pcapng" };
  const trafficSource = { path: "captures/traffic.pcapng" };
  const stat = (statistic: object, options: object = {}) =>
    typed("statistics", { source, statistic, ...options });
  const follow = (transport: string, stream: number, options: object = {}) =>
    typed("follow", { source, transport, stream, ...options });
  const rates = { kind: "traffic", intervalMs: 300 };
  const window = { startMs: -300, endMs: 800 };
  const rig = await workbench({
    traffic: [
      stat({ kind: "protocol_hierarchy" }),
      stat({ kind: "endpoints", layer: "udp" }),
      stat({ kind: "conversations", layer: "tcp" }),
      stat(rates, { window }),
      follow("udp", 0),
      follow("tcp", 0),
      stat({ kind: "diagnostics" }, { source: trafficSource, validateChecksums: true }),
      stat({ kind: "response_timing", protocol: "dns" }, { source: trafficSource }),
      stat(
        { kind: "response_timing", protocol: "http" },
        {
          source: trafficSource,
          filter: "frame.number == 15",
        },
      ),
      follow("tcp", 0, { source: trafficSource, limit: 2 }),
      follow("udp", 1, { source: trafficSource }),
      stat({ kind: "endpoints", layer: "ipv6" }, { source: trafficSource }),
      stat({ kind: "endpoints", layer: "ethernet" }),
      stat({ kind: "conversations", layer: "ipv4" }),
      follow("tcp", 12, { source: trafficSource, scanFrames: 5 }),
      stat({ kind: "traffic", intervalMs: 1 }, { window }),
      stat(rates),
      stat({ kind: "protocol_hierarchy" }, { scanFrames: 5, filter: "udp" }),
      stat({ kind: "response_timing", protocol: "quic" }),
      follow("tcp", 12, { source: trafficSource }),
      { text: "Done." },
    ],
  });
  try {
    if (!rig.tshark) {
      if (process.env.VERA_REQUIRE_TSHARK === "1") throw Error("Native TShark is required.");
      ctx.skip("TShark unavailable for offline traffic acceptance.");
      return;
    }
    await writeFile(join(rig.bench, trafficSource.path), await readFile(trafficSample));
    const untimedSource = { path: "captures/untimed.pcapng" };
    await writeFile(join(rig.bench, untimedSource.path), await readFile(untimedSample));
    const executable = rig.tshark.executable;
    const native = async (capture: string, args: string[]) =>
      (
        await promisify(execFile)(executable, ["-n", "-r", capture, ...args], {
          timeout: 10_000,
          windowsHide: true,
        })
      ).stdout;
    const fields = (...names: string[]) => ["-T", "fields", ...names.flatMap((name) => ["-e", name])];
    const nativeSample = (
      await native(sample, fields("frame.number", "frame.time_relative", "frame.len", "frame.protocols"))
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    const service = await rig.start();
    const session = rig.session(service, "traffic", "ask");
    service.send(session.id, "Summarize this synthetic capture.");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const outputs = session.outputs.map(({ summary }) => JSON.parse(summary));
    expect(session.outputs).toHaveLength(20);
    expect(session.outputs.slice(0, 14).filter(({ ok }) => !ok)).toEqual([]);

    const paths = new Set(
      nativeSample.flatMap(
        ([, , , stack]) =>
          stack?.split(":").map((_protocol, index, layers) => layers.slice(0, index + 1).join(":")) ?? [],
      ),
    );
    expect(outputs[0].traffic.rows).toEqual(
      [...paths].sort().map((path) => {
        const matches = nativeSample.filter(
          ([, , , stack]) => stack === path || stack?.startsWith(`${path}:`),
        );
        const bytes = matches.reduce((sum, row) => sum + Number(row[2]), 0);
        return {
          path: path.split(":"),
          frames: [Number(matches[0]?.[0])],
          packets: matches.length,
          wireBytes: bytes,
          capturedBytes: bytes,
        };
      }),
    );
    expect(outputs[0].traffic.summary).toMatchObject({ packets: 8, wireBytes: 445, capturedBytes: 445 });
    const nativeUdp = await native(sample, ["-q", "-z", "endpoints,udp"]);
    expect(nativeUdp).toMatch(/192\.168\.7\.1\s+40000\s+4\s+228 bytes\s+2\s+124 bytes\s+2\s+104 bytes/);
    expect(outputs[1].traffic.rows).toMatchObject([
      {
        endpoint: { address: "192.168.7.1", port: 40000 },
        tx: { packets: 2, wireBytes: 124 },
        rx: { packets: 2, wireBytes: 104 },
        packets: 4,
        wireBytes: 228,
        frames: [3, 4],
      },
      {
        endpoint: { address: "192.168.7.10", port: 5683 },
        tx: { packets: 2, wireBytes: 104 },
        rx: { packets: 2, wireBytes: 124 },
        packets: 4,
        wireBytes: 228,
        frames: [4, 3],
      },
    ]);
    const nativeTcp = await native(sample, ["-q", "-z", "conv,tcp"]);
    expect(nativeTcp).toMatch(
      /192\.168\.7\.1:50200\s+<->\s+192\.168\.7\.10:502\s+1 67 bytes\s+1 66 bytes\s+2 133 bytes/,
    );
    expect(outputs[2].traffic.rows).toMatchObject([
      {
        stream: 0,
        frames: [5, 6],
        packets: 2,
        wireBytes: 133,
        aToB: { packets: 1, wireBytes: 66 },
        bToA: { packets: 1, wireBytes: 67 },
      },
    ]);
    expect(outputs[3].traffic.rows).toEqual(
      [-300, 0, 300, 600].map((startMs) => {
        const endMs = Math.min(startMs + 300, window.endMs);
        const observed = nativeSample.filter(
          ([, seconds]) => Number(seconds) * 1000 >= startMs && Number(seconds) * 1000 < endMs,
        );
        const bytes = observed.reduce((sum, frame) => sum + Number(frame[2]), 0);
        const duration = (endMs - startMs) / 1000;
        return {
          startMs,
          endMs,
          packets: observed.length,
          wireBytes: bytes,
          capturedBytes: bytes,
          packetsPerSecond: observed.length / duration,
          wireBytesPerSecond: bytes / duration,
          capturedBytesPerSecond: bytes / duration,
          frames: observed.length ? [Number(observed[0]?.[0])] : [],
        };
      }),
    );
    expect(outputs[3].traffic.scopeCoverage.windowExtendsOutsideScannedTimeRange).toBe(true);

    for (const [index, capture, transport, stream] of [
      [4, sample, "udp", 0],
      [5, sample, "tcp", 0],
      [10, trafficSample, "udp", 1],
    ] as const) {
      const tap = await native(capture, ["-q", "-z", ["follow", transport, "yaml", stream].join(",")]);
      const rows = [
        ...tap.matchAll(
          /packet: (\d+)\r?\n +peer: (\d)\r?\n +timestamp: [^\r\n]+\r?\n +data: !!binary \|\r?\n +(\S+)/g,
        ),
      ].map(([, frame, peer, data]) => ({
        kind: "data",
        frames: [Number(frame)],
        direction: peer === "0" ? "a_to_b" : "b_to_a",
        payloadBytes: Buffer.from(data ?? "", "base64").length,
      }));
      expect(outputs[index].traffic.rows).toMatchObject(rows);
      expect(
        outputs[index].traffic.evidence.map(({ frame }: { frame: { number: number } }) => frame.number),
      ).toEqual([...new Set(rows.flatMap((row) => row.frames))].sort((a, b) => a - b));
    }
    expect(outputs[5].traffic.summary.tcp).toMatchObject({
      handshakeMarkersObserved: false,
      endMarkersObserved: false,
    });
    expect(outputs[10].traffic.summary.a.address).toBe("2001:db8::1");
    expect(outputs[11].traffic.rows).toMatchObject([
      { endpoint: { address: "2001:db8::1" }, frames: [16, 17], packets: 2, wireBytes: 130 },
      { endpoint: { address: "2001:db8::2" }, frames: [17, 16], packets: 2, wireBytes: 130 },
    ]);
    expect(outputs[12].traffic.rows).toMatchObject([
      { endpoint: { address: "02:00:00:00:00:01" }, frames: [1, 2], packets: 8, wireBytes: 445 },
      { endpoint: { address: "ff:ff:ff:ff:ff:ff" }, frames: [1], packets: 1, wireBytes: 42 },
      { endpoint: { address: "02:00:00:00:00:10" }, frames: [2, 3], packets: 7, wireBytes: 403 },
    ]);
    expect(outputs[13].traffic.rows).toMatchObject([
      {
        frames: [3, 4],
        packets: 6,
        wireBytes: 361,
        aToB: { packets: 3, wireBytes: 190 },
        bToA: { packets: 3, wireBytes: 171 },
      },
    ]);

    const verifiedFields = await native(trafficSample, [
      "-o",
      "tcp.check_checksum:TRUE",
      "-o",
      "udp.check_checksum:TRUE",
      ...fields(
        "frame.number",
        "tcp.analysis.retransmission",
        "tcp.analysis.lost_segment",
        "tcp.checksum.partial",
        "udp.checksum.status",
        "frame.len",
        "frame.cap_len",
        "_ws.expert.severity",
        "_ws.expert.group",
      ),
    ]);
    const nativeDiagnostics = verifiedFields
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    expect(nativeDiagnostics.find((row) => row[0] === "5")?.[1]).toBe("1");
    expect(nativeDiagnostics.find((row) => row[0] === "7")?.[2]).toBe("1");
    expect(nativeDiagnostics.find((row) => row[0] === "10")?.[3]).toBe("1");
    expect(nativeDiagnostics.find((row) => row[0] === "13")?.[4]).toBe("0");
    expect(outputs[6].traffic.summary).toMatchObject({
      tcpObservations: { retransmission: 1, previousSegmentUnseen: 1, acknowledgedSegmentUnseen: 1 },
      partialChecksumMarkers: { tcp: 1, udp: 0 },
      checksumStatuses: { tcp: { partial_offload_evidence: 1, unverified: 1 }, udp: { bad: 1 } },
    });
    for (const [index, key] of [
      [7, "expertSeverity"],
      [8, "expertGroup"],
    ] as const) {
      const histogram: Record<string, number> = {};
      for (const row of nativeDiagnostics)
        for (const code of row[index]?.split(",").filter(Boolean) ?? [])
          histogram[code] = (histogram[code] ?? 0) + 1;
      expect(outputs[6].traffic.summary[key]).toEqual(histogram);
    }
    expect(outputs[6].traffic.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frames: [5], tcp: ["retransmission"] }),
        expect.objectContaining({ frames: [7], tcp: ["previousSegmentUnseen"] }),
        expect.objectContaining({ frames: [9], truncated: true, wireBytes: 68, capturedBytes: 56 }),
        expect.objectContaining({ frames: [10], checksum: { tcp: ["partial_offload_evidence"], udp: [] } }),
      ]),
    );
    expect(outputs[6].traffic.scopeCoverage).toMatchObject({
      truncatedFrames: 1,
      observationPoints: [
        { section: 1, interfaceId: 0, packets: 10 },
        { section: 1, interfaceId: 1, packets: 7 },
      ],
    });
    for (const [index, protocol, requestField] of [
      [7, "dns", "dns.response_to"],
      [8, "http", "http.request_in"],
    ] as const) {
      const output = await native(trafficSample, [
        "-Y",
        requestField,
        ...fields("frame.number", requestField, `${protocol}.time`),
      ]);
      const [response, request, durationSeconds] = output.trim().split("\t");
      expect(outputs[index].traffic.rows).toMatchObject([
        {
          frames: [Number(request), Number(response)],
          requestInScope: protocol === "dns",
          durationSeconds,
        },
      ]);
    }
    expect(outputs[7].traffic.summary).toMatchObject({ pairs: 1, requestsWithoutObservedResponse: 1 });
    expect(outputs[8].traffic.summary.pairsWithRequestOutsideScope).toBe(1);

    const tcpEvidence = outputs[9].traffic;
    expect(tcpEvidence.summary).toMatchObject({
      nativeGapRecords: 1,
      truncatedStreamFrames: 1,
      directions: [
        { direction: "a_to_b", payloadBytes: 23, missingBytes: 5 },
        { direction: "b_to_a", payloadBytes: 2 },
      ],
      tcp: {
        synFrame: 1,
        synAckFrame: 2,
        ackAfterSynAckFrame: 3,
        handshakeMarkersObserved: true,
        endMarkersObserved: false,
      },
    });
    expect(tcpEvidence.rows).toMatchObject([
      { frames: [4], kind: "data", direction: "a_to_b", payloadBytes: 19 },
      { frames: [8], kind: "gap", direction: "a_to_b", payloadBytes: 0, missingBytes: 5 },
    ]);
    expect(outputs.slice(14, 17).map(({ reason }) => reason)).toEqual([
      "stream_not_observed",
      "traffic_interval_limit",
      "traffic_window_required",
    ]);
    expect(outputs[17].coverage).toMatchObject({ scanComplete: false, scannedThrough: 5, matchedInScope: 2 });
    expect(session.outputs[18]?.ok).toBe(false);
    expect(outputs[19]).toMatchObject({ reason: "stream_not_found" });
    const proof = await native(trafficSample, ["-q", "-z", "follow,tcp,yaml,0"]);
    expect([...proof.matchAll(/packet: (\d+)/g)].map((match) => Number(match[1]))).toEqual([4, 8, 7, 9]);
    const marker = "VERA_LOCAL_SENTINEL";
    expect(proof).toContain(Buffer.from(marker).toString("base64"));
    expect(JSON.stringify(rig.modelResults)).not.toContain(marker);
    expect(JSON.stringify(rig.modelResults)).not.toContain(Buffer.from(marker).toString("base64"));
    expect(await readFile(join(rig.bench, trafficSource.path))).toEqual(await readFile(trafficSample));

    const continuation = {
      source: { reference: outputs[9].capture },
      limit: 2,
      trafficCursor: tcpEvidence.page.next,
    };
    await rig.writeReplay("trafficContinuation", [
      follow("tcp", 0, continuation),
      follow("tcp", 0, { ...continuation, window: { startMs: 0, endMs: 1000 } }),
      stat({ kind: "endpoints", layer: "tcp" }, { source: trafficSource }),
      stat(
        { kind: "response_timing", protocol: "http" },
        { source: trafficSource, filter: "frame.number == 14" },
      ),
      stat(
        { kind: "traffic", intervalMs: 50 },
        {
          source: untimedSource,
          filter: "frame.number >= 2",
          window: { startMs: 0, endMs: 100 },
        },
      ),
      stat({ kind: "protocol_hierarchy" }, { source: untimedSource }),
      { text: "Done." },
    ]);
    rig.resultBudget(8000, (text) => text.replaceAll("192.168.7.1", "[masked]"));
    rig.modelResults.length = 0;
    const cont = rig.session(service, "trafficContinuation", "ask");
    service.send(cont.id, "Continue the stream and list endpoints.");
    expect(await service.waitIdle(cont.id)).toEqual({ stopReason: "end" });
    const more = cont.outputs.map(({ summary }) => JSON.parse(summary));
    expect(more[0].traffic).toMatchObject({
      rows: [
        { frames: [7], direction: "a_to_b", payloadBytes: 4 },
        { frames: [9], direction: "b_to_a", payloadBytes: 2 },
      ],
      summary: { directions: tcpEvidence.summary.directions },
      page: { offset: 2, totalRows: 4, next: null },
    });
    expect(more[1]).toMatchObject({ reason: "cursor_mismatch" });
    expect(more[3].traffic).toMatchObject({
      summary: {
        pairs: 0,
        requests: 1,
        requestsWithoutObservedResponse: 0,
        requestsWithResponseOnlyOutsideScope: 1,
      },
      scopeCoverage: { measurementIncomplete: true },
    });
    const rawUntimed = (
      await native(
        untimedSample,
        fields(
          "frame.number",
          "frame.section_number",
          "frame.interface_id",
          "frame.time_epoch",
          "frame.time_relative",
        ),
      )
    )
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    expect(rawUntimed[0]?.slice(3)).toEqual(["", ""]);
    expect(rawUntimed[1]?.[4]).toBe("0.000000000");
    expect(more[4].traffic).toMatchObject({
      timeOrigin: { basis: "first_timestamped_frame", frame: 2, timestampEpoch: rawUntimed[1]?.[3] },
      scopeCoverage: { framesWithoutTimestamp: 1, missingTimeFrames: 0, measurementIncomplete: true },
      rows: [
        { packets: 1, frames: [2] },
        { packets: 0, frames: [] },
      ],
    });
    const nativePoints = rawUntimed.map(([frame, section, interfaceId]) => ({
      section: Number(section),
      frame: { number: Number(frame), interfaceId: Number(interfaceId) },
    }));
    expect(more[5].traffic.evidence).toMatchObject([nativePoints[0], nativePoints[2]]);
    const model = rig.modelResults
      .map((text) => JSON.parse(text))
      .find((result) => result.traffic?.selection?.kind === "endpoints");
    expect(model.traffic.rows[0].endpoint.address).toBe("[masked]");
    expect(JSON.stringify(rig.modelResults)).not.toContain("192.168.7.1");
  } finally {
    await rig.close();
  }
}, 90_000);

it("answers questions about the sample capture without approvals and gates live capture", async (ctx) => {
  const file = "captures/sample.pcapng";
  const questions = [
    ["-n", "-r", file],
    [
      "-nr",
      file,
      "-Y",
      "coap",
      "-T",
      "fields",
      "-e",
      "frame.number",
      "-e",
      "coap.opt.uri_path_recon",
      "-e",
      "coap.code",
    ],
    [
      "-nr",
      file,
      "-Y",
      "modbus.func_code == 3",
      "-T",
      "fields",
      "-e",
      "mbtcp.trans_id",
      "-e",
      "modbus.regval_uint16",
    ],
    ["-nr", file, "-q", "-z", "io,phs"],
    ["-nr", file, "-q", "-z", "conv,udp"],
  ];
  const bench = await workbench({
    analyze: [
      ...questions.map(step),
      step(["-i", "1", "-c", "5"]),
      { text: "The board answered two CoAP reads and one Modbus read." },
    ],
    lua: [
      step(["-r", file, "-X", "lua_script:dissector.lua"]),
      step(["-r", file, "-A", "user:secret"]),
      { text: "Refused." },
    ],
  });
  try {
    // The installed skills carry the analysis and bounded-capture guidance without a tshark.
    const listed = (await bench.skills.list()).filter((skill) => skill.plugin === "wireshark-tshark");
    expect(listed.map((skill) => skill.name)).toEqual(["wireshark-analyze", "wireshark-capture"]);
    const analyze = (await bench.skills.read("plugin", "wireshark-analyze")).content;
    for (const text of [
      "`wireshark_capture`",
      "`validate_filter`",
      "`query`",
      "`statistics`",
      "`conversations`",
      "`automotive`",
    ])
      expect(analyze).toContain(text);
    const capture = (await bench.skills.read("plugin", "wireshark-capture")).content;
    for (const text of ["tshark -D", "-a duration:", "-c ", "-f ", "-w captures/"])
      expect(capture).toContain(text);
    if (!bench.tshark) {
      ctx.skip("tshark is not installed on this host; the capture-file acceptance needs a real tshark");
      return;
    }
    const service = await bench.start();
    const analysis = bench.session(service, "analyze", "ask");
    const start = bench.starts.length;
    service.send(analysis.id, "What did the board answer in captures/sample.pcapng?");
    await expect.poll(analysis.pending, { timeout: 120_000 }).toBeDefined();
    const approval = analysis.pending();
    if (!approval) throw Error("Expected the live capture approval");
    expect(approval.program).toMatchObject({
      program: "tshark",
      risk: "device-read",
      args: ["-i", "1", "-c", "5"],
    });
    expect(service.get(analysis.id).snapshot.approvals).toHaveLength(1);
    expect(analysis.outputs).toHaveLength(questions.length);
    const answers = results(analysis.outputs);
    for (const answer of answers) expect(answer.exitCode, answer.output).toBe(0);
    expect(answers[0]?.output).toContain("/sensors/temp");
    expect(answers[1]?.output).toMatch(/3\t\/sensors\/temp\t1/);
    expect(answers[1]?.output).toMatch(/8\t\/sensors\/humidity\t69/);
    expect(answers[2]?.output).toContain("1\t235,258");
    expect(answers[3]?.output).toMatch(/coap\s+frames:4/);
    expect(answers[3]?.output).toMatch(/modbus\s+frames:2/);
    expect(answers[4]?.output).toContain("192.168.7.10:5683");
    expect(bench.starts.slice(start)).toHaveLength(questions.length);
    service.decideApproval({
      sessionId: analysis.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision: "denied",
    });
    expect(await service.waitIdle(analysis.id)).toEqual({ stopReason: "end" });
    // The denied live capture never started a process.
    expect(bench.starts.slice(start)).toHaveLength(questions.length);

    const blocked = bench.session(service, "lua", "bypass");
    const before = bench.starts.length;
    service.send(blocked.id, "Load the Lua dissector");
    expect(await service.waitIdle(blocked.id)).toEqual({ stopReason: "end" });
    expect(blocked.outputs.map((output) => output.ok)).toEqual([false, false]);
    expect(service.get(blocked.id).snapshot.approvals).toEqual([]);
    expect(bench.starts).toHaveLength(before);
  } finally {
    await bench.close();
  }
}, 240_000);

// Opt-in: VERA_TSHARK_LIVE_INTERFACE names a loopback interface (\Device\NPF_Loopback with Npcap, lo on
// Linux with dumpcap permissions). The test sends its own UDP datagrams to 127.0.0.1 and captures only them.
const live = process.env.VERA_TSHARK_LIVE_INTERFACE;
it.skipIf(!live)(
  "captures live loopback traffic after the device-read approval",
  async () => {
    const port = 59999;
    const capture = [
      "-n",
      "-i",
      live ?? "",
      "-f",
      `udp port ${port}`,
      "-c",
      "3",
      "-a",
      "duration:30",
      "-w",
      "captures/live.pcapng",
    ];
    const readBack = ["-nr", "captures/live.pcapng", "-T", "fields", "-e", "udp.dstport", "-e", "data.data"];
    const bench = await workbench({
      live: [step(capture), step(readBack), { text: "Captured three datagrams." }],
    });
    const socket = createSocket("udp4");
    try {
      if (!bench.tshark) throw Error("VERA_TSHARK_LIVE_INTERFACE needs an installed tshark");
      const service = await bench.start();
      const session = bench.session(service, "live", "ask");
      const before = bench.starts.length;
      service.send(session.id, "Capture three loopback datagrams.");
      await expect.poll(session.pending, { timeout: 60_000 }).toBeDefined();
      const approval = session.pending();
      if (!approval) throw Error("Expected the live capture approval");
      expect(approval.program).toMatchObject({ program: "tshark", risk: "device-read", args: capture });
      expect(bench.starts).toHaveLength(before);
      service.decideApproval({
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
      });
      // tshark needs a moment to open the interface; keep sending until the bounded capture ends.
      for (let index = 0; session.outputs.length === 0 && index < 120; index++) {
        socket.send(`vera-live-${index}`, port, "127.0.0.1");
        await sleep(250);
      }
      expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
      const [captured, read] = results(session.outputs);
      expect(captured?.exitCode, captured?.output).toBe(0);
      expect(captured?.output).toContain("3 packets captured");
      expect(read?.exitCode, read?.output).toBe(0);
      const lines = (read?.output ?? "").trim().split(/\r?\n/);
      expect(lines).toHaveLength(3);
      for (const line of lines)
        expect(line).toMatch(new RegExp(`^${port}\\t${Buffer.from("vera-live-").toString("hex")}`));
      if (evidence)
        await writeFile(
          join(evidence, `${process.platform}-tshark-live.json`),
          JSON.stringify({ approval: approval.program, outputs: session.outputs }, null, 2),
        );
    } finally {
      socket.close();
      await bench.close();
    }
  },
  180_000,
);

reportSkip(!live, "the live loopback capture test", "set VERA_TSHARK_LIVE_INTERFACE to a loopback interface");
