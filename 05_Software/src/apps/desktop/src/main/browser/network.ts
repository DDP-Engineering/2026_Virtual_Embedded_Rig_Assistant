import { Resolver } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { type PublicAddress, publicDownloadAddress, publicWebUrl } from "@vera/core";
import { BrowserError } from "./failure.js";

const special = new BlockList();
// The existing download check handles private, non-global and tunneled addresses.
// This browser also excludes the remaining IANA special-purpose ranges.
for (const address of ["192.31.196.0", "192.52.193.0", "192.88.99.0", "192.175.48.0"])
  special.addSubnet(address, 24, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
] as const)
  special.addSubnet(address, prefix, "ipv6");

export function browserUrl(value: string): URL {
  try {
    const url = new URL(publicWebUrl(value));
    const hostname = browserHostname(url);
    const family = isIP(hostname);
    if (hostname.endsWith(".") || (family && !publicBrowserAddress({ address: hostname, family })))
      throw Error("Unsupported host");
    return url;
  } catch (cause) {
    throw new BrowserError("destination-denied", { cause });
  }
}

function browserHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function publicBrowserAddress(value: PublicAddress): boolean {
  return publicDownloadAddress(value) && !special.check(value.address, value.family === 4 ? "ipv4" : "ipv6");
}

export interface BrowserUpstream {
  status: number;
  headers: IncomingMessage["headers"];
  body: AsyncIterable<Uint8Array>;
  close(): void;
}

export interface BrowserNetworkPorts {
  resolve(host: string, signal: AbortSignal): Promise<PublicAddress[]>;
  request(
    url: URL,
    address: PublicAddress,
    method: "GET" | "HEAD",
    headers: OutgoingHttpHeaders,
    signal: AbortSignal,
  ): Promise<BrowserUpstream>;
}

export async function resolveBrowserAddress(
  url: URL,
  resolve: BrowserNetworkPorts["resolve"],
  signal: AbortSignal,
): Promise<PublicAddress> {
  const host = browserHostname(url);
  const family = isIP(host);
  signal.throwIfAborted();
  const addresses = family ? [{ address: host, family }] : await resolve(host, signal);
  signal.throwIfAborted();
  const address = addresses[0];
  if (!address || addresses.some((candidate) => !publicBrowserAddress(candidate)))
    throw new BrowserError("destination-denied");
  return address;
}

async function addressRecords(query: Promise<string[]>, family: 4 | 6): Promise<PublicAddress[]> {
  try {
    return (await query).map((address) => ({ address, family }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    throw error;
  }
}

async function resolveHost(host: string, signal: AbortSignal): Promise<PublicAddress[]> {
  signal.throwIfAborted();
  // A per-request resolver can cancel both address families without affecting another request.
  const resolver = new Resolver({ timeout: 5000, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const absolute = `${host}.`;
    const answers = await Promise.all([
      addressRecords(resolver.resolve4(absolute), 4),
      addressRecords(resolver.resolve6(absolute), 6),
    ]);
    return answers.flat();
  } catch (error) {
    if (!signal.aborted) cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export const browserNetwork: BrowserNetworkPorts = {
  resolve: resolveHost,
  request: (url, address, method, headers, signal) =>
    new Promise((resolve, reject) => {
      const hostname = browserHostname(url);
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          agent: false,
          hostname: address.address,
          family: address.family,
          headers: { ...headers, host: url.host },
          method,
          rejectUnauthorized: true,
          servername: isIP(hostname) ? "" : hostname,
          // A numeric socket target cannot trigger DNS. Verify TLS for the original host.
          checkServerIdentity: (_name, certificate) => checkServerIdentity(hostname, certificate),
          signal,
        },
        (response) => {
          response.on("error", () => {}); // A cancellation can precede the consumer's first read.
          resolve({
            status: response.statusCode ?? 502,
            headers: response.headers,
            body: response,
            close: () => response.destroy(),
          });
        },
      );
      request.on("error", reject);
      request.end();
    }),
};
