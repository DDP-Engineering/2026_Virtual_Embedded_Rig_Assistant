import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { BrowserError } from "./failure.js";
import {
  type BrowserNetworkPorts,
  type BrowserUpstream,
  browserNavigationErrorHeader,
  browserUrl,
  readableBrowserType,
  resolveBrowserAddress,
} from "./network.js";
import { createProxyIdentity } from "./proxy-identity.js";

export const browserNetworkLimits = {
  requestMs: 15_000,
  sockets: 64,
  parallel: 32,
  requests: 2_000,
  resourceBytes: 16 * 1024 * 1024,
  sessionBytes: 128 * 1024 * 1024,
} as const;

const {
  requestMs,
  sockets: maxSockets,
  parallel,
  requests: maxRequests,
  resourceBytes,
  sessionBytes,
} = browserNetworkLimits;

const requestHeaders = [
  "accept",
  "accept-language",
  "cache-control",
  "if-modified-since",
  "if-none-match",
  "origin",
  "range",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent",
] as const;

const responseHeaderExclusions = new Set([
  browserNavigationErrorHeader,
  "alt-svc",
  "clear-site-data",
  "connection",
  "keep-alive",
  "nel",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "refresh",
  "report-to",
  "reporting-endpoints",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "www-authenticate",
]);

