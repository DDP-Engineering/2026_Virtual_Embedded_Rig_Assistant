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
  /** A page read that stopped before the page's end: where the next read continues. */
  nextOffset?: number;
  /** The page's whole length, given with nextOffset when the provider returned all of it. */
  totalCharacters?: number;
}
export interface WebSearchRequest {
  query: string;
  objective?: string | undefined;
  limit?: number;
}
export interface WebReadRequest {
  url: string;
  maxCharacters?: number;
  offset?: number;
}
export interface WebProvider {
  search(request: WebSearchRequest, signal: AbortSignal): Promise<WebResult>;
  read(request: WebReadRequest, signal: AbortSignal): Promise<WebResult>;
  /** Leases a provider connection for calls belonging to one agent turn. */
  forTurn?(): WebProvider & { close(): void };
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

/** What the agent can do instead: the web tools reach only the public internet. */
export const LOCAL_NETWORK_HINT =
  "For a device or server on the local network, use run_command, for example with curl.";
export const PUBLIC_URL_REQUIRED = `Use a public HTTP or HTTPS URL without credentials or local addresses. ${LOCAL_NETWORK_HINT}`;

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
    throw Error(PUBLIC_URL_REQUIRED);
  }
}

/**
 * The most text of one page a provider is asked for; web_read returns windows of it. About 1 700 datasheet
 * pages, and below the 6 000 000 that Exa accepts (it refuses the whole request above its own maximum).
 */
export const WEB_PAGE_CHARACTERS = 4_000_000;
/** The reply size that carries a page of that length. */
export const WEB_PAGE_BYTES = 16 * 1024 * 1024;

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
    }, PUBLIC_URL_REQUIRED),
  maxCharacters: z.number().int().min(1).max(16000).default(12000),
  offset: z.number().int().min(0).max(WEB_PAGE_CHARACTERS).default(0),
});

/**
 * One window of a page's text. A provider asks for the page up to WEB_PAGE_CHARACTERS and cuts the window
 * here, so a long document can be continued or entered anywhere; `complete` is false when the text itself
 * stopped at that size.
 */
export function pageWindow(text: string, offset: number, maxCharacters: number, complete = true) {
  if (offset > 0 && offset >= text.length)
    throw Error(`The page has ${text.length} characters. Use a smaller offset.`);
  let end = Math.min(text.length, offset + maxCharacters);
  // Never leave half of a surrogate pair at the cut.
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  const more = end < text.length;
  return {
    content: text.slice(offset, end),
    truncated: more || !complete,
    ...(more ? { nextOffset: end } : {}),
    ...(more && complete ? { totalCharacters: text.length } : {}),
  };
}
