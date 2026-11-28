import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  capturePacketSchema,
  type LiveCaptureStart,
  liveCaptureManifestSchema,
  validatePluginManifest,
} from "@vera/shared";
import { parse } from "yaml";
import { requestSha256 } from "../../src/libraries/core/src/agent/approvals.js";
import { NodeProcessHost } from "../../src/libraries/core/src/plugins/node-process-host.js";
import { ProgramSession } from "../../src/libraries/core/src/plugins/program-tools.js";
import { ProgramRunner } from "../../src/libraries/core/src/plugins/runner.js";
import type { LoadedPlugin } from "../../src/libraries/core/src/plugins/store.js";
import { createToolContext } from "../../src/libraries/core/src/tools/context.js";
import {
  wiresharkDumpcapStartTool,
  wiresharkDumpcapTool,
} from "../../src/libraries/core/src/tools/wireshark-live.js";
import { LiveCaptureSessions } from "../../src/libraries/core/src/wireshark/live-session.js";
import { inspectWireshark } from "../../src/libraries/core/src/wireshark/service.js";
import { WriteQueue } from "../../src/libraries/core/src/workbench/write-queue.js";

type NativeOptions = {
  pluginRoot: string;
  dumpcap: string;
  tshark?: string;
  interfaceId?: string;
  env?: Readonly<Record<string, string>>;
  evidenceDir?: string;
};

