import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";

/** Local acceptance feed only; no publishing and no non-loopback listener. */
export async function startUpdateFeed(directory, port = 0) {
  const root = resolve(directory),
    requests = [];
  const server = createServer(async (request, response) => {
    let name;
    try {
      name = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname.slice(1));
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (!name || basename(name) !== name || name.includes("\\") || name === "." || name === "..") {
      response.writeHead(404).end();
      return;
    }
    const record = {
      at: new Date().toISOString(),
      path: name,
      method: request.method,
      range: request.headers.range ?? null,
    };
    requests.push(record);
    try {
      const path = join(root, name);
      if (!(await stat(path)).isFile()) throw Error("not a file");
      const bytes = await readFile(path);
      response.setHeader("Content-Type", name.endsWith(".yml") ? "text/yaml" : "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      if (range) {
        const begin = Number(range[1]),
          end = range[2] ? Number(range[2]) : bytes.length - 1;
        if (begin > end || end >= bytes.length) {
          response.writeHead(416).end();
          record.status = 416;
          return;
        }
        response.setHeader("Content-Range", `bytes ${begin}-${end}/${bytes.length}`);
        response.writeHead(206).end(bytes.subarray(begin, end + 1));
        record.status = 206;
      } else {
        response.writeHead(200).end(bytes);
        record.status = 200;
      }
    } catch {
      response.writeHead(404).end();
      record.status = 404;
    }
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    requests,
    close: () => new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept()))),
  };
}
