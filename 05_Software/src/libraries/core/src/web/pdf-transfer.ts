// REQ-SEC-6c43bda5, REQ-REL-45112294
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { PDF_DOWNLOAD_MAX_BYTES } from "@vera/shared";
import { publicWebUrl } from "./provider.js";

export const PDF_DOWNLOAD_DEADLINE_MS = 120_000;
const headers = { Accept: "application/pdf", "Accept-Encoding": "identity", "User-Agent": "VERA" } as const;
export interface PublicAddress {
  address: string;
  family: number;
}
export interface PdfHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
export interface PdfTransferPorts {
  resolve?(hostname: string): Promise<PublicAddress[]>;
  connect?(
    url: URL,
    address: PublicAddress,
    requestHeaders: typeof headers,
    signal: AbortSignal,
  ): Promise<PdfHttpResponse>;
  /** A lower budget is useful for deterministic transport tests; callers cannot raise the product cap. */
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
const connect: NonNullable<PdfTransferPorts["connect"]> = (url, address, requestHeaders, signal) =>
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
export async function transferPdf(source: string, caller: AbortSignal, ports: PdfTransferPorts = {}) {
  const maxBytes = Math.min(ports.maxBytes ?? PDF_DOWNLOAD_MAX_BYTES, PDF_DOWNLOAD_MAX_BYTES);
  const deadlineMs = Math.min(ports.deadlineMs ?? PDF_DOWNLOAD_DEADLINE_MS, PDF_DOWNLOAD_DEADLINE_MS);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isFinite(deadlineMs) || deadlineMs < 1)
    throw Error("Invalid PDF download budget.");
  const signal = AbortSignal.any([caller, AbortSignal.timeout(deadlineMs)]);
  let url = new URL(publicWebUrl(source));
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await cancellable((ports.resolve ?? ((host) => lookup(host, { all: true })))(hostname), signal);
    signal.throwIfAborted();
    const address = addresses[0];
    if (!address || addresses.some((address) => !publicDownloadAddress(address)))
      throw Error("PDF downloads require a public network destination.");
    const response = await cancellable(
      (ports.connect ?? connect)(url, address, headers, signal),
      signal,
      (late) => late.close(),
    );
    try {
      signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (redirects === 5 || typeof location !== "string")
          throw Error("PDF download redirect limit exceeded.");
        url = new URL(publicWebUrl(new URL(location, url).href));
        continue;
      }
      if (response.status !== 200) throw Error(`PDF download failed (HTTP ${response.status}).`);
      const mime = response.headers["content-type"];
      const encoding = response.headers["content-encoding"];
      if (
        typeof mime !== "string" ||
        !["application/pdf", "application/octet-stream"].includes(
          mime.split(";", 1)[0]?.trim().toLowerCase() ?? "",
        )
      )
        throw Error("The URL did not return a PDF document.");
      if (encoding && encoding !== "identity")
        throw Error("Compressed PDF download responses are unavailable.");
      const length = response.headers["content-length"];
      if (
        length !== undefined &&
        (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > maxBytes)
      )
        throw Error("PDF download exceeds the size limit.");
      const chunks: Buffer[] = [];
      let bytes = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      for (;;) {
        const next = await cancellable(iterator.next(), signal);
        if (next.done) break;
        const chunk = next.value;
        signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw Error("PDF download exceeds the size limit.");
        chunks.push(Buffer.from(chunk));
      }
      signal.throwIfAborted();
      if (!bytes || (length !== undefined && bytes !== Number(length)))
        throw Error("Incomplete PDF download.");
      const data = Buffer.concat(chunks, bytes);
      if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-")))
        throw Error("The response is not a PDF document.");
      return { data, finalUrl: url.href };
    } finally {
      response.close();
    }
  }
  throw Error("PDF download redirect limit exceeded.");
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
