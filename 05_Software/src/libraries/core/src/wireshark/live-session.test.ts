import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type LiveCaptureStart, liveCaptureManifestSchema } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { requestSha256 } from "../agent/approvals.js";
import { ReplayGateway } from "../llm/replay.js";
import { FakeHost } from "../plugins/fake-process-host.test-support.js";
import { plugin } from "../plugins/program-fixtures.test-support.js";
import type { ProgramChangeRequest } from "../plugins/program-request.js";
import { ProgramSession } from "../plugins/program-tools.js";
import { ProgramRunner } from "../plugins/runner.js";
import type { ProcessSpawnOptions } from "../ports.js";
import { SessionService } from "../sessions/service.js";
import { openDb } from "../storage/db.js";
import { createToolContext } from "../tools/context.js";
import { wiresharkDumpcapStartTool, wiresharkDumpcapTool } from "../tools/wireshark-live.js";
import { WriteQueue } from "../workbench/write-queue.js";
import { dumpcapInterfaces, liveCapturePlan } from "./live-native.js";
import { LiveCaptureSessions } from "./live-session.js";
import { snapshotCapture } from "./storage.js";

const scopes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of scopes.splice(0).reverse()) await close();
});

const windows = process.platform === "win32";
const interfaceId = windows ? "\\Device\\NPF_Loopback" : "lo";
const input: LiveCaptureStart = {
  interfaceId,
  filter: "udp and dst port 53000",
  durationSeconds: 10,
  totalBytes: 128_000,
};
const rolling = { ...input, rotation: { segmentSeconds: 1, segmentBytes: 32_000, retain: 2 } };
const signal = new AbortController().signal;
const localLine = (id: string) => `1. ${id}\t\tLoopback\t0\t127.0.0.1,::1\tloopback\t\n`;
const stem = (index: number) => `segment_${String(index).padStart(5, "0")}_20261125123450.pcapng`;
const filename = (args: readonly string[]) => args[args.indexOf("-w") + 1] ?? "";
const packet = Buffer.from(
  "0a0d0d0a1c0000004d3c2b1a01000000ffffffffffffffff1c000000" +
    "0100000014000000010000000010000014000000" +
    "06000000280000000000000000000000010000000400000004000000010203040000000028000000",
  "hex",
);

class DumpcapHost extends FakeHost {
  listFailure?: string;
  compileFailure?: string;
  compileReportsFailureWithSuccess = false;
  captureError?: string;
  override spawn(executable: string, args: readonly string[], options: ProcessSpawnOptions) {
    if (args.includes("-w") && this.captureError) this.failNext = this.captureError;
    const child = super.spawn(executable, args, options);
    let failure: string | undefined;
    if (args[0] === "--version") child.print("Dumpcap (Wireshark) 4.6.10\n");
    else if (args.includes("-D")) {
      failure = this.listFailure;
      child.print(localLine(interfaceId) + localLine("any") + localLine("rpcap://remote/eth0"));
    } else if (args.includes("-d")) {
      failure = this.compileFailure;
      if (!failure) child.print("(000) ret      #4096\n");
    } else if (args.includes("-S")) {
      // Statistics mode prints running counts until it is ended.
      child.print(`${interfaceId}\t3\t0\nrpcap://remote/eth0\t9\t0\n${interfaceId}\t41\t1\n`);
      return child;
    } else return child;
    if (failure) child.print(failure, "stderr");
    child.finish({ code: failure && !this.compileReportsFailureWithSuccess ? 2 : 0, signal: null });
    return child;
  }
}

