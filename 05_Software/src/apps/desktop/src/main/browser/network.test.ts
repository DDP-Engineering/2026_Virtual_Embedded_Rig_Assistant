import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { browserNetwork } from "./network.js";

it("uses the supplied address for the actual socket while retaining the requested Host", async () => {
  const server = createServer((request, response) => {
    response.end(`${request.socket.localAddress} ${request.headers.host} ${request.url}`);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const bound = server.address();
    if (bound === null || typeof bound === "string") throw Error("Missing fixture endpoint");
    const authority = `cannot-resolve.invalid:${bound.port}`;
    const result = await browserNetwork.request(
      new URL(`http://${authority}/fixture?answer=1`),
      { address: "127.0.0.1", family: 4 },
      "GET",
      {},
      AbortSignal.timeout(3000),
    );
    try {
      const parts: Uint8Array[] = [];
      for await (const part of result.body) parts.push(part);
      expect(Buffer.concat(parts).toString()).toBe(`127.0.0.1 ${authority} /fixture?answer=1`);
    } finally {
      result.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