async function loadFixture(pluginRoot: string, id: string): Promise<LoadedPlugin> {
  const folder = join(pluginRoot, id);
  const bytes = await readFile(join(folder, "plugin.yaml"));
  const result = validatePluginManifest(parse(bytes.toString("utf8")));
  assert(result.manifest, JSON.stringify(result.issues));
  return {
    folder,
    manifest: result.manifest,
    record: {
      format: 1,
      id,
      version: result.manifest.version,
      tier: "official",
      source: { kind: "folder", path: folder },
      installedAt: new Date(0).toISOString(),
      programs: {},
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

async function nativeRig(options: NativeOptions) {
  assert(isAbsolute(options.dumpcap));
  if (options.tshark) assert(isAbsolute(options.tshark));
  const [dumpcap, tshark] = await Promise.all([
    loadFixture(options.pluginRoot, "wireshark-dumpcap"),
    loadFixture(options.pluginRoot, "wireshark-tshark"),
  ]);
  const folder = await realpath(await mkdtemp(join(tmpdir(), "vera-dumpcap-native-")));
  const host = new NodeProcessHost(spawn);
  const runner = new ProgramRunner({ host, clock: { sleep }, killGraceMs: 250 });
  const sessions = new LiveCaptureSessions();
  const root = join(folder, "bench");
  await mkdir(join(root, ".vera"), { recursive: true });
  let tsharkVersion: string | undefined;
  if (options.tshark) {
    const probe = await runner.captureOutput({
      executable: options.tshark,
      args: ["--version"],
      cwd: folder,
      env: {},
      maxBytes: 16_384,
      signal: AbortSignal.timeout(4000),
    });
    tsharkVersion = /^TShark \(Wireshark\) (\d+\.\d+\.\d+)\b/.exec(probe.stdout)?.[1];
    assert(
      probe.exit.code === 0 && tsharkVersion,
      JSON.stringify({ exit: probe.exit, stdout: probe.stdout.slice(0, 200), stderr: probe.stderr }),
    );
  }
  const paths = new Map([
    ["dumpcap", options.dumpcap],
    ["tshark", options.tshark],
  ]);
  const ctx = {
    ...createToolContext(root),
    wiresharkPackage: tshark.record.sha256,
    liveCapture: {
      sessions,
      packageSha256: dumpcap.record.sha256,
      access: { queue: new WriteQueue(), assertWritable() {} },
    },
    programs: {
      sessionId: "ses_native_capture",
      session: new ProgramSession(),
      host: {
        clock: { sleep },
        runner,
        plugins: async () => [dumpcap, tshark],
        resolver: {
          async resolve(_plugin: LoadedPlugin, program: string) {
            const executable = paths.get(program);
            if (!executable) return undefined;
            return program === "tshark"
              ? { executable, version: tsharkVersion }
              : { executable, env: options.env };
          },
        },
      },
    },
  };
  const signal = AbortSignal.timeout(26_000);
  const control = (args: unknown) => wiresharkDumpcapTool.execute(ctx, args, signal);
  const close = async () => {
    await sessions.stopOwner();
    await runner.stopAll();
    await rm(folder, { force: true, recursive: true });
  };
  return { ctx, signal, control, close };
}

export async function nativeDumpcapInventory(options: NativeOptions) {
  const rig = await nativeRig(options);
  try {
    return await rig.control({ operation: "discover" });
  } finally {
    await rig.close();
  }
}

/** Packet counts per interface from the installed Dumpcap's statistics mode; no packet is read. */
export async function nativeDumpcapActivity(options: NativeOptions) {
  const rig = await nativeRig(options);
  try {
    return await rig.control({ operation: "activity", seconds: 2 });
  } finally {
    await rig.close();
  }
}

/** Opt-in proof with real Dumpcap and TShark, confined to bounded UDP traffic on loopback. */
export async function proveNativeDumpcap(options: NativeOptions) {
  const interfaceId = options.interfaceId;
  assert(interfaceId === (process.platform === "win32" ? "\\Device\\NPF_Loopback" : "lo"));
  assert(options.tshark);
  const rig = await nativeRig(options);
  const receiver = createSocket("udp4");
  const sender = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      receiver.once("error", reject);
      receiver.bind(0, "127.0.0.1", resolve);
    });
    const port = receiver.address().port;
    const filter = `udp and src host 127.0.0.1 and dst host 127.0.0.1 and dst port ${port}`;
    const inventory = await rig.control({ operation: "discover" });
    assert(
      Array.isArray(inventory.interfaces) &&
        inventory.interfaces.some((row) => row.id === interfaceId && row.loopback),
      JSON.stringify(inventory),
    );
    async function capture(input: LiveCaptureStart, callId: string) {
      let approved = "";
      const prepared = await wiresharkDumpcapStartTool.prepare?.(
        {
          ...rig.ctx,
          programs: {
            ...rig.ctx.programs,
            callId,
            turnId: "native",
            consume(request) {
              assert.equal(requestSha256(request), approved);
            },
          },
        },
        input,
        rig.signal,
      );
      assert(prepared?.request.tool === "run_program" && prepared.request.risk === "device-read");
      approved = requestSha256(prepared.request);
      return prepared.apply(rig.signal);
    }
    async function sendSynthetic(count: number, active = () => true) {
      for (let index = 0; index < count && active(); index++) {
        await sleep(65, undefined, { signal: rig.signal });
        const data = Buffer.from(`VERA-Dumpcap-lab-${index}`);
        await new Promise<void>((resolve, reject) =>
          sender.send(data, port, "127.0.0.1", (error) => (error ? reject(error) : resolve())),
        );
      }
    }
    async function assertReadable(result: Record<string, unknown>, kind: "short" | "rolling") {
      assert(result.manifest, JSON.stringify(result));
      const manifest = liveCaptureManifestSchema.parse(result.manifest);
      assert(
        manifest.segments.some((segment) => segment.packets > 0),
        JSON.stringify(manifest),
      );
      for (const { reference, packets } of manifest.segments) {
        const inspection = await inspectWireshark(
          rig.ctx,
          { operation: "query", source: { reference }, fields: ["udp.dstport"], limit: 3 },
          rig.signal,
        );
        assert("capture" in inspection && "packets" in inspection);
        assert.deepEqual(inspection.capture, reference);
        const found = capturePacketSchema.array().parse(inspection.packets);
        assert.equal(found.length, Math.min(packets, 3));
        for (const packet of found) assert.deepEqual(packet.fields["udp.dstport"], [String(port)]);
      }
      const reference = result.manifestReference as { sha256: string; bytes: number };
      const bytes = await readFile(
        join(rig.ctx.root, ".vera", "captures", `${reference.sha256}.provenance.json`),
      );
      assert.equal(bytes.length, reference.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), reference.sha256);
      assert.deepEqual(JSON.parse(bytes.toString()), manifest);
      if (options.evidenceDir) {
        assert(isAbsolute(options.evidenceDir));
        const output = join(options.evidenceDir, kind);
        await mkdir(output, { recursive: true });
        await writeFile(join(output, "manifest.json"), bytes);
        assert(typeof result.runId === "string");
        await copyFile(join(rig.ctx.root, ".vera", "runs", `${result.runId}.log`), join(output, "run.log"));
        for (const { sequence, reference: capture } of manifest.segments) {
          await copyFile(
            join(rig.ctx.root, ".vera", "captures", `${capture.sha256}.pcapng`),
            join(output, `segment-${sequence}.pcapng`),
          );
        }
      }
      return manifest;
    }
    const shortInput = { interfaceId, filter, durationSeconds: 2, totalBytes: 128_000 };
    let shortActive = true;
    const shortCapture = capture(shortInput, "short").finally(() => {
      shortActive = false;
    });
    // Start sending during preparation and keep sending through the kernel capture window.
    const [short] = await Promise.all([shortCapture, sendSynthetic(400, () => shortActive)]);
    const shortManifest = await assertReadable(short, "short");
    assert.equal(shortManifest.status, "expired");
    assert.equal(shortManifest.lastSegmentPartial, false);
    const rolling = await capture(
      {
        ...shortInput,
        durationSeconds: 8,
        totalBytes: 192_000,
        rotation: { segmentSeconds: 1, segmentBytes: 24_000, retain: 2 },
      },
      "rolling",
    );
    assert.equal(rolling.status, "running");
    await sendSynthetic(57);
    const stopped = await rig.control({ operation: "stop", captureId: rolling.captureId });
    const rollingManifest = await assertReadable(stopped, "rolling");
    assert.equal(rollingManifest.status, "stopped");
    assert(rollingManifest.rotatedOut >= 1);
    assert.equal(rollingManifest.segments.length, 2);
    return { inventory, short: shortManifest, rolling: rollingManifest };
  } finally {
    receiver.close();
    sender.close();
    await rig.close();
  }
}