async function rig() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-live-test-")));
  scopes.push(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, ".vera"));
  const host = new DumpcapHost(process.platform);
  const runner = new ProgramRunner({ host, clock: { sleep: async () => {} } });
  scopes.push(() => runner.stopAll());
  const source = plugin("wireshark-dumpcap", ["dumpcap"]);
  const official = { ...source, record: { ...source.record, tier: "official" as const } };
  const resolver = vi.fn(async () => ({ executable: join(root, "dumpcap") }));
  const programs = {
    runner,
    resolver: { resolve: resolver },
    clock: { sleep: async () => {} },
    plugins: async () => [official],
  };
  const sessions = new LiveCaptureSessions();
  scopes.push(() => sessions.stopOwner());
  const access = { queue: new WriteQueue(), assertWritable() {} };
  const ctx = (sessionId = "ses_owner") => ({
    ...createToolContext(root),
    programs: { host: programs, session: new ProgramSession(), sessionId },
    liveCapture: { sessions, access, packageSha256: official.record.sha256 },
  });
  function prepare(args: LiveCaptureStart = rolling) {
    const owner = ctx();
    const consume = vi.fn((_request: ProgramChangeRequest) => {});
    return {
      consume,
      prepared: wiresharkDumpcapStartTool.prepare?.(
        {
          ...owner,
          programs: { ...owner.programs, turnId: "turn", callId: "call", consume },
        },
        args,
        signal,
      ),
    };
  }
  const control = (args: Parameters<typeof wiresharkDumpcapTool.execute>[1], sessionId?: string) =>
    wiresharkDumpcapTool.execute(ctx(sessionId), args, signal);
  const captureProcesses = () => host.programs.filter((process) => process.args.includes("-w"));
  return { root, host, sessions, ctx, prepare, control, captureProcesses, resolver };
}

it("selects a local interface by ID or by name and refuses aliases and remote inputs", async () => {
  const stdout = ["any", "lo", "eth0", "2", "rpcap://other/eth0", "nflog", "TCP@localhost:9999"]
    .map(localLine)
    .join("");
  expect(dumpcapInterfaces(stdout, "linux", new Set(["lo", "eth0", "2", "any"])).map(({ id }) => id)).toEqual(
    ["lo", "eth0"],
  );
  expect(
    dumpcapInterfaces(localLine(interfaceId) + localLine("\\.\\pipe\\input"), "win32").map(({ id }) => id),
  ).toEqual(windows ? [interfaceId] : []);
  const t = await rig();
  expect(await t.control({ operation: "discover" })).toMatchObject({
    version: "4.6.10",
    interfaces: [{ id: interfaceId, loopback: true }],
  });
  for (const requested of ["1", "any", "-", "rpcap://other/eth0"]) {
    await expect(t.prepare({ ...input, interfaceId: requested }).prepared).rejects.toMatchObject({
      reason: "interface_unavailable",
    });
  }
  // The name discover lists selects the interface too, whatever its letter case.
  const named = await t.prepare({ ...input, interfaceId: "loopback" }).prepared;
  expect(named?.request.tool === "run_program" && named.request.args).toContain(interfaceId);
  // dumpcap itself compiles the filter, so a host name is its business; no filter keeps every packet.
  const hostname = await t.prepare({ ...input, filter: "udp and host board.local" }).prepared;
  expect(hostname?.request.tool === "run_program" && hostname.request.args).toContain(
    "udp and host board.local",
  );
  const { filter: _filter, ...unfiltered } = input;
  const everything = await t.prepare(unfiltered).prepared;
  expect(everything?.request.tool === "run_program" && everything.request.args).not.toContain("-f");
  expect(t.captureProcesses()).toHaveLength(0);
});

it("uses the JSON inventory without exposing addresses or accepting extcap entries", () => {
  const loopback = "\\Device\\NPF_Loopback";
  const other = "\\Device\\NPF_{CBA3956D-1022-4E43-B668-C8FD6C84923B}";
  const item = {
    friendly_name: "Loopback",
    vendor_description: null,
    loopback: true,
    extcap: "",
    addrs: ["127.0.0.1"],
  };
  const json = JSON.stringify([{ [loopback]: item }, { [other]: { ...item, extcap: "ssh" } }]);
  expect(dumpcapInterfaces(json, "win32")).toEqual([{ id: loopback, label: "Loopback", loopback: true }]);
  expect(() => dumpcapInterfaces("[{bad JSON}]", "win32")).toThrow();
});

