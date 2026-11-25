import { join } from "node:path";
import {
  type CaptureAnalysis,
  type CapturePacket,
  captureFrameReferenceSchema,
  captureLimits,
  capturePacketSchema,
  type WiresharkCaptureArgs,
} from "@vera/shared";
import { z } from "zod";
import type { ProgramRunner } from "../plugins/runner.js";
import { automotiveFields } from "./automotive-fields.js";

export class CaptureError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

export const defaultFields = [
  "frame.len",
  "frame.protocols",
  "ip.src",
  "ip.dst",
  "tcp.srcport",
  "tcp.dstport",
  "udp.srcport",
  "udp.dstport",
];
const details = [
  ...defaultFields,
  "frame.cap_len",
  "eth.src",
  "eth.dst",
  "eth.type",
  "vlan.id",
  "ip.proto",
  "ip.ttl",
  "ipv6.src",
  "ipv6.dst",
  "ipv6.nxt",
  "tcp.flags",
  "tcp.stream",
  "udp.stream",
  "udp.length",
  "icmp.type",
  "icmp.code",
  "arp.opcode",
  "dns.id",
  "dns.flags.response",
  "dns.qry.name",
  "dns.qry.type",
  "http.request.method",
  "http.response.code",
  "tls.handshake.type",
  "coap.code",
  "coap.type",
  "coap.mid",
  "coap.opt.uri_path_recon",
  "mbtcp.trans_id",
  "modbus.func_code",
  "modbus.regval_uint16",
];
const selectable = new Set([...details, ...automotiveFields]);
const intrinsic = ["frame.number", "frame.interface_id", "frame.time_epoch", "frame.len", "frame.cap_len"];
export const emptyPcap = Buffer.from("d4c3b2a1020004000000000000000000ffff000001000000", "hex");
const filterFields = new Set([
  ...selectable,
  ...intrinsic,
  "ip.addr",
  "ipv6.addr",
  "eth.addr",
  "udp.port",
  "tcp.port",
  "tcp.flags.syn",
  "tcp.flags.ack",
  "tcp.flags.reset",
]);
const textFields = new Set([
  "frame.protocols",
  "dns.qry.name",
  "http.request.method",
  "coap.opt.uri_path_recon",
]);
const comparisons = new Set([
  "==",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "eq",
  "ne",
  "gt",
  "lt",
  "ge",
  "le",
  "contains",
  "matches",
  "in",
]);
const logical = new Set(["&&", "||", "^^", "!", "and", "or", "xor", "not", "(", ")"]);

function assertOfflineFilter(filter: string) {
  const tokens =
    filter.match(/"(?:\\.|[^"\\])*"|[!<>=]=|&&|\|\||\^\^|-?[a-zA-Z0-9_:][a-zA-Z0-9_.:/-]*|[^\s]/g) ?? [];
  const literal =
    /^-?(?:0x[0-9a-f]+|\d+(?:\.\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?:\/\d+)?|[0-9a-f:.]*:[0-9a-f:.]+(?:\/\d+)?)$/i;
  const allowed = tokens.every((token, index) => {
    const prev = tokens[index - 1] ?? "";
    const next = tokens[index + 1] ?? "";
    if (comparisons.has(token)) {
      if (!filterFields.has(prev)) return false;
      if (token === "contains" || token === "matches") return textFields.has(prev);
      return true;
    }
    if (token.startsWith('"')) return comparisons.has(prev) && textFields.has(tokens[index - 2] ?? "");
    if (
      logical.has(token) ||
      filterFields.has(token) ||
      literal.test(token) ||
      token === "true" ||
      token === "false" ||
      token === "{" ||
      token === "}" ||
      token === ","
    )
      return true;
    // An unqualified protocol name is a presence predicate. Values are restricted to offline literals.
    return /^[a-z][a-z0-9_-]*$/i.test(token) && (!prev || logical.has(prev)) && (!next || logical.has(next));
  });
  if (!allowed)
    throw new CaptureError(
      "filter_unavailable",
      "Use protocol presence and comparisons on offline fields with numeric addresses. Raw data and hostname lookups are unavailable.",
    );
}

