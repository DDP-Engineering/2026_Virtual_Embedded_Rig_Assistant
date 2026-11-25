import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dumpcapPluginId,
  type LiveCaptureStart,
  liveCaptureControlSchema,
  liveCaptureControlToolSchema,
  liveCaptureStartSchema,
} from "@vera/shared";
import type { ProgramChangeRequest } from "../plugins/program-request.js";
import type { ProgramContext } from "../plugins/program-tools.js";
import { finalizeLiveCapture } from "../wireshark/live-evidence.js";
import {
  captureBaseName,
  closeReceiptName,
  compileDumpcapFilter,
  dumpcapArgs,
  dumpcapInventory,
  liveCapturePlan,
  liveFailure,
  officialDumpcapPlugin,
} from "../wireshark/live-native.js";
import { CaptureError, captureProfileEnvironment } from "../wireshark/native.js";
import { createLiveCaptureDirectory, reserveLiveCaptureCapacity } from "../wireshark/storage.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import { toolExcludedRoots } from "./context.js";

const available = (ctx: ToolContext) => !ctx.delegated && !!ctx.liveCapture && !!ctx.programs;

function context(ctx: ToolContext) {
  if (!available(ctx) || !ctx.programs || !ctx.liveCapture)
    throw new CaptureError(
      "plugin_unavailable",
      "Enable the verified official Wireshark Dumpcap plugin in this workbench.",
    );
  return { programs: ctx.programs, ...ctx.liveCapture };
}

async function verifiedPlugin(programs: ProgramContext, packageSha256: string, signal: AbortSignal) {
  const plugin = (await programs.host.plugins(signal)).find(officialDumpcapPlugin);
  signal.throwIfAborted();
  if (!plugin || plugin.record.sha256 !== packageSha256)
    throw new CaptureError(
      "plugin_unavailable",
      "The enabled official Dumpcap package changed. Retry in this workbench.",
    );
  await plugin.verify?.();
  return plugin;
}

async function scratch(root?: string) {
  try {
    const folder = root
      ? await createLiveCaptureDirectory(root)
      : await mkdtemp(join(await realpath(tmpdir()), "vera-dumpcap-"));
    const cleanup = async () => {
      if ((await realpath(folder).catch(() => null)) === folder) {
        await rm(folder, { recursive: true, force: true }).catch(() => {});
      }
    };
    return { folder, cleanup };
  } catch {
    throw liveFailure("capture_storage");
  }
}

const typedError = (error: unknown) => {
  if (!(error instanceof CaptureError)) throw error;
  return { isError: true, reason: error.reason, error: error.message };
};