it("prepares bounded approval and does not compile or acquire until the exact request is consumed", async () => {
  const t = await rig();
  const { prepared, consume } = t.prepare();
  const candidate = await prepared;
  if (candidate?.request.tool !== "run_program") throw Error("Missing program approval");
  expect(candidate.request).toMatchObject({
    risk: "device-read",
    plan: { limits: { maxSegments: 4 } },
  });
  // The permission mode decides whether a capture asks, as for any device read.
  expect(candidate.request.explicitUserApproval).toBeUndefined();
  expect(candidate.request.args).toEqual(
    expect.arrayContaining([
      interfaceId,
      input.filter,
      "duration:10",
      "files:4",
      "files:3",
      "filesize:23",
      "packets:50000",
      "4096",
    ]),
  );
  // Promiscuous unless the call turns it off.
  expect(candidate.request.args).not.toContain("-p");
  const quiet = await t.prepare({ ...rolling, promiscuous: false }).prepared;
  expect(quiet?.request.tool === "run_program" && quiet.request.args).toContain("-p");
  expect(t.host.programs.some((process) => process.args.includes("-d"))).toBe(false);
  expect(t.captureProcesses()).toHaveLength(0);
  consume.mockImplementation((current) => {
    expect(requestSha256(current)).toBe(requestSha256(candidate.request));
  });
  const result = await candidate.apply(signal);
  expect(result.status).toBe("running");
  expect(consume).toHaveBeenCalledOnce();
  expect(t.captureProcesses()).toHaveLength(1);
  expect(t.captureProcesses()[0]?.options.cwd).toBe(
    join(dirname(filename(t.captureProcesses()[0]?.args ?? [])), "profile"),
  );
  await expect(candidate.apply(signal)).rejects.toMatchObject({ reason: "capture_startup" });
  expect(() => t.prepare({ ...rolling, durationSeconds: 3601 })).toThrow();
  expect(() => liveCapturePlan({ ...rolling, totalBytes: 32_000 })).toThrow();
});

it.each([
  ["Unable to load Npcap (wpcap.dll)", "npcap_missing"],
  ["Operation not permitted", "capture_permission"],
  ["There are no interfaces on which a capture can be done", "interface_unavailable"],
])("reports native inventory failure %s without capture", async (diagnostic, reason) => {
  const t = await rig();
  t.host.listFailure = diagnostic;
  await expect(t.control({ operation: "discover" })).resolves.toMatchObject({ isError: true, reason });
  expect(t.captureProcesses()).toHaveLength(0);
});

it("distinguishes a missing program, native filter compile rejection and startup failure", async () => {
  const t = await rig();
  t.resolver.mockResolvedValueOnce(undefined as never);
  await expect(t.control({ operation: "discover" })).resolves.toMatchObject({ reason: "dumpcap_missing" });
  t.host.compileFailure = "Invalid capture filter: syntax error";
  const first = await t.prepare(input).prepared;
  await expect(first?.apply(signal)).resolves.toMatchObject({
    status: "failed",
    reason: "invalid_capture_filter",
  });
  expect(t.captureProcesses()).toHaveLength(0);
  delete t.host.compileFailure;
  t.host.captureError = "ENOENT";
  const next = await t.prepare(input).prepared;
  await expect(next?.apply(signal)).resolves.toMatchObject({
    status: "failed",
    manifest: { reason: "capture_startup", segments: [] },
  });
});

it.each([
  ["Invalid capture filter: syntax error", "invalid_capture_filter"],
  ["You do not have permission to capture on device 'lo'", "capture_permission"],
  ["Device 'lo' is not up", "interface_unavailable"],
])(
  "requires positive native filter compilation even when Dumpcap exits zero for %s",
  async (failure, reason) => {
    const t = await rig();
    t.host.compileFailure = failure;
    t.host.compileReportsFailureWithSuccess = true;
    const candidate = await t.prepare(input).prepared;
    await expect(candidate?.apply(signal)).resolves.toMatchObject({ status: "failed", reason });
    expect(t.captureProcesses()).toHaveLength(0);
  },
);

it("refuses a capture before native acquisition when the managed store is full", async () => {
  const t = await rig();
  const folder = join(t.root, ".vera", "captures");
  await mkdir(folder);
  for (let index = 0; index < 32; index++)
    await writeFile(join(folder, `${index.toString(16).padStart(64, "0")}.pcapng`), packet);
  const candidate = await t.prepare(input).prepared;
  await expect(candidate?.apply(signal)).resolves.toMatchObject({ isError: true, reason: "storage_quota" });
  expect(t.captureProcesses()).toHaveLength(0);
});

