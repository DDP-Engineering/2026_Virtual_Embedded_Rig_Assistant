import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  dumpcapPluginId,
  type LiveCaptureFailure,
  type LiveCaptureInterface,
  type LiveCaptureManifest,
  type LiveCaptureStart,
  liveCaptureInterfaceSchema,
  liveCaptureLimits,
} from "@vera/shared";
import { z } from "zod";
import type { ProgramHost, ResolvedProgram } from "../plugins/program-tools.js";
import type { LoadedPlugin } from "../plugins/store.js";
import { CaptureError, captureProfileEnvironment } from "./native.js";

const program = "dumpcap";
const linuxInterface = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/;
const windowsInterface = /^\\Device\\NPF_(?:Loopback|\{[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\})$/i;
const jsonInventory = z
  .array(
    z.record(
      z.string(),
      z.object({
        friendly_name: z.string().nullable(),
        vendor_description: z.string().nullable(),
        loopback: z.boolean(),
        extcap: z.string(),
      }),
    ),
  )
  .max(1024);
const hints: Record<LiveCaptureFailure, string> = {
  dumpcap_missing: "Install Dumpcap from Wireshark or your Linux distribution.",
  dumpcap_version: "Use an installed Dumpcap from Wireshark 4.2 or later.",
  npcap_missing: "Dumpcap requires Npcap on Windows.",
  capture_permission: "Dumpcap cannot open the selected capture device with the current permissions.",
  interface_unavailable: "Discover and select one currently available local capture interface.",
  invalid_capture_filter:
    "Dumpcap rejected the capture filter. Use pcap filter syntax, such as host 192.168.7.10, udp port 5683 or ether host 02:00:00:00:00:01.",
  capture_startup: "Dumpcap could not start. Check the installation and the selected interface.",
  capture_failed: "Dumpcap failed while acquiring this capture.",
  capture_storage: "Live capture storage is unavailable. Check workspace access and free space.",
};

export function liveFailure(reason: LiveCaptureFailure) {
  return new CaptureError(reason, hints[reason]);
}

export function officialDumpcapPlugin({ manifest, record }: Pick<LoadedPlugin, "manifest" | "record">) {
  return manifest.id === dumpcapPluginId && record.tier === "official";
}

/** Recognize the machine-readable inventory, intersected with actual kernel devices on Linux. */
export function dumpcapInterfaces(stdout: string, platform: NodeJS.Platform, localNames?: Set<string>) {
  const interfaces = new Map<string, LiveCaptureInterface>();
  const duplicates = new Set<string>();
  for (const { id, description, loopback } of inventoryRecords(stdout)) {
    if (
      platform === "win32"
        ? !windowsInterface.test(id)
        : !linuxInterface.test(id) || !localNames?.has(id) || id === "any" || /^\d+$/.test(id)
    )
      continue;
    const key = platform === "win32" ? id.toLowerCase() : id;
    if (interfaces.delete(key) || duplicates.has(key)) {
      duplicates.add(key);
      continue;
    }
    interfaces.set(
      key,
      liveCaptureInterfaceSchema.parse({
        id,
        label:
          description
            ?.replace(/[\p{C}]/gu, "")
            .trim()
            .slice(0, 160) || id,
        loopback: loopback || /\\NPF_Loopback$/i.test(id),
      }),
    );
  }
  return [...interfaces.values()].slice(0, 48);
}

function inventoryRecords(stdout: string) {
  if (stdout.trimStart().startsWith("[")) {
    try {
      return jsonInventory.parse(JSON.parse(stdout)).flatMap((record) =>
        Object.entries(record).flatMap(([id, item]) =>
          item.extcap
            ? []
            : [
                {
                  id,
                  description: item.friendly_name || item.vendor_description,
                  loopback: item.loopback,
                },
              ],
        ),
      );
    } catch {
      throw liveFailure("capture_startup");
    }
  }
  return stdout.split(/\r?\n/).flatMap((line) => {
    const [indexed, , description, , , type, extcap] = line.split("\t");
    const id = /^\d+\. (.+)$/.exec(indexed ?? "")?.[1];
    return id && type && !extcap ? [{ id, description, loopback: type === "loopback" }] : [];
  });
}

/** The interface a call names: by its exact ID, else by the name discover lists for it. */
export function selectInterface(interfaces: readonly LiveCaptureInterface[], requested: string) {
  const wanted = requested.trim().toLowerCase();
  const exact = interfaces.find((entry) => entry.id === requested);
  if (exact) return exact;
  const named = interfaces.filter((entry) => entry.label.toLowerCase() === wanted);
  if (named.length === 1) return named[0];
  const partial = interfaces.filter((entry) => entry.label.toLowerCase().includes(wanted));
  return partial.length === 1 ? partial[0] : undefined;
}

/** Compile safe native limits before the request reaches the approval gate. */
export function liveCapturePlan(input: LiveCaptureStart): LiveCaptureManifest["limits"] {
  const { rotation } = input;
  const durationSeconds = input.durationSeconds ?? liveCaptureLimits.defaultSeconds;
  const totalBytes = input.totalBytes ?? liveCaptureLimits.defaultBytes;
  const maxSegmentBytes = rotation?.segmentBytes ?? totalBytes;
  const maxSegments = rotation
    ? Math.min(liveCaptureLimits.segments, Math.floor(totalBytes / maxSegmentBytes))
    : 1;
  if (
    rotation &&
    (rotation.segmentSeconds >= durationSeconds || maxSegments < 2 || rotation.retain > maxSegments)
  )
    throw new CaptureError(
      "invalid_capture_limits",
      "Choose a shorter rotation interval and a byte budget covering at least two segments and their requested retention.",
    );
  return {
    durationSeconds,
    totalBytes,
    maxSegmentBytes,
    maxSegments,
    snapshotBytes: liveCaptureLimits.snapshotBytes,
    packetsPerSegment: liveCaptureLimits.packetsPerSegment,
    rotation: rotation ?? null,
  };
}

export const captureBaseName = "segment.pcapng";
export const closeReceiptName = "closed.txt";

export function dumpcapArgs(
  interfaceId: string,
  filter: string | null,
  limits: LiveCaptureManifest["limits"],
  output: string,
  receipt: string,
  promiscuous = true,
) {
  const kb = Math.floor((limits.maxSegmentBytes - liveCaptureLimits.segmentReserveBytes) / 1000);
  return [
    "-q",
    ...(promiscuous ? [] : ["-p"]),
    "-s",
    String(limits.snapshotBytes),
    "-i",
    interfaceId,
    ...(filter ? ["-f", filter] : []),
    "-a",
    `duration:${limits.durationSeconds}`,
    "-w",
    output,
    ...(limits.rotation
      ? [
          "-b",
          `duration:${limits.rotation.segmentSeconds}`,
          "-b",
          `filesize:${kb}`,
          "-b",
          `packets:${limits.packetsPerSegment}`,
          "-a",
          `files:${limits.maxSegments}`,
          "-b",
          `files:${Math.min(limits.maxSegments, limits.rotation.retain + 1)}`,
          "-b",
          `printname:${receipt}`,
        ]
      : ["-a", `filesize:${kb}`, "-c", String(limits.packetsPerSegment)]),
  ];
}

export function diagnoseDumpcap(output: string, fallback: LiveCaptureFailure): LiveCaptureFailure {
  if (
    /unable to load (?:npcap|winpcap)|(?:npcap|wpcap\.dll).*(?:must be installed|not found|missing)/i.test(
      output,
    )
  )
    return "npcap_missing";
  if (
    /permission denied|operation not permitted|permission to capture|access is denied|access denied|administrative privileges/i.test(
      output,
    )
  )
    return "capture_permission";
  if (
    /no (?:such )?(?:capture )?(?:device|interface)|unknown interface|there are no interfaces|(?:interface|device) .*?(?:does not exist|is down|is not up|not found)|network adapter .*?is no longer (?:running|attached)/i.test(
      output,
    )
  )
    return "interface_unavailable";
  if (
    /invalid capture filter|can't parse filter expression|syntax error|unable to parse filter/i.test(output)
  )
    return "invalid_capture_filter";
  return fallback;
}

async function probe(
  host: ProgramHost,
  resolved: ResolvedProgram,
  folder: string,
  args: string[],
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
  try {
    return await host.runner.captureOutput({
      executable: resolved.executable,
      args,
      cwd: folder,
      env: { ...resolved.env, ...captureProfileEnvironment(folder) },
      maxBytes: 64 * 1024,
      signal: bounded,
    });
  } catch {
    signal.throwIfAborted();
    throw liveFailure("capture_startup");
  }
}

export async function dumpcapInventory(
  host: ProgramHost,
  plugin: LoadedPlugin,
  folder: string,
  signal: AbortSignal,
) {
  const resolved = await host.resolver.resolve(plugin, program, signal);
  if (!resolved || !isAbsolute(resolved.executable) || resolved.launcher || resolved.prefix?.length)
    throw liveFailure("dumpcap_missing");
  const versionProbe = await probe(host, resolved, folder, ["--version"], signal);
  const version = /^Dumpcap \(Wireshark\) (\d{1,4}\.\d{1,4}\.\d{1,4})\b/.exec(versionProbe.stdout)?.[1];
  if (versionProbe.exit.error) throw liveFailure("capture_startup");
  const [major = 0, minor = 0] = version?.split(".").map(Number) ?? [];
  if (
    versionProbe.exceeded ||
    versionProbe.exit.code !== 0 ||
    !version ||
    major < 4 ||
    (major === 4 && minor < 2)
  )
    throw liveFailure("dumpcap_version");
  const listed = await probe(host, resolved, folder, ["-D", "-M"], signal);
  if (listed.exceeded || listed.exit.error) throw liveFailure("capture_startup");
  if (listed.exit.code !== 0)
    throw liveFailure(diagnoseDumpcap(`${listed.stderr}\n${listed.stdout}`, "capture_startup"));
  const platform = process.platform;
  const localNames =
    platform === "linux"
      ? new Set(
          (await readFile("/proc/net/dev", { encoding: "utf8", signal })).split("\n").flatMap((line) => {
            const match = /^\s*([^\s:]+):/.exec(line);
            return match?.[1] ? [match[1]] : [];
          }),
        )
      : undefined;
  return { resolved, version, interfaces: dumpcapInterfaces(listed.stdout, platform, localNames) };
}

export async function compileDumpcapFilter(
  host: ProgramHost,
  resolved: ResolvedProgram,
  folder: string,
  interfaceId: string,
  filter: string,
  signal: AbortSignal,
) {
  const compiled = await probe(host, resolved, folder, ["-i", interfaceId, "-p", "-f", filter, "-d"], signal);
  if (compiled.exceeded || compiled.exit.error) throw liveFailure("capture_startup");
  const diagnostic = diagnoseDumpcap(`${compiled.stderr}\n${compiled.stdout}`, "capture_startup");
  if (diagnostic !== "capture_startup" || compiled.exit.code !== 0 || !/^\(000\)\s+\S/m.test(compiled.stdout))
    throw liveFailure(diagnostic);
}

/**
 * Packets seen on each interface during a few seconds, from dumpcap's statistics mode (`-S -M`: one line per
 * interface every second with its running packet and drop counts). No packet is read or kept.
 */
export async function dumpcapActivity(
  host: ProgramHost,
  resolved: ResolvedProgram,
  folder: string,
  seconds: number,
  signal: AbortSignal,
) {
  let listed: Awaited<ReturnType<ProgramHost["runner"]["captureOutput"]>>;
  try {
    listed = await host.runner.captureOutput({
      executable: resolved.executable,
      args: ["-S", "-M"],
      cwd: folder,
      env: { ...resolved.env, ...captureProfileEnvironment(folder) },
      maxBytes: 1024 * 1024,
      signal,
      stopAfterMs: seconds * 1000,
    });
  } catch {
    signal.throwIfAborted();
    throw liveFailure("capture_startup");
  }
  const counts = new Map<string, { packets: number; dropped: number }>();
  for (const line of listed.stdout.split(/\r?\n/)) {
    const [id, packets, dropped] = line.split("\t");
    if (id && /^\d{1,15}$/.test(packets ?? "") && /^\d{1,15}$/.test(dropped ?? ""))
      counts.set(id, { packets: Number(packets), dropped: Number(dropped) });
  }
  if (!counts.size)
    throw liveFailure(diagnoseDumpcap(`${listed.stderr}\n${listed.stdout}`, "capture_startup"));
  return counts;
}