export function selectedFields(fields: string[] = defaultFields) {
  if (fields.some((field) => !selectable.has(field)))
    throw new CaptureError(
      "field_unavailable",
      "Select fields from the offline field catalog. Raw fields are unavailable.",
    );
  return [...new Set(fields)];
}

export function captureProfileEnvironment(folder: string) {
  return {
    WIRESHARK_CONFIG_DIR: folder,
    WIRESHARK_DATA_DIR: folder,
    WIRESHARK_PLUGIN_DIR: folder,
    WIRESHARK_EXTCAP_DIR: folder,
    HOME: folder,
    APPDATA: folder,
    LOCALAPPDATA: folder,
    USERPROFILE: folder,
    XDG_CONFIG_HOME: folder,
    XDG_CONFIG_DIRS: folder,
    XDG_DATA_HOME: folder,
    XDG_DATA_DIRS: folder,
    LUA_PATH: "",
    LUA_CPATH: "",
    LC_ALL: "C",
  };
}

export function captureDissectionArgs(analysis: CaptureAnalysis) {
  const decode = analysis.decodeAs.flatMap(({ transport, port, protocol }) => [
    "-d",
    `${transport}.port==${port},${protocol}`,
  ]);
  if (!analysis.trafficPreferences) return decode;
  const checksum = analysis.trafficPreferences.validateChecksums ? "TRUE" : "FALSE";
  return [
    ...decode,
    ...(analysis.networkProfile ? ["--disable-protocol", "f5ethtrailer"] : []),
    "-o",
    "tcp.analyze_sequence_numbers:TRUE",
    "-o",
    "tcp.desegment_tcp_streams:TRUE",
    "-o",
    "tcp.reassemble_out_of_order:FALSE",
    "-o",
    "http.desegment_headers:TRUE",
    "-o",
    "http.desegment_body:TRUE",
    "-o",
    "dns.desegment_dns_messages:TRUE",
    "-o",
    `tcp.check_checksum:${checksum}`,
    "-o",
    `udp.check_checksum:${checksum}`,
    ...(analysis.automotiveProfile && analysis.automotiveProfile !== "doip"
      ? ["-o", "someip.reassemble_tp:TRUE", "-o", "someip.payload_dissector_activated:FALSE"]
      : []),
  ];
}

export class OfflineTshark {
  constructor(
    private readonly runner: ProgramRunner,
    private readonly executable: string,
    private readonly folder: string,
    private readonly signal: AbortSignal,
  ) {}

