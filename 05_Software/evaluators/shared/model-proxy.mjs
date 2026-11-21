import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/**
 * A loopback proxy in front of an OpenAI-compatible endpoint, used as the `custom` base URL of a run.
 * It forwards every request to `target` and only to its origin. With `reasoning` it sets
 * `reasoning_effort` on chat completions the way VERA does for a custom endpoint ("off" becomes
 * "none"); the CLI has no reasoning option. With `record` it keeps each request body (EVAL-03).
 */
export async function startModelProxy({ target, reasoning, record = false }) {
  const base = new URL(target.endsWith("/") ? target : `${target}/`);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw Error(`Unsupported model URL ${target}`);
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = Buffer.concat(chunks);
      const url = new URL((req.url ?? "/").replace(/^\/v1\/?/, ""), base);
      if (url.origin !== base.origin) {
        res.writeHead(400).end();
        return;
      }
      if (reasoning && req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
        try {
          const json = JSON.parse(body.toString("utf8"));
          json.reasoning_effort = reasoning === "off" ? "none" : reasoning;
          body = Buffer.from(JSON.stringify(json));
        } catch {
          /* not JSON: forwarded unchanged */
        }
      }
      if (record) requests.push({ method: req.method, path: url.pathname, body: body.toString("utf8") });
      const headers = { ...req.headers, host: url.host, "content-length": String(body.length) };
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = send(url, { method: req.method, headers }, (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      });
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "evaluation proxy: model endpoint unreachable" } }));
      });
      // A stopped run closes its connection; stop the generation behind it too.
      res.on("close", () => upstream.destroy());
      upstream.end(body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1`,
    origin: base.origin,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
