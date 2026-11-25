import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { StringDecoder } from "node:string_decoder";

/**
 * What an LM Studio server reports about a model (architecture, quantization, loaded context), or
 * null for any other server. Read once at the start of a run, directly from the endpoint's origin.
 */
export async function describeServerModel(baseUrl, model) {
  try {
    const signal = AbortSignal.timeout(3000);
    const url = new URL("/api/v0/models", baseUrl);
    const response = await fetch(url, { signal });
    const catalog = response.ok ? await response.json() : null;
    let data = catalog?.data?.find((item) => item.id === model);
    if (!data) {
      url.pathname += `/${model.split("/").map(encodeURIComponent).join("/")}`;
      const single = await fetch(url, { signal });
      if (single.ok) data = await single.json();
    }
    if (!data) return null;
    return {
      id: data.id ?? model,
      arch: data.arch ?? null,
      quantization: data.quantization ?? null,
      runtime: data.runtime ?? null,
      format: data.compatibility_type ?? null,
      state: data.state ?? null,
      loadedContextLength: data.loaded_context_length ?? null,
      maxContextLength: data.max_context_length ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * A loopback proxy in front of an OpenAI-compatible endpoint, used as the `custom` base URL of a run.
 * It forwards every request to `target` and only to its origin. With `reasoning` it sets
 * `reasoning_effort` on chat completions the way VERA does for a custom endpoint ("off" becomes
 * "none"); the CLI has no reasoning option. With `record` it keeps each request body (EVAL-03).
 */
export async function startModelProxy({ target, reasoning, record = false, maxCompletions, observeModel }) {
  const base = new URL(target.endsWith("/") ? target : `${target}/`);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw Error(`Unsupported model URL ${target}`);
  const requests = [];
  let completions = 0;
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
      const completion = req.method === "POST" && url.pathname.endsWith("/chat/completions");
      if (completion && maxCompletions !== undefined && completions >= maxCompletions) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "evaluation proxy: model request limit reached" } }));
        return;
      }
      if (completion) completions++;
      if (reasoning && completion) {
        try {
          const json = JSON.parse(body.toString("utf8"));
          json.reasoning_effort = reasoning === "off" ? "none" : reasoning;
          body = Buffer.from(JSON.stringify(json));
        } catch {
          /* not JSON: forwarded unchanged */
        }
      }
      const entry = { method: req.method, path: url.pathname, body: body.toString("utf8") };
      if (record) requests.push(entry);
      if (observeModel) entry.completion = completion;
      const headers = { ...req.headers, host: url.host, "content-length": String(body.length) };
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = send(url, { method: req.method, headers }, (reply) => {
        if (record && observeModel && completion) {
          entry.status = reply.statusCode;
          observeResponseModel(reply, entry);
        }
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
    take() {
      completions = 0;
      return requests.splice(0);
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function observeResponseModel(reply, entry) {
  const decoder = new StringDecoder("utf8");
  let remaining = "";
  const inspect = (chunk) => {
    remaining += decoder.write(chunk);
    for (let newline = remaining.indexOf("\n"); newline >= 0; newline = remaining.indexOf("\n")) {
      const line = remaining.slice(0, newline);
      remaining = remaining.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const { model } = JSON.parse(line.slice(5));
        if (typeof model === "string" && model.length <= 200) {
          entry.model = model;
          reply.off("data", inspect);
          return;
        }
      } catch {
        // SSE control records carry no model identifier.
      }
    }
    if (remaining.length > 64_000) reply.off("data", inspect);
  };
  reply.on("data", inspect);
}