it("preserves a verified receipted rolling segment when its attempted successor fails to open", async () => {
  const t = await rig();
  const candidate = await t.prepare().prepared;
  const started = await candidate?.apply(signal);
  const [child] = t.captureProcesses();
  if (!child) throw Error("Missing capture process");
  const folder = dirname(filename(child.args));
  const prior = join(folder, stem(1));
  const failed = join(folder, stem(2));
  await writeFile(prior, packet);
  await writeFile(join(folder, "closed.txt"), `${prior}\n${failed}\n`);
  child.finish({ code: 1, signal: null });
  await vi.waitFor(async () => {
    const status = await t.control({ operation: "status", captureId: started?.captureId });
    expect(status).toMatchObject({
      status: "failed",
      manifest: {
        incompleteSegments: 1,
        lastSegmentPartial: true,
        partial: true,
        segments: [{ sequence: 1 }],
      },
    });
  });
});

it("does not present a structurally valid last prefix as finalized after a native close failure", async () => {
  const t = await rig();
  const candidate = await t.prepare().prepared;
  const started = await candidate?.apply(signal);
  const [child] = t.captureProcesses();
  if (!child) throw Error("Missing capture process");
  const folder = dirname(filename(child.args));
  const paths = [join(folder, stem(1)), join(folder, stem(2))];
  await Promise.all(paths.map((path) => writeFile(path, packet)));
  await writeFile(join(folder, "closed.txt"), `${paths.join("\n")}\n`);
  child.print(
    "Not all the packets could be written to the file to which the capture was being saved.\n",
    "stderr",
  );
  child.finish({ code: 1, signal: null });
  await vi.waitFor(async () => {
    const status = await t.control({ operation: "status", captureId: started?.captureId });
    expect(status).toMatchObject({
      status: "failed",
      manifest: {
        incompleteSegments: 1,
        lastSegmentPartial: true,
        partial: true,
        segments: [{ sequence: 1 }],
      },
    });
  });
});

it.each([
  ["Error while capturing packets: capture input failed", "capture_failed"],
  ['The network adapter "Loopback" is no longer attached; the capture has stopped.', "interface_unavailable"],
])(
  "reports an exit-0 native acquisition failure for %s and leaves failed drop statistics unknown",
  async (diagnostic, reason) => {
    const t = await rig();
    const candidate = await t.prepare(input).prepared;
    const pending = candidate?.apply(signal);
    await vi.waitFor(() => expect(t.captureProcesses()).toHaveLength(1));
    const [child] = t.captureProcesses();
    if (!child) throw Error("Missing capture process");
    await writeFile(filename(child.args), packet);
    child.print(
      `${diagnostic}\nCan't get packet-drop statistics\nPackets captured: 1\nPackets received/dropped on interface '${interfaceId}': 1/0 (pcap:0/dumpcap:0/flushed:0/ps_ifdrop:0) (100.0%)\n`,
      "stderr",
    );
    child.finish({ code: 0, signal: null });
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      manifest: {
        reason,
        partial: true,
        stats: { captured: 1, dropped: null, interfaceDropped: null },
        segments: [{ packets: 1 }],
      },
    });
  },
);

it("reports an ambiguous native expiry when the last permitted segment was only opened", async () => {
  const t = await rig();
  const candidate = await t.prepare({ ...rolling, durationSeconds: 2, totalBytes: 64_000 }).prepared;
  const started = await candidate?.apply(signal);
  const [child] = t.captureProcesses();
  if (!child) throw Error("Missing capture process");
  const folder = dirname(filename(child.args));
  const paths = [join(folder, stem(1)), join(folder, stem(2))];
  await Promise.all(paths.map((path) => writeFile(path, packet)));
  await writeFile(join(folder, "closed.txt"), `${paths.join("\n")}\n`);
  await new Promise<void>((resolve) => setTimeout(resolve, 2050));
  child.finish({ code: 0, signal: null });
  await vi.waitFor(async () => {
    const status = await t.control({ operation: "status", captureId: started?.captureId });
    expect(status).toMatchObject({ status: "expired", manifest: { reason: "native_limit" } });
  });
});

