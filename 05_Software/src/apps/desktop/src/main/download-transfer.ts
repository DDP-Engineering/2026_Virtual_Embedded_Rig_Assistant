import { createServer } from "node:http";
import { connect as connectTcp, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  connectDownload,
  type DownloadTransferPorts,
  type PublicAddress,
  publicDownloadAddress,
  transferFile,
} from "@vera/core";
import { type Session, session } from "electron";

type Destination = { authority: string; port: number; address: PublicAddress };

/** Chromium owns TLS/certificate verification; this local tunnel owns the pinned TCP destination.
 * Chromium must never independently re-resolve an agent URL after the core validates its DNS.
 */
export async function createDownloadTunnel(
  dial: (options: { host: string; family: number; port: number }) => Socket = connectTcp,
) {
  let target: Destination | undefined;
  const sockets = new Set<Duplex>();
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const server = createServer((_request, response) => response.writeHead(405).end());
  server.maxConnections = 4;
  server.on("connection", track);
  server.on("connect", (request, client, head) => {
    const destination = target;
    if (!destination || request.url !== destination.authority) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const remote = dial({
      host: destination.address.address,
      family: destination.address.family,
      port: destination.port,
    });
    track(remote);
    remote.on("error", () => client.destroy());
    client.on("error", () => remote.destroy());
    client.once("close", () => remote.destroy());
    remote.once("close", () => {
      if (!remote.readableEnded) client.destroy();
    });
    remote.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      client.pipe(remote);
      remote.pipe(client);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Download tunnel could not start.");
  return {
    proxy: `http://127.0.0.1:${address.port}`,
    pin(url: URL, address: PublicAddress) {
      if (url.protocol !== "https:" || !publicDownloadAddress(address))
        throw Error("Downloads require a public HTTPS destination.");
      for (const socket of sockets) socket.destroy();
      const port = Number(url.port || 443);
      target = { authority: `${url.hostname}:${port}`, port, address };
    },
    async close() {
      target = undefined;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Anonymous in-memory Chromium sessions are reused only after their connections are closed.
 * Core still owns redirects, public DNS checks, MIME/signature/size limits and the total deadline.
 */
export function createDesktopDownloadTransfer(): typeof transferFile {
  const idle: Session[] = [];
  let number = 0;
  return async (source, signal) => {
    signal.throwIfAborted();
    const client = idle.pop() ?? session.fromPartition(`vera-web-download-${++number}`, { cache: false });
    const tunnel = await createDownloadTunnel();
    try {
      await client.setProxy({
        mode: "fixed_servers",
        proxyRules: tunnel.proxy,
        proxyBypassRules: "<-loopback>",
      });
      const connect: NonNullable<DownloadTransferPorts["connect"]> = async (
        url,
        address,
        headers,
        caller,
      ) => {
        if (url.protocol === "http:") return connectDownload(url, address, headers, caller);
        tunnel.pin(url, address);
        const controller = new AbortController();
        const response = await client.fetch(url.href, {
          method: "GET",
          headers,
          credentials: "omit",
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.any([caller, controller.signal]),
        });
        const reader = response.body?.getReader();
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: (async function* () {
            if (!reader) return;
            while (true) {
              const next = await reader.read();
              if (next.done) return;
              yield next.value;
            }
          })(),
          close() {
            controller.abort();
            void reader?.cancel().catch(() => {});
          },
        };
      };
      return await transferFile(source, signal, { connect });
    } finally {
      try {
        await client.closeAllConnections();
        await client.setProxy({ mode: "direct" });
        idle.push(client);
      } finally {
        await tunnel.close();
      }
    }
  };
}
