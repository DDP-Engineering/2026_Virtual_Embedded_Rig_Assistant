// REQ-TEST-8928f10f: normal OpenAI-compatible HTTP/SSE fixture, no app switches.
import assert from "node:assert/strict";
import { createServer } from "node:http";

export function assertRequestBudget(body, bytes = Buffer.byteLength(JSON.stringify(body))) {
  assert.equal(body.max_completion_tokens, 4096, "Output reserve differs from configured model");
  assert(
    Number.isSafeInteger(bytes) && bytes > 0 && bytes <= 27033,
    "Serialized whole-request bytes exceed input budget",
  );
  return {
    contextWindow: 32768,
    inputBudgetTokens: 27033,
    reservedOutputTokens: 4096,
    safetyMarginTokens: 1639,
    serializedRequestBytes: bytes,
  };
}
export function assertSnapshotBudget(usage) {
  assert.equal(usage.contextWindow, 32768);
  assert.equal(usage.inputBudgetTokens, 27033);
  assert.equal(usage.reservedOutputTokens, 4096);
  assert.equal(usage.safetyMarginTokens, 1639);
  assert(
    Number.isSafeInteger(usage.contextTokens) &&
      usage.contextTokens > 0 &&
      usage.contextTokens <= usage.inputBudgetTokens,
    "Context exceeds complete request budget",
  );
  return { ...usage };
}
export async function startSmokeServer() {
  const requests = [];
  const errors = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "smoke" }] }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (b) => {
      raw += b;
      if (raw.length > 2000000) req.destroy();
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw);
        assert.equal(body.stream, true);
        assert.equal(body.model, "smoke");
        const budget = assertRequestBudget(body, Buffer.byteLength(raw));
        assert(body.tools.some((t) => t.function.name === "read"));
        assert(body.tools.some((t) => t.function.name === "write"));
        const step = requests.length;
        assert(step < 3, "Unexpected extra model request");
        requests.push({ method: req.method, path: req.url, body, bytes: Buffer.byteLength(raw), budget });
        let deltas;
        if (step < 2) {
          if (step === 1)
            assert(body.messages.some((m) => m.role === "tool" && m.content.includes("WORKBENCH.md#L1")));
          const name = step === 0 ? "read" : "write";
          const args = JSON.stringify(
            step === 0
              ? { path: "WORKBENCH.md", offset: 1, limit: 4 }
              : { path: "notes/smoke-approved.md", content: "Release smoke approval passed.\n" },
          );
          deltas = [
            {
              role: "assistant",
              tool_calls: [
                { index: 0, id: `smoke-${step}`, type: "function", function: { name, arguments: "" } },
              ],
            },
            { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 12) } }] },
            { tool_calls: [{ index: 0, function: { arguments: args.slice(12) } }] },
          ];
        } else {
          assert(body.messages.filter((m) => m.role === "tool").length >= 2);
          deltas = [{ content: "Demo board verified " }, { content: "[[WORKBENCH.md#L1-L4]]." }];
        }
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const chunk = (delta, finish_reason) =>
          res.write(
            `data: ${JSON.stringify({ id: `smoke-${step}`, object: "chat.completion.chunk", created: 0, model: "smoke", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        for (const delta of deltas) chunk(delta, null);
        chunk({}, step < 2 ? "tool_calls" : "stop");
        res.end("data: [DONE]\n\n");
      } catch (error) {
        errors.push(String(error));
        res.writeHead(400).end("Invalid smoke request");
      }
    });
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    errors,
    close: () =>
      new Promise((accept) => {
        server.closeAllConnections();
        server.close(accept);
      }),
  };
}