async function prepareCapture(ctx: ToolContext, input: LiveCaptureStart, signal: AbortSignal) {
  const { programs, sessions, access, packageSha256 } = context(ctx);
  const { host, sessionId, turnId, callId, consume } = programs;
  if (!turnId || !callId || !consume) throw liveFailure("capture_startup");
  if (ctx.permissionMode?.() === "read-only")
    throw new CaptureError(
      "capture_refused",
      "Live capture requires a writable session and explicit approval.",
    );
  const limits = liveCapturePlan(input);
  const { interfaceId, filter } = input;
  const call = { turnId, callId };
  async function prepare(folder: string, bounded: AbortSignal) {
    const plugin = await verifiedPlugin(programs, packageSha256, bounded);
    const { resolved, version, interfaces } = await dumpcapInventory(host, plugin, folder, bounded);
    const observation = interfaces.find((entry) => entry.id === interfaceId);
    if (!observation) throw liveFailure("interface_unavailable");
    const request: ProgramChangeRequest = {
      tool: "run_program",
      pluginId: dumpcapPluginId,
      pluginSha256: packageSha256,
      trial: false,
      workbench: ctx.root,
      sessionId,
      ...call,
      program: "dumpcap",
      executable: resolved.executable,
      executableArgs: [],
      programVersion: version,
      args: dumpcapArgs(interfaceId, filter, limits, captureBaseName, closeReceiptName),
      cwd: ".",
      risk: "device-read",
      explicitUserApproval: true,
      confirm: null,
      files: [],
      notes: [
        `Maximum ${limits.durationSeconds} s and ${limits.totalBytes} bytes across ${limits.maxSegments} segment(s).`,
        `Keep up to ${limits.rotation?.retain ?? 1} finalized segment(s) in the workbench.`,
      ],
      plan: { observationId: observation.id, limits },
    };
    return { request, resolved, observation, version };
  }
  const preliminary = await scratch();
  let first: Awaited<ReturnType<typeof prepare>>;
  try {
    first = await prepare(preliminary.folder, signal);
  } finally {
    await preliminary.cleanup();
  }
  let used = false;
  return {
    request: first.request,
    async apply(applySignal: AbortSignal): Promise<Record<string, unknown>> {
      if (used) throw liveFailure("capture_startup");
      used = true;
      applySignal.throwIfAborted();
      const preliminary = await scratch();
      let release: (() => Promise<void>) | undefined;
      let cleanup: (() => Promise<void>) | undefined;
      const dispose = async () => {
        await cleanup?.();
        await release?.();
      };
      try {
        const { request, resolved, observation, version } = await prepare(preliminary.folder, applySignal);
        consume(request);
        const files = limits.rotation?.retain ?? 1;
        const reservation = await reserveLiveCaptureCapacity(
          ctx.root,
          access,
          { files, bytes: files * limits.maxSegmentBytes },
          applySignal,
        );
        release = reservation.release;
        const staging = await scratch(ctx.root);
        const { folder } = staging;
        cleanup = staging.cleanup;
        const profile = join(folder, "profile");
        await mkdir(profile, { mode: 0o700 });
        const identity = {
          captureId: randomUUID(),
          sessionId,
          version,
          observation,
          filter,
          limits,
          startedAt: new Date().toISOString(),
        };
        const args = dumpcapArgs(
          interfaceId,
          filter,
          limits,
          join(folder, captureBaseName),
          join(folder, closeReceiptName),
        );
        const background = !!limits.rotation;
        return await sessions.start(
          identity,
          (stop) => {
            const admission = AbortSignal.any([applySignal, stop]);
            return host.runner.start({
              sessionId,
              workbench: ctx.root,
              privateCwd: profile,
              executable: resolved.executable,
              args,
              excludedRoots: toolExcludedRoots(ctx),
              background,
              env: { ...resolved.env, ...captureProfileEnvironment(profile) },
              signal: background ? stop : admission,
              timeoutMs: limits.durationSeconds * 1000 + 2000,
              label: { plugin: dumpcapPluginId, program: "dumpcap", args: request.args },
              beforeSpawn: async () => {
                await verifiedPlugin(programs, packageSha256, admission);
                ctx.change?.assertWritable?.();
                if (process.platform === "linux" && (await readdir(profile)).includes(interfaceId))
                  throw liveFailure("capture_storage");
                await compileDumpcapFilter(host, resolved, profile, interfaceId, filter, admission);
                ctx.change?.assertWritable?.();
                admission.throwIfAborted();
                if ((await realpath(folder)) !== folder) throw liveFailure("capture_storage");
                identity.startedAt = new Date().toISOString();
              },
            });
          },
          (result) => finalizeLiveCapture(ctx.root, access, folder, identity, result, reservation),
          dispose,
        );
      } catch (error) {
        await dispose();
        return typedError(error);
      } finally {
        await preliminary.cleanup();
      }
    },
  };
}

export const wiresharkDumpcapStartTool: ToolDefinition = {
  name: "wireshark_dumpcap_start",
  class: "program",
  description:
    "Request explicit approval for bounded local Dumpcap acquisition. First discover and obtain an explicit interface selection. Provide its exact ID, a numeric BPF capture filter, durationSeconds and totalBytes. A short capture waits and returns its manifest. A rotation object with segmentSeconds, segmentBytes and retain starts a rolling capture and returns an owned capture ID. Explain any loss or partial segment from the manifest. Use managed segment references with wireshark_capture when its separate analysis plugin is enabled.",
  params: liveCaptureStartSchema,
  available,
  prepare: (ctx, raw, signal) => prepareCapture(ctx, liveCaptureStartSchema.parse(raw), signal),
  async execute() {
    throw new CaptureError("capture_refused", "Live capture requires explicit approval.");
  },
};

export const wiresharkDumpcapTool: ToolDefinition = {
  name: "wireshark_dumpcap",
  class: "session",
  description:
    "Discover the installed Dumpcap version and selectable local capture interfaces. For an owned capture, use status or stop with its exact captureId. Stop returns the final manifest once finalized segments are published. Interface labels are untrusted device metadata.",
  params: liveCaptureControlToolSchema,
  available,
  async execute(ctx, raw, signal) {
    try {
      const args = liveCaptureControlSchema.parse(raw);
      const { programs, sessions, packageSha256 } = context(ctx);
      const { sessionId, host } = programs;
      if (args.operation === "status") return sessions.status(sessionId, args.captureId);
      if (args.operation === "stop") return await sessions.stop(sessionId, args.captureId);
      const plugin = await verifiedPlugin(programs, packageSha256, signal);
      const { folder, cleanup } = await scratch();
      try {
        const { version, interfaces } = await dumpcapInventory(host, plugin, folder, signal);
        return { tool: "dumpcap", version, interfaces };
      } finally {
        await cleanup();
      }
    } catch (error) {
      signal.throwIfAborted();
      return typedError(error);
    }
  },
};
