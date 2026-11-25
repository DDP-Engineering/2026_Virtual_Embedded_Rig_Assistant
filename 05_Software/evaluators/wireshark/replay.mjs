import { createServer } from "node:http";
import { frameEvidence } from "./score.mjs";

const MODEL = "wireshark-replay";

const text = (message) =>
  typeof message.content === "string"
    ? message.content
    : (message.content ?? []).map((part) => part.text ?? "").join("");

function next(item, messages) {
  const outcomes = messages.filter((message) => message.role === "tool");
  const oracle = item.expect;
  const step = oracle.steps[outcomes.length];
  if (step) {
    const { tool = "wireshark_capture", operation, args } = step;
    return {
      tool_calls: [
        {
          index: 0,
          id: `call_replay_${outcomes.length}`,
          type: "function",
          function: { name: tool, arguments: JSON.stringify({ operation, ...args }) },
        },
      ],
    };
  }
  const evidence = new Map();
  for (const outcome of outcomes) {
    try {
      frameEvidence(JSON.parse(text(outcome)), evidence);
    } catch {
      // A plain-text failure issues no frame reference.
    }
  }
  const answer = Object.entries(oracle.facts).map(([label, [value]]) => {
    const frames = oracle.frames.filter((frame) => frame.fact === label);
    const refs = frames.map(({ fixture, number }) => {
      const id = `${oracle.fixtures[fixture]}:${number}`;
      const ref = evidence.get(id)?.values().next().value;
      return ref ? `[[${ref}]]` : "";
    });
    return `${label}: ${[value, ...refs].filter(Boolean).join(" ")}`;
  });
  return { content: answer.join("\n") };
}

async function respond(req, res, cases) {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { messages } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const prompt = messages.filter((message) => message.role === "user").at(-1);
  const item = prompt && cases.find((candidate) => text(prompt) === candidate.prompt);
  if (!item) {
    res.writeHead(422, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "No frozen Wireshark replay case matches the prompt." } }));
    return;
  }
  const delta = next(item, messages);
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const choice of [
    { delta: { role: "assistant", ...delta }, finish_reason: null },
    { delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" },
  ])
    res.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-wireshark-replay",
        object: "chat.completion.chunk",
        created: 0,
        model: MODEL,
        choices: [{ index: 0, ...choice }],
      })}\n\n`,
    );
  res.end("data: [DONE]\n\n");
}

/** Replay fixed calls through the gateway and bind citations to the tool's actual emitted locators. */
export async function startReplay(cases) {
  const server = createServer((req, res) => {
    respond(req, res, cases).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    model: MODEL,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
