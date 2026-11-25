import { type HexdumpProfile, hexdumpImportLimits } from "@vera/shared";
import { CaptureError } from "./native.js";

const trace = /^@((?:19[7-9]\d|20\d\d)-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/;
const offsetToken = /^[a-f0-9]{3,8}$/i;
const byteToken = /^[a-f0-9]{2}$/i;
const syntheticEpoch = 946_684_800_000_000_000n;
const asciiLine = /^[\t\x20-\x7e]*$/;

type Packet = { data: Buffer; time: bigint };
type PendingPacket = { line: number; time: bigint; chunks: Buffer[]; length: number };

function malformed(line: number, advice: string) {
  return new CaptureError("hexdump_malformed", `Hexdump line ${line}: ${advice}`);
}

function incompatible(line: number, advice: string) {
  return new CaptureError("hexdump_incompatible", `Hexdump line ${line}: ${advice}`);
}

function readTime(line: string, number: number) {
  const match = trace.exec(line);
  const whole = match?.[1];
  const milliseconds = whole ? Date.parse(`${whole}Z`) : NaN;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== whole)
    throw malformed(number, "Use a valid UTC timestamp as @YYYY-MM-DDTHH:mm:ss[.fraction]Z.");
  return BigInt(milliseconds) * 1_000_000n + BigInt((match?.[2] ?? "").padEnd(9, "0"));
}

/** Validate the strict ASCII subset before giving canonical input to text2pcap. */
export function parseHexdump(source: Buffer, profile: HexdumpProfile, signal: AbortSignal) {
  const text = source.toString("latin1");
  const packets: Packet[] = [];
  const traceTime = profile.timestamps === "trace_utc";
  let pendingTime: { line: number; time: bigint } | undefined;
  let packet: PendingPacket | undefined;
  function finishPacket() {
    if (!packet) return;
    if (profile.encapsulation.kind === "ethernet" && packet.length < 14)
      throw incompatible(packet.line, "A raw Ethernet frame needs at least 14 bytes. Check encapsulation.");
    packets.push({ time: packet.time, data: Buffer.concat(packet.chunks, packet.length) });
    packet = undefined;
  }
  let number = 0;
  for (let start = 0; start < text.length; ) {
    signal.throwIfAborted();
    number++;
    const newline = text.indexOf("\n", start);
    let end = newline === -1 ? text.length : newline;
    if (newline !== -1 && text[end - 1] === "\r") end--;
    if (end - start > hexdumpImportLimits.lineBytes)
      throw malformed(number, "Use at most 256 ASCII bytes per line.");
    const raw = text.slice(start, end);
    start = newline === -1 ? text.length : newline + 1;
    if (!asciiLine.test(raw)) throw malformed(number, "Use printable ASCII and horizontal tabs.");
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("@")) {
      if (!traceTime) throw incompatible(number, "Remove the timestamp or choose trace UTC timestamps.");
      if (pendingTime) throw malformed(number, "Begin the preceding timestamp's packet at offset zero.");
      finishPacket();
      pendingTime = { line: number, time: readTime(line, number) };
      continue;
    }

    const [offsetText = "", ...bytes] = line.split(/[ \t]+/);
    if (
      !offsetToken.test(offsetText) ||
      bytes.length === 0 ||
      bytes.length > hexdumpImportLimits.lineDataBytes ||
      !bytes.every((token) => byteToken.test(token))
    )
      throw malformed(number, "Use a 3–8 digit hex offset followed by 1–32 two-digit hex bytes.");
    const offset = Number.parseInt(offsetText, 16);
    if (offset === 0) {
      finishPacket();
      if (traceTime && !pendingTime) throw incompatible(number, "Add a UTC timestamp before each packet.");
      if (packets.length >= hexdumpImportLimits.packets)
        throw new CaptureError("hexdump_packet_limit", `Split the hexdump before line ${number}.`);
      packet = {
        line: number,
        time: pendingTime?.time ?? syntheticEpoch + BigInt(packets.length) * 1000n,
        chunks: [],
        length: 0,
      };
      pendingTime = undefined;
    }
    if (!packet || offset !== packet.length)
      throw malformed(number, "Start at offset zero and use consecutive hexadecimal byte offsets.");
    if (packet.length + bytes.length > hexdumpImportLimits.packetBytes)
      throw new CaptureError(
        "hexdump_packet_limit",
        `Hexdump line ${number}: use at most 16 KiB of source data per packet.`,
      );
    packet.chunks.push(Buffer.from(bytes.join(""), "hex"));
    packet.length += bytes.length;
  }
  if (pendingTime) throw malformed(pendingTime.line, "Follow the timestamp with a packet at offset zero.");
  finishPacket();
  if (!packets.length) throw new CaptureError("hexdump_malformed", "Add at least one packet at offset zero.");
  return packets;
}

export function text2pcapInput(packets: ReturnType<typeof parseHexdump>, signal: AbortSignal) {
  const lines: string[] = [];
  for (const { data, time } of packets) {
    signal.throwIfAborted();
    const whole = new Date(Number(time / 1_000_000n)).toISOString().slice(0, 19);
    lines.push(`${whole}.${String(time % 1_000_000_000n).padStart(9, "0")}Z`);
    for (let offset = 0; offset < data.length; offset += 16) {
      const bytes = data
        .subarray(offset, offset + 16)
        .toString("hex")
        .replace(/(..)(?=.)/g, "$1 ");
      lines.push(`${offset.toString(16).padStart(6, "0")} ${bytes}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