  private async run(
    args: string[],
    phase: "filter" | "capture" | "discovery" | "traffic",
    maxBytes: number,
    analysis?: CaptureAnalysis,
  ) {
    const { exit, stdout, stderr, exceeded } = await this.runner.captureOutput({
      executable: this.executable,
      args: phase === "discovery" ? args : ["-n", ...args],
      cwd: this.folder,
      env: captureProfileEnvironment(this.folder),
      maxBytes,
      signal: this.signal,
    });
    if (
      (exceeded || exit.code !== 0) &&
      args.includes("-d") &&
      /(?:decode as|layer type|valid protocol names|dissector table)/i.test(stderr)
    )
      throw new CaptureError(
        "invalid_decode_as",
        "Choose a Decode As protocol supported for the selected transport.",
      );
    if (exceeded)
      throw new CaptureError(
        "native_output_limit",
        "Native output exceeded its bound. Narrow the capture or the selection.",
      );
    if (exit.code === 0) return stdout;
    const profile = analysis?.networkProfile ?? analysis?.mediaProfile;
    if (
      analysis &&
      profile &&
      /(?:not valid fields|fields aren't valid|isn't a valid field|unknown preference|invalid -o flag|unknown protocol|no such protocol)/i.test(
        stderr,
      )
    ) {
      const fields = args.flatMap((arg, index) => (index > 0 && args[index - 1] === "-e" ? [arg] : []));
      const rejected = new Set(stderr.split(/\r?\n/).map((line) => line.trim()));
      const unavailable = fields.filter((field) => rejected.has(field));
      const media = analysis.mediaProfile !== undefined;
      throw new CaptureError(
        media ? "media_unavailable" : "network_unavailable",
        `TShark ${analysis.version} cannot provide the ${profile}${media ? " media" : ""} profile. ${unavailable.length ? "Unavailable" : "Requested"} fields: ${(unavailable.length ? unavailable : fields).join(", ")}.`,
      );
    }
    if (
      (phase === "traffic" || args.includes("-o")) &&
      /(?:not valid fields|fields aren't valid|isn't a valid field|unknown preference|invalid -o flag|invalid follow|valid follow|invalid (?:output|display) mode)/i.test(
        stderr,
      )
    )
      throw new CaptureError(
        "traffic_unavailable",
        "The installed TShark does not support the fields, preferences or stream output for this operation.",
      );
    if (exit.error || exit.signal)
      throw new CaptureError(
        "tshark_unavailable",
        "TShark did not run successfully. Check the external Wireshark installation.",
      );
    if (phase === "filter")
      throw new CaptureError(
        "invalid_filter",
        "TShark rejected the display filter. Check the field, operator and parentheses.",
      );
    if (phase === "capture")
      throw new CaptureError(
        "invalid_capture",
        "TShark could not complete the capture read. Verify the PCAP or PCAPNG file.",
      );
    if (phase === "traffic")
      throw new CaptureError(
        "traffic_failed",
        "TShark could not complete this saved-capture traffic operation.",
      );
    throw new CaptureError(
      "tshark_unavailable",
      "TShark could not read its catalogs. Check the external installation.",
    );
  }

  private read(path: string, analysis: CaptureAnalysis, maxFrames: number, filter?: string) {
    return [
      ...(analysis.automotiveProfile || analysis.networkProfile ? ["-2"] : []),
      "-r",
      path,
      "-c",
      String(maxFrames),
      ...captureDissectionArgs(analysis),
      ...(filter ? ["-Y", filter] : []),
    ];
  }

  async validate(analysis: CaptureAnalysis, fields: readonly string[] = ["frame.number"]) {
    if (analysis.filter) assertOfflineFilter(analysis.filter);
    await this.run(
      [
        ...this.read(join(this.folder, "empty.pcap"), analysis, 1, analysis.filter ?? undefined),
        "-T",
        "fields",
        ...fields.flatMap((name) => ["-e", name]),
      ],
      "filter",
      1024,
      analysis,
    );
  }

  async numbers(path: string, analysis: CaptureAnalysis, maxFrames: number, filter?: string) {
    const stdout = await this.run(
      [...this.read(path, analysis, maxFrames, filter), "-T", "fields", "-e", "frame.number"],
      "capture",
      (captureLimits.scanFrames + 1) * 8,
    );
    const lines = stdout.trimEnd().split(/\r?\n/).filter(Boolean);
    const numbers = lines.map(Number);
    if (
      numbers.some(
        (n, i) =>
          !/^[1-9]\d*$/.test(lines[i] ?? "") ||
          !Number.isSafeInteger(n) ||
          n > maxFrames ||
          n <= (numbers[i - 1] ?? 0),
      )
    )
      throw invalidOutput();
    return numbers;
  }

  trafficOutput(
    path: string,
    analysis: CaptureAnalysis,
    maxFrames: number,
    output: string[],
    maxBytes: number,
    filter?: string,
  ) {
    return this.run(
      [...this.read(path, analysis, maxFrames, filter), ...output],
      "traffic",
      maxBytes,
      analysis,
    );
  }

