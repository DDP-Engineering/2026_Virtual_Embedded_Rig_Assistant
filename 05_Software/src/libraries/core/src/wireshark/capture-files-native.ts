import { unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import {
  type CaptureReference,
  captureFileLimits,
  type DeriveCaptureArgs,
  hexdumpImportLimits,
} from "@vera/shared";
import { z } from "zod";
import type { ProgramHost } from "../plugins/program-tools.js";
import type { LoadedPlugin } from "../plugins/store.js";
import { CaptureError, captureProfileEnvironment } from "./native.js";

const tools = ["capinfos", "editcap", "mergecap", "text2pcap", "tshark"] as const;
export type FileProgram = (typeof tools)[number];
type NativeProgram = { executable: string; version: string };
type NativePrograms = Partial<Record<FileProgram, NativeProgram>>;
type Operation = DeriveCaptureArgs["operation"] | "file_metadata";

const programsByOperation = {
  file_metadata: ["capinfos"],
  select: ["editcap"],
  split: ["editcap"],
  merge: ["mergecap", "editcap"],
  convert: ["editcap"],
  reorder: ["editcap", "mergecap"],
  deduplicate: ["editcap"],
  clean: ["editcap"],
  export_fields: ["tshark"],
  export_pdus: ["tshark"],
  export_objects: ["tshark"],
  import_hexdump: ["text2pcap"],
} as const satisfies Record<Operation, readonly FileProgram[]>;

type PduTap = Extract<DeriveCaptureArgs, { operation: "export_pdus" }>["tap"];
export const pduTaps: Record<PduTap, string> = {
  ethernet: "Ethernet",
  ip: "IP",
  osi3: "OSI layer 3",
  osi4: "OSI layer 4",
  osi7: "OSI layer 7",
};

export function httpObjectArguments(path: string) {
  return [
    "-n",
    "-r",
    basename(path),
    "-o",
    "http.decompress_body:FALSE",
    "-Y",
    "http.file_data",
    "-T",
    "json",
    "-e",
    "frame.number",
    "-e",
    "http.file_data",
    "-e",
    "http.content_length",
    "-e",
    "http.content_encoding",
    "-e",
    "http.transfer_encoding",
  ];
}

export const cleanOptions = {
  capture_comments: "--discard-capture-comment",
  packet_comments: "--discard-packet-comments",
  secrets: "--discard-all-secrets",
} as const;

export function fileProgramsFor(
  args: DeriveCaptureArgs | { operation: "file_metadata" },
): readonly FileProgram[] {
  return args.operation === "select" && args.selection.kind === "filter"
    ? ["editcap", "tshark"]
    : programsByOperation[args.operation];
}

function resolution(
  program: Awaited<ReturnType<ProgramHost["resolver"]["resolve"]>>,
): NativeProgram | undefined {
  if (
    program &&
    isAbsolute(program.executable) &&
    !program.launcher &&
    !program.prefix?.length &&
    !Object.keys(program.env ?? {}).length &&
    program.version &&
    /^\d+\.\d+\.\d+$/.test(program.version)
  )
    return { executable: program.executable, version: program.version };
  return undefined;
}

export async function resolveFilePrograms(
  host: ProgramHost,
  plugin: LoadedPlugin,
  names: readonly FileProgram[],
  signal: AbortSignal,
): Promise<NativePrograms> {
  if (process.getuid?.() === 0) return {};
  const found = await Promise.all(
    names.map(async (name) => {
      try {
        return [name, resolution(await host.resolver.resolve(plugin, name, signal))] as const;
      } catch {
        signal.throwIfAborted();
        return [name, undefined] as const;
      }
    }),
  );
  return Object.fromEntries(found);
}

export function fileUtilityCapabilities(
  programs: NativePrograms,
  features: { clean: boolean; taps: string[]; httpObjects: boolean },
  writable: boolean,
) {
  const readiness = (names: readonly FileProgram[], write = true, supported = true) => {
    const missing = names.filter((name) => !programs[name]);
    if (missing.length) return { available: false, missing, reason: "utility_unavailable" };
    if (!supported) return { available: false, reason: "utility_feature_unavailable" };
    if (write && !writable) return { available: false, reason: "storage_read_only" };
    return { available: true };
  };
  return {
    utilities: Object.fromEntries(
      tools.map((name) => [
        name,
        programs[name] ? { available: true, version: programs[name].version } : { available: false },
      ]),
    ),
    fileOperations: {
      metadata: readiness(programsByOperation.file_metadata, false),
      lineage: { available: true },
      select: readiness(programsByOperation.select),
      selectFilter: readiness(["editcap", "tshark"]),
      split: readiness(programsByOperation.split),
      merge: readiness(programsByOperation.merge),
      convert: readiness(programsByOperation.convert),
      reorder: readiness(programsByOperation.reorder),
      deduplicate: readiness(programsByOperation.deduplicate),
      clean: readiness(programsByOperation.clean, true, features.clean),
      exportFields: readiness(programsByOperation.export_fields),
      exportPdus: {
        ...readiness(programsByOperation.export_pdus, true, features.taps.length > 0),
        taps: features.taps,
      },
      exportObjects: {
        ...readiness(programsByOperation.export_objects, true, features.httpObjects),
        protocols: features.httpObjects ? ["http"] : [],
      },
      importHexdump: readiness(programsByOperation.import_hexdump),
    },
    fileLimits: captureFileLimits,
    hexdumpLimits: hexdumpImportLimits,
  };
}

const metadataValue = z.strictObject({
  fileType: z.enum(["pcapng", "pcap", "nsecpcap"]),
  encapsulation: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\w.-]+$/),
  packets: z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export class CaptureFileNative {
  readonly versions: Partial<Record<FileProgram, string>> = {};
  private stagedBytes = 0;
  private intermediateBytes = 0;
  private fileCount = 0;

  constructor(
    private readonly runner: ProgramHost["runner"],
    private readonly programs: NativePrograms,
    readonly folder: string,
    readonly signal: AbortSignal,
    private readonly outputBytes: number = captureFileLimits.outputBytes,
  ) {}

  require(name: FileProgram) {
    const program = this.programs[name];
    if (!program) {
      throw new CaptureError(
        "utility_unavailable",
        `Install or update the external ${name} utility and check the Wireshark plugin dependencies.`,
      );
    }
    this.versions[name] = program.version;
    return program;
  }

  private request(name: FileProgram, args: string[], maxBytes: number) {
    return {
      executable: this.require(name).executable,
      args,
      maxBytes,
      cwd: this.folder,
      signal: this.signal,
      env: captureProfileEnvironment(this.folder),
    };
  }

  async canClean() {
    if (!this.programs.editcap) return false;
    const result = await this.probe("editcap", ["--help"]);
    return (
      result?.exit.code === 0 &&
      Object.values(cleanOptions).every((flag) => (result.stdout + result.stderr).includes(flag))
    );
  }

  private async probe(name: FileProgram, args: string[]) {
    try {
      const request = this.request(name, args, 32 * 1024);
      const result = await this.runner.captureOutput({
        ...request,
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(3000)]),
      });
      return result.exceeded ? undefined : result;
    } catch {
      this.signal.throwIfAborted();
      return undefined;
    }
  }

  async features() {
    const [clean, pdu, http] = await Promise.all([
      this.canClean(),
      this.programs.tshark
        ? this.probe("tshark", ["-n", "-r", "empty.pcap", "-U", "help", "-w", "-"])
        : undefined,
      this.programs.tshark ? this.probe("tshark", httpObjectArguments("empty.pcap")) : undefined,
    ]);
    const taps = Object.entries(pduTaps)
      .filter(([, tap]) =>
        pdu?.stderr.split(/\r?\n/).some((line) => line.trimStart().startsWith(`${tap} - `)),
      )
      .map(([key]) => key);
    return { clean, taps, httpObjects: http?.exit.code === 0 && /^\s*\[\s*\]\s*$/.test(http.stdout) };
  }

  async text(name: FileProgram, args: string[], maxBytes: number) {
    const result = await this.runner.captureOutput(this.request(name, args, maxBytes));
    if (result.exceeded)
      throw new CaptureError("native_output_limit", "Native output exceeded the host bound.");
    if (result.exit.code !== 0)
      throw new CaptureError(
        "capture_utility_failed",
        `${name} could not read or process the capture. Check the file and installed version.`,
      );
    return result.stdout;
  }

  async metadata(path: string, reference: CaptureReference, packets: number) {
    const text = await this.text("capinfos", ["-tEcHMLKP", basename(path)], 16 * 1024);
    const read = (key: string) => {
      const rows = text.split(/\r?\n/).filter((line) => line.startsWith(`${key}:`));
      return rows.length === 1 ? rows[0]?.slice(key.length + 1).trim() : undefined;
    };
    const parsed = metadataValue.safeParse({
      fileType: read("File type"),
      encapsulation: read("File encapsulation"),
      packets: read("Number of packets"),
      sha256: read("SHA256"),
    });
    if (
      !parsed.success ||
      parsed.data.packets !== packets ||
      parsed.data.sha256 !== reference.sha256 ||
      (parsed.data.fileType === "pcapng" ? "pcapng" : "pcap") !== reference.fileFormat
    ) {
      throw new CaptureError(
        "native_output_invalid",
        "Capinfos output disagrees with the saved capture or is unsupported.",
      );
    }
    return parsed.data.encapsulation === "unknown" ? null : parsed.data.encapsulation;
  }

  async capture(name: FileProgram, args: string[], intermediate = false) {
    const remaining = intermediate
      ? 2 * this.outputBytes - this.intermediateBytes
      : this.outputBytes - this.stagedBytes;
    if (remaining <= 0) throw this.outputLimit();
    const limit = Math.min(remaining, this.outputBytes);
    const result = await this.runner.captureBytes(this.request(name, args, limit));
    if (result.stdout.length > limit || (result.exceeded && result.stdout.length === limit))
      throw this.outputLimit();
    if (result.exceeded || result.exit.code !== 0)
      throw new CaptureError(
        "capture_utility_failed",
        `${name} could not write this capture. Check the format, encapsulation and installed version.`,
      );
    const bytes = result.stdout;
    const path = join(this.folder, `derived-${++this.fileCount}.capture`);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    if (intermediate) this.intermediateBytes += bytes.length;
    else this.stagedBytes += bytes.length;
    this.signal.throwIfAborted();
    return { bytes, path };
  }

  async discardIntermediate(paths: { path: string; size: number }[]) {
    for (const { path, size } of paths) {
      await unlink(path);
      this.intermediateBytes -= size;
    }
  }

  outputLimit() {
    return new CaptureError(
      "capture_output_limit",
      "Derived output exceeds the host byte budget. Use a smaller selection.",
    );
  }
}
