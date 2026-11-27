// REQ-SEC-6c43bda5, REQ-REL-45112294
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { advancedSettings, DOWNLOAD_MAX_BYTES } from "@vera/shared";
import { LOCAL_NETWORK_HINT, publicWebUrl } from "./provider.js";

/** The default Download time limit; also the PDF extraction base deadline, which ADV-04 owns. */
export const DOWNLOAD_DEADLINE_MS = advancedSettings.downloadTimeout.default * 1000;
const DEFAULT_MAX_BYTES = advancedSettings.downloadMB.default * 1024 * 1024;
const MAX_DEADLINE_MS = advancedSettings.downloadTimeout.max * 1000;
const headers = { Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": "VERA" } as const;
/** How long one resolved address may take to answer while another is left to try. */
export const CONNECT_PATIENCE_MS = 10_000;
export interface PublicAddress {
  address: string;
  family: number;
}
export interface DownloadHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
export interface DownloadTransferPorts {
  /** Backpressure keeps at most the current body chunk in use by the download. */
  write(chunk: Uint8Array, signal: AbortSignal): Promise<void>;
  resolve?(hostname: string): Promise<PublicAddress[]>;
  connect?(
    url: URL,
    address: PublicAddress,
    requestHeaders: typeof headers,
    signal: AbortSignal,
  ): Promise<DownloadHttpResponse>;
  /**
   * The approved request's budget (REQ-FUNC-17f34e4b, REQ-FUNC-dfe84577); the defaults are the settings'
   * defaults and no caller can exceed the settings' largest values.
   */
  maxBytes?: number;
  deadlineMs?: number;
}
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const tunnelV6 = new BlockList();
tunnelV6.addSubnet("2001::", 32, "ipv6");
tunnelV6.addSubnet("2002::", 16, "ipv6");
/** Literal validation plus a global-unicast IPv6 boundary excludes mapped/NAT64/tunnel routes. */
export function publicDownloadAddress(value: PublicAddress): boolean {
  const family = isIP(value.address);
  if (!family || family !== value.family) return false;
  try {
    publicWebUrl(`https://${family === 6 ? `[${value.address}]` : value.address}/`);
    return family === 4 || (globalV6.check(value.address, "ipv6") && !tunnelV6.check(value.address, "ipv6"));
  } catch {
    return false;
  }
}
export const connectDownload: NonNullable<DownloadTransferPorts["connect"]> = (
  url,
  address,
  requestHeaders,
  signal,
) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        headers: requestHeaders,
        agent: false,
        family: address.family,
        signal,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          close: () => response.destroy(),
        }),
    );
    request.on("error", reject);
    request.end();
  });

/** No provider client, cookie jar, credentials or ambient proxy participates in this transport. */
export async function transferFile(source: string, caller: AbortSignal, ports: DownloadTransferPorts) {
  const maxBytes = Math.min(ports.maxBytes ?? DEFAULT_MAX_BYTES, DOWNLOAD_MAX_BYTES);
  const deadlineMs = Math.min(ports.deadlineMs ?? DOWNLOAD_DEADLINE_MS, MAX_DEADLINE_MS);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isFinite(deadlineMs) || deadlineMs < 1)
    throw Error("Invalid Download budget.");
  const signal = AbortSignal.any([caller, AbortSignal.timeout(deadlineMs)]);
  let url = new URL(publicWebUrl(source));
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await cancellable((ports.resolve ?? ((host) => lookup(host, { all: true })))(hostname), signal);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((address) => !publicDownloadAddress(address)))
      throw Error(`Downloads require a public network destination. ${LOCAL_NETWORK_HINT}`);
    const response = await firstReachable(url, addresses, ports.connect ?? connectDownload, signal);
    try {
      signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (redirects === 5 || typeof location !== "string") throw Error("Download redirect limit exceeded.");
        url = new URL(publicWebUrl(new URL(location, url).href));
        continue;
      }
      if (response.status !== 200) throw Error(`Download failed (HTTP ${response.status}).`);
      // A missing or malformed content type is a file of unknown kind, not a failed download. A reply that
      // carries a Content-Encoding although identity was asked for is stored as sent, as curl stores it.
      const contentType = response.headers["content-type"];
      const stated =
        typeof contentType === "string" ? contentType.split(";", 1)[0]?.trim().toLowerCase() : "";
      const mime =
        stated && stated.length <= 160 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(stated)
          ? stated
          : "application/octet-stream";
      const length = response.headers["content-length"];
      if (
        length !== undefined &&
        (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > maxBytes)
      )
        throw Error("Download exceeds the size limit.");
      let bytes = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      for (;;) {
        const next = await cancellable(iterator.next(), signal);
        if (next.done) break;
        const chunk = next.value;
        signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw Error("Download exceeds the size limit.");
        await ports.write(chunk, signal);
      }
      signal.throwIfAborted();
      if (length !== undefined && bytes !== Number(length)) throw Error("Incomplete download.");
      return { bytes, finalUrl: url.href, mime };
    } finally {
      response.close();
    }
  }
  throw Error("Download redirect limit exceeded.");
}

/**
 * The reply of the first address that answers. A host often resolves to an IPv6 and an IPv4 address, and
 * a network that announces IPv6 without routing it would otherwise fail the download a browser completes.
 * Every address but the last gets CONNECT_PATIENCE_MS to answer; the last has the whole download budget.
 */
async function firstReachable(
  url: URL,
  addresses: PublicAddress[],
  connect: NonNullable<DownloadTransferPorts["connect"]>,
  signal: AbortSignal,
): Promise<DownloadHttpResponse> {
  let failure: unknown;
  for (const [index, address] of addresses.entries()) {
    const patience = new AbortController();
    const timer =
      index < addresses.length - 1 ? setTimeout(() => patience.abort(), CONNECT_PATIENCE_MS) : undefined;
    const attempt = AbortSignal.any([signal, patience.signal]);
    try {
      return await cancellable(connect(url, address, headers, attempt), attempt, (late) => late.close());
    } catch (error) {
      signal.throwIfAborted();
      failure = error;
    } finally {
      // Cleared once the reply's headers arrive: the transfer itself is bounded by the download budget.
      clearTimeout(timer);
    }
  }
  throw failure;
}

function cancellable<T>(operation: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        if (settled) {
          late?.(value);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