  async packets(path: string, analysis: CaptureAnalysis, frames: number[], fields: string[], sha256: string) {
    const last = frames.at(-1);
    if (last === undefined) return [];
    const stdout = await this.run(
      [
        ...this.read(path, analysis, last, `frame.number in {${frames.join(", ")}}`),
        "-T",
        "json",
        ...[...new Set([...intrinsic, ...fields])].flatMap((name) => ["-e", name]),
      ],
      "capture",
      2 * 1024 * 1024,
      analysis,
    );
    const schema = z
      .array(
        z.object({
          _source: z.object({ layers: z.record(z.string(), z.array(z.string())) }),
        }),
      )
      .max(captureLimits.pageRows);
    let output: unknown;
    try {
      output = JSON.parse(stdout);
    } catch {
      throw invalidOutput();
    }
    const parsed = schema.safeParse(output);
    if (!parsed.success || parsed.data.length !== frames.length) throw invalidOutput();
    const packets: CapturePacket[] = [];
    for (const [
      index,
      {
        _source: { layers },
      },
    ] of parsed.data.entries()) {
      const number = intrinsicNumber(layers["frame.number"]);
      const timestamp = layers["frame.time_epoch"];
      const interfaceId = layers["frame.interface_id"];
      if (number !== frames[index] || (timestamp && timestamp.length !== 1)) throw invalidOutput();
      const frame = captureFrameReferenceSchema.safeParse({
        captureSha256: sha256,
        number,
        interfaceId: interfaceId ? intrinsicNumber(interfaceId) : null,
        timestampEpoch: timestamp?.[0] ?? null,
      });
      if (!frame.success) throw invalidOutput();
      const wireBytes = intrinsicNumber(layers["frame.len"]);
      const capturedBytes = intrinsicNumber(layers["frame.cap_len"]);
      let truncated = capturedBytes < wireBytes;
      const projected: Record<string, string[]> = {};
      for (const field of fields) {
        const values = layers[field] ?? [];
        if (values.length > 4) truncated = true;
        projected[field] = values.slice(0, 4).map((value) => {
          const clean = inertText(value);
          if (clean.length > captureLimits.valueChars) truncated = true;
          return clean.slice(0, captureLimits.valueChars);
        });
      }
      packets.push(
        capturePacketSchema.parse({
          frame: frame.data,
          wireBytes,
          capturedBytes,
          fields: projected,
          truncated,
        }),
      );
    }
    return packets;
  }

  async discover(args: Extract<WiresharkCaptureArgs, { operation: "discover" }>) {
    const output = await this.run(
      ["-G", args.kind === "decoders" ? "decodes" : args.kind],
      "discovery",
      32 * 1024 * 1024,
    );
    const entries = new Map<string, { name: string; description: string; transport?: string }>();
    for (const row of output.split(/\r?\n/)) {
      const [first, second, third, fourth] = row.split("\t");
      if (!first || !second || !third) continue;
      if (args.kind === "fields") {
        if (first === "F" && fourth && selectable.has(third))
          entries.set(third, { name: third, description: inertText(second).slice(0, 160) });
      } else if (args.kind === "protocols") {
        if (/^[\w.-]{1,80}$/.test(third))
          entries.set(third, { name: third, description: inertText(first).slice(0, 160) });
      } else if ((first === "tcp.port" || first === "udp.port") && /^[a-z][a-z0-9_.-]{0,47}$/.test(third)) {
        const transport = first.slice(0, 3);
        entries.set(`${transport}:${third}`, { name: third, transport, description: "" });
      }
    }
    if (entries.size === 0) throw invalidOutput();
    const search = args.search?.trim().toLowerCase() ?? "";
    return [...entries.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, entry]) => entry)
      .filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(search));
  }
}

function intrinsicNumber(values: string[] | undefined) {
  const value = values?.[0];
  if (values?.length !== 1 || !value || !/^\d{1,10}$/.test(value)) throw invalidOutput();
  return Number(value);
}

function inertText(value: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: packet text must not carry display controls.
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "\ufffd");
}

export function invalidOutput() {
  return new CaptureError(
    "native_output_invalid",
    "TShark returned unexpected output. Check the installed version and retry.",
  );
}