it("stops only the owner, keeps completed members and explicitly reports an interrupted last segment", async () => {
  const t = await rig();
  const candidate = await t.prepare().prepared;
  const started = await candidate?.apply(signal);
  const captureId = started?.captureId;
  const [child] = t.captureProcesses();
  if (!child) throw Error("Missing capture process");
  const folder = dirname(filename(child.args));
  const first = join(folder, stem(2));
  const second = join(folder, stem(3));
  await Promise.all([
    writeFile(first, packet),
    writeFile(second, packet),
    writeFile(join(folder, stem(4)), Buffer.from("partial")),
  ]);
  await writeFile(join(folder, "closed.txt"), `${first}\n${second}\n`);
  const status = { operation: "status", captureId };
  const stop = { operation: "stop", captureId };
  const unrelated = await t.ctx().programs.host.runner.start({
    workbench: t.root,
    sessionId: "ses_other",
    executable: join(t.root, "unrelated"),
    args: [],
  });
  await expect(t.control(status, "ses_other")).resolves.toMatchObject({ reason: "capture_not_found" });
  await expect(t.control(stop, "ses_other")).resolves.toMatchObject({ reason: "capture_not_found" });
  expect(child.exited).toBe(false);
  await expect(t.control(status)).resolves.toMatchObject({ status: "running" });
  const final = await t.control(stop);
  expect(final).toMatchObject({
    status: "stopped",
    manifest: { lastSegmentPartial: true, incompleteSegments: 1, rotatedOut: 1, partial: true },
  });
  const manifest = liveCaptureManifestSchema.parse(final.manifest);
  expect(manifest.segments.map((segment) => segment.sequence)).toEqual([2, 3]);
  expect(manifest.stats).toMatchObject({ dropped: null, captured: null });
  for (const { reference } of manifest.segments)
    await expect(snapshotCapture(t.ctx(), { reference }, undefined, signal)).resolves.toEqual(reference);
  expect(await t.control(stop)).toEqual(final);
  expect(unrelated.read().running).toBe(true);
  await unrelated.stop();
});

it("records short expiry and native counters in a durable manifest bound to exact retained bytes", async () => {
  const t = await rig();
  const candidate = await t.prepare(input).prepared;
  const pending = candidate?.apply(signal);
  await vi.waitFor(() => expect(t.captureProcesses()).toHaveLength(1));
  const [child] = t.captureProcesses();
  if (!child) throw Error("Missing capture process");
  await writeFile(filename(child.args), packet);
  child.print(
    `\rPackets captured: 1\nPackets received/dropped on interface 'Loopback: ${interfaceId}': 1/2 (pcap:2/dumpcap:0/flushed:0/ps_ifdrop:1) (33.3%)\n`,
    "stderr",
  );
  child.finish({ code: 0, signal: null });
  const final = await pending;
  const manifest = liveCaptureManifestSchema.parse(final?.manifest);
  expect(manifest).toMatchObject({
    status: "expired",
    reason: "duration_limit",
    partial: true,
    lastSegmentPartial: false,
    stats: { dropped: 2, interfaceDropped: 1, captured: 1 },
  });
  expect(manifest.segments).toMatchObject([{ sequence: 1, packets: 1 }]);
  const sha256 = (final?.manifestReference as { sha256: string } | undefined)?.sha256;
  expect(sha256).toMatch(/^[a-f\d]{64}$/);
  expect(
    JSON.parse(await readFile(join(t.root, ".vera", "captures", `${sha256}.provenance.json`), "utf8")),
  ).toEqual(manifest);
});

it.each([
  [200, "volume_limit"],
  [420, "capture_failed"],
] as const)(
  "publishes only PCAPNG within the declared volume when the child writes %i packets",
  async (frames, reason) => {
    const t = await rig();
    const candidate = await t.prepare({ ...input, totalBytes: 16_000 }).prepared;
    const pending = candidate?.apply(signal);
    await vi.waitFor(() => expect(t.captureProcesses()).toHaveLength(1));
    const [child] = t.captureProcesses();
    if (!child) throw Error("Missing capture process");
    await writeFile(
      filename(child.args),
      Buffer.concat([packet.subarray(0, 48), ...Array.from({ length: frames }, () => packet.subarray(48))]),
    );
    child.finish({ code: 0, signal: null });
    const manifest = liveCaptureManifestSchema.parse((await pending)?.manifest);
    expect(manifest.reason).toBe(reason);
    expect(manifest.segments).toHaveLength(frames === 200 ? 1 : 0);
    expect(manifest.lastSegmentPartial).toBe(frames !== 200);
  },
);