export async function createBrowserProxy(
  authorize: (url: URL) => void,
  ports: BrowserNetworkPorts,
  lifetime: AbortSignal,
) {
  lifetime.throwIfAborted();
  const identity = createProxyIdentity();
  const sockets = new Set<Socket>();
  const origins = new WeakMap<Socket, string>();
  let requests = 0;
  let inFlight = 0;
  let bytes = 0;

  async function serve(request: IncomingMessage, response: ServerResponse) {
    const tunnelOrigin = origins.get(request.socket);
    const raw = request.url ?? "";
    const document = request.headers["sec-fetch-dest"] === "document";
    const reject = (status: number, code: string) => {
      // A no-content navigation keeps the currently visible document on policy failures.
      if (document)
        response.writeHead(204, { [browserNavigationErrorHeader]: code, "cache-control": "no-store" }).end();
      else response.writeHead(status).end();
    };
    let url: URL;
    try {
      if (tunnelOrigin && (!raw.startsWith("/") || /^\/[/\\]/.test(raw))) throw Error("Invalid target");
      url = browserUrl(tunnelOrigin ? tunnelOrigin + raw : raw);
      if (
        url.protocol !== (tunnelOrigin ? "https:" : "http:") ||
        (tunnelOrigin && url.origin !== tunnelOrigin) ||
        browserUrl(`${url.protocol}//${request.headers.host ?? ""}/`).origin !== url.origin ||
        url.hash
      )
        throw Error("Invalid authority");
      authorize(url);
    } catch {
      reject(403, "destination-denied");
      return;
    }
    if (request.headers["service-worker"] || request.headers["sec-fetch-dest"] === "serviceworker") {
      response.writeHead(403).end();
      return;
    }
    const method = request.method;
    if (
      (method !== "GET" && method !== "HEAD") ||
      request.headers["transfer-encoding"] ||
      (request.headers["content-length"] && request.headers["content-length"] !== "0")
    ) {
      response.writeHead(405, { connection: "close" }).end();
      return;
    }
    if (requests >= maxRequests || inFlight >= parallel || bytes >= sessionBytes) {
      reject(429, "resource-limit");
      return;
    }
    requests++;
    inFlight++;
    const disconnect = new AbortController();
    response.once("close", () => disconnect.abort());
    const deadline = AbortSignal.timeout(requestMs);
    const signal = AbortSignal.any([lifetime, disconnect.signal, deadline]);
    let upstream: BrowserUpstream | undefined;
    try {
      const address = await resolveBrowserAddress(url, ports.resolve, signal);
      authorize(url);
      const selectedHeaders = Object.fromEntries(
        requestHeaders.flatMap((name) => {
          const value = request.headers[name];
          return value === undefined ? [] : [[name, value]];
        }),
      );
      const headers = { ...selectedHeaders, "accept-encoding": "identity" };
      upstream = await ports.request(url, address, method, headers, signal);
      signal.throwIfAborted();
      const coding = upstream.headers["content-encoding"];
      const contentType = upstream.headers["content-type"];
      const status = upstream.status;
      const redirect = [301, 302, 303, 307, 308].includes(status) && !!upstream.headers.location;
      const documentBody = status >= 200 && ![204, 205, 304].includes(status) && !redirect;
      if (
        upstream.headers["content-disposition"] ||
        (coding && coding.toLowerCase() !== "identity") ||
        (document &&
          documentBody &&
          !readableBrowserType(typeof contentType === "string" ? contentType : undefined))
      ) {
        reject(415, "unsupported-content");
        return;
      }
      const size = Number(upstream.headers["content-length"] ?? 0);
      if (method === "GET" && (size > resourceBytes || bytes + size > sessionBytes)) {
        reject(413, "resource-limit");
        return;
      }
      const output = responseHeaders(upstream.headers);
      if (upstream.status >= 300 && upstream.status < 400 && output.location) {
        const location = browserUrl(new URL(String(output.location), url).href);
        authorize(location);
      }
      response.writeHead(upstream.status, output);
      let delivered = 0;
      for await (const chunk of upstream.body) {
        signal.throwIfAborted();
        if (delivered + chunk.length > resourceBytes || bytes + chunk.length > sessionBytes)
          throw new BrowserError("resource-limit");
        delivered += chunk.length;
        bytes += chunk.length;
        if (!response.write(chunk)) await once(response, "drain", { signal });
      }
      response.end();
    } catch (error) {
      if (response.headersSent || lifetime.aborted || disconnect.signal.aborted) response.destroy();
      else if (deadline.aborted) reject(504, "operation-timeout");
      else if (error instanceof BrowserError) reject(403, error.code);
      else response.writeHead(502).end();
    } finally {
      upstream?.close();
      inFlight--;
    }
  }

  const serverOptions = { maxHeaderSize: 16 * 1024, headersTimeout: requestMs, requestTimeout: requestMs };
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    void serve(request, response).catch(() => response.destroy());
  };
  const secureServer = createServer(serverOptions, handler);
  const server = createServer(serverOptions, handler);
  for (const listener of [server, secureServer]) {
    listener.maxHeadersCount = 0; // maxHeaderSize rejects oversized headers instead of truncating them.
    listener.on("upgrade", (_request, socket) => socket.destroy());
    listener.on("clientError", (_error, socket) => socket.destroy());
    listener.on("checkContinue", (_request, response) =>
      response.writeHead(405, { connection: "close" }).end(),
    );
  }
  secureServer.on("connect", (_request, socket) => socket.destroy());
  server.maxConnections = maxSockets;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(requestMs, () => socket.destroy());
  });
  server.on("connect", (request, client, head) => {
    try {
      const authority = request.url ?? "";
      if (head.length || !/^(?:\[[\da-f:]+\]|[a-z\d.-]+):[1-9]\d{0,4}$/i.test(authority))
        throw Error("Invalid tunnel");
      const url = browserUrl(`https://${authority}/`);
      authorize(url);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const secure = new TLSSocket(client as Socket, { isServer: true, secureContext: identity.tls });
      secure.on("error", () => secure.destroy());
      origins.set(secure, url.origin);
      secureServer.emit("connection", secure);
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  let closing: Promise<void> | undefined;
  const stop = () => {
    closing ??= new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
    return closing;
  };
  lifetime.addEventListener("abort", stop, { once: true });
  if (lifetime.aborted) {
    await stop();
    lifetime.throwIfAborted();
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    await stop();
    throw new BrowserError("policy-denied");
  }
  return {
    proxyServer: `http://127.0.0.1:${address.port}`,
    certificatePin: identity.spki,
    close: () => {
      lifetime.removeEventListener("abort", stop);
      return stop();
    },
  };
}

function responseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const hop = new Set(
    headers.connection
      ?.toLowerCase()
      .split(",")
      .map((value) => value.trim()),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !responseHeaderExclusions.has(name) && !hop.has(name)),
  );
}
