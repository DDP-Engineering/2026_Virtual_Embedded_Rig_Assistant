import { BlockList, isIP } from "node:net";
import { z } from "zod";

/** Agent-facing contracts are independent of MCP and the selected search vendor. */
export interface WebSource {
  title: string;
  url: string;
  content: string;
}
export interface WebResult {
  provider: string;
  retrievedAt: string;
  sources: WebSource[];
  truncated: boolean;
}
export interface WebSearchRequest {
  query: string;
  objective?: string | undefined;
  limit?: number;
}
export interface WebReadRequest {
  url: string;
  maxCharacters?: number;
}
export interface WebProvider {
  search(request: WebSearchRequest, signal: AbortSignal): Promise<WebResult>;
  read(request: WebReadRequest, signal: AbortSignal): Promise<WebResult>;
}

// Node matches IPv4 addresses against mapped IPv6 ranges too; keep the families separate.
const privateAddresses = { ipv4: new BlockList(), ipv6: new BlockList() };
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  privateAddresses.ipv4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const)
  privateAddresses.ipv6.addSubnet(address, prefix, "ipv6");

/** URL destinations are resolved by the remote provider, never by VERA's local network. */
export function publicWebUrl(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
      .toLowerCase();
    const ip = isIP(host);
    if (
      value.length > 4096 ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (ip
        ? privateAddresses[ip === 4 ? "ipv4" : "ipv6"].check(host, ip === 4 ? "ipv4" : "ipv6")
        : !host.includes(".") ||
          /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|arpa)$/.test(host))
    )
      throw Error();
    return url.href;
  } catch {
    throw Error("Use a public HTTP or HTTPS URL without credentials or local addresses.");
  }
}

export const webSearchSchema = z.strictObject({
  query: z.string().trim().min(1).max(2000),
  objective: z.string().trim().min(1).max(4096).optional(),
  limit: z.number().int().min(1).max(8).default(5),
});
export const webReadSchema = z.strictObject({
  url: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => {
      try {
        publicWebUrl(value);
        return true;
      } catch {
        return false;
      }
    }, "Use a public HTTP or HTTPS URL without credentials or local addresses."),
  maxCharacters: z.number().int().min(1).max(16000).default(12000),
});
