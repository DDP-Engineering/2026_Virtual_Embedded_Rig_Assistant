import {
  type WiresharkCaptureArgs,
  wiresharkCaptureArgsSchema,
  wiresharkCaptureToolSchema,
  wiresharkImportSchema,
} from "@vera/shared";
import { CaptureError } from "../wireshark/native.js";
import { inspectWireshark } from "../wireshark/service.js";
import type { ToolContext, ToolDefinition } from "./context.js";

const available = (ctx: ToolContext) => !!ctx.programs && !!ctx.wiresharkPackage;

async function execute(ctx: ToolContext, args: WiresharkCaptureArgs, signal: AbortSignal) {
  try {
    return await inspectWireshark(ctx, args, signal);
  } catch (error) {
    if (!(error instanceof CaptureError)) throw error;
    return { isError: true, reason: error.reason, error: error.message };
  }
}

export const wiresharkCaptureTool: ToolDefinition = {
  name: "wireshark_capture",
  class: "read",
  description:
    "Inspect saved PCAP/PCAPNG offline with the official Wireshark plugin. Check capabilities, discover fields, protocols and decoders, validate a filter, inspect coverage, query packets, retrieve a frame or verify a capture reference. Use statistics for protocol stacks, directional endpoints or conversations, interval traffic, diagnostics or DNS/HTTP timing. Follow a TCP or UDP stream for directional byte counts and frame evidence. Use network with networkProfile for Ethernet/VLAN, IPv4/IPv6, ARP/ND, DNS/DHCP, TCP/UDP, multicast or visible TLS metadata. Its typed queries cover exchanges, conversations, TCP symptoms and multicast. Select compact evidence to redact network identifiers. Use automotive with automotiveProfile for DoIP, SOME/IP or Service Discovery PDUs and conversations. Supply capture-specific SOME/IP Decode As ports. Payload stays in the verified local capture. Use the exact returned cursor with the original query, report observed coverage, and cite a packet as [[ref]] with its exact returned ref.",
  params: wiresharkCaptureToolSchema,
  available,
  execute: (ctx, raw, signal) => execute(ctx, wiresharkCaptureArgsSchema.parse(raw), signal),
};

export const wiresharkImportTool: ToolDefinition = {
  name: "wireshark_import",
  class: "session",
  description:
    "Validate a saved PCAP or PCAPNG and retain its exact bytes in managed workbench storage. Pass the returned reference to wireshark_capture. Small text reports use artifact_save.",
  params: wiresharkImportSchema,
  available,
  execute: (ctx, raw, signal) =>
    execute(ctx, { operation: "import", ...wiresharkImportSchema.parse(raw) }, signal),
};