it("uses the usual bounds when a call gives none and runs a long capture in the background", async () => {
  const t = await rig();
  const plain = await t.prepare({ interfaceId }).prepared;
  if (plain?.request.tool !== "run_program") throw Error("Missing program approval");
  expect(plain.request.plan).toMatchObject({ limits: { durationSeconds: 30, totalBytes: 16 * 1024 * 1024 } });
  expect(plain.request.args).toEqual(expect.arrayContaining(["duration:30"]));
  const long = await t.prepare({ ...input, durationSeconds: 600 }).prepared;
  if (long?.request.tool !== "run_program") throw Error("Missing program approval");
  // Longer than a turn should wait: the call returns the capture's ID while dumpcap runs.
  const started = await long.apply(signal);
  expect(started).toMatchObject({ status: "running", captureId: expect.any(String) });
  expect(t.captureProcesses()).toHaveLength(1);
  const [child] = t.captureProcesses();
  if (!child) throw Error("Missing capture process");
  await writeFile(filename(child.args), packet);
  child.finish({ code: 0, signal: null });
  const stopped = await t.control({ operation: "stop", captureId: String(started.captureId) });
  expect(stopped).toMatchObject({ manifest: { filter: input.filter, promiscuous: true } });
});

it("counts the packets each local interface sees without keeping any", async () => {
  const t = await rig();
  const result = await t.control({ operation: "activity", seconds: 2 });
  expect(result).toMatchObject({
    tool: "dumpcap",
    seconds: 2,
    interfaces: [{ id: interfaceId, loopback: true, packets: 41, dropped: 1 }],
  });
  const [statistics] = t.host.programs.filter((process) => process.args.includes("-S"));
  expect(statistics?.args).toEqual(["-S", "-M"]);
  expect(t.captureProcesses()).toHaveLength(0);
});

it.each([
  ["ask", true],
  ["auto-edit", false],
] as const)(
  "binds the official start tool through SessionService: in %s the user decides %s",
  async (mode, asks) => {
    const t = await rig();
    const dir = join(t.root, "replay");
    await mkdir(dir);
    await writeFile(
      join(dir, "capture.jsonl"),
      [
        { toolCalls: [{ name: "wireshark_dumpcap_start", args: input }] },
        { text: "The bounded acquisition ended." },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const gateway = new ReplayGateway({ dir, now: Date.now });
    await gateway.models("replay", signal);
    const database = await openDb(join(t.root, ".vera", "vera.db"), {
      workbenchId: "wb_test",
      appVersion: "0",
    });
    scopes.push(async () => database.close());
    const ctx = t.ctx();
    const service = new SessionService({
      root: t.root,
      db: database.db,
      gateway,
      clock: { now: () => new Date(), sleep: async () => {} },
      model: () => "replay/capture",
      prompt: () => "Use the approved tools.",
      programs: ctx.programs.host,
      dumpcapPackage: ctx.liveCapture.packageSha256,
    });
    scopes.push(() => service.close());
    await service.waitReady();
    const session = service.create(null, mode);
    const pending = () =>
      service.get(session.id).snapshot.approvals.find((approval) => approval.decision === null);
    service.send(session.id, "Capture on the loopback interface.");
    if (asks) {
      await vi.waitFor(() => expect(pending()?.program).toMatchObject({ program: "dumpcap" }));
      expect(t.captureProcesses()).toHaveLength(0);
      const approval = pending();
      if (!approval) throw Error("Missing approval");
      service.decideApproval({
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
      });
    }
    await vi.waitFor(() => expect(t.captureProcesses()).toHaveLength(1));
    const [child] = t.captureProcesses();
    if (!child) throw Error("Missing capture process");
    await writeFile(filename(child.args), packet);
    child.finish({ code: 0, signal: null });
    await expect(service.waitIdle(session.id)).resolves.toMatchObject({ stopReason: "end" });
    expect(pending()).toBeUndefined();
    expect(service.get(session.id).snapshot.approvals.map((approval) => approval.by)).toEqual(
      asks ? ["user"] : expect.not.arrayContaining(["user"]),
    );
  },
);
