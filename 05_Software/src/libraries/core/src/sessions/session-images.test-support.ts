import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings } from "@vera/shared";
import sharp from "sharp";
import { afterEach } from "vitest";
import { conservativeCounting } from "../agent/conservative-counting.test-support.js";
import type { ContextPolicy } from "../agent/context.js";
import { createPiAiGateway } from "../llm/providers.js";
import { openDb } from "../storage/db.js";
import { type SessionHost, SessionService } from "./service.js";

export const maxBytes = 20 * 1024 * 1024;
export const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
export const raster = (width = 4, height = 3) =>
  sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .png()
    .toBuffer();

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type WireMessage = { role: string; content: string | Part[] };
type Request = { model: string; messages: WireMessage[]; tools?: { function: { name: string } }[] };
export function userParts(request: Request | undefined) {
  return (request?.messages ?? [])
    .filter(({ role }) => role === "user")
    .flatMap(({ content }) =>
      typeof content === "string" ? [{ type: "text" as const, text: content }] : content,
    );
}
export const contextWindow = 32768;
export const maxOutputTokens = 4096;

export async function setup(contextPolicy?: ContextPolicy) {
  const root = await mkdtemp(join(tmpdir(), "vera-session-images-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests: Request[] = [];
  let hold: Promise<void> | undefined;
  const imageCalls: string[][] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Request;
    requests.push(body);
    await hold;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const toolPaths = imageCalls.shift();
    const choices = toolPaths?.length
      ? [
          {
            index: 0,
            delta: {
              tool_calls: toolPaths.map((path, index) => ({
                index,
                id: `view-${requests.length}-${index}`,
                type: "function",
                function: { name: "view_image", arguments: JSON.stringify({ path }) },
              })),
            },
            finish_reason: "tool_calls",
          },
        ]
      : [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }];
    const event = { id: "fake", model: body.model, choices };
    res.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing loopback address");
  const settings = defaultSettings("00000000-0000-4000-8000-000000000001");
  settings.providers.custom = [
    {
      slug: "local",
      name: "Local",
      model: "vision",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      contextWindow,
      maxOutputTokens,
      imageModels: ["vision"],
    },
  ];
  const gateway = createPiAiGateway({
    settings: () => settings,
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async (_slot, apply) => apply(undefined),
      delete: async () => {},
    },
    scrub: (text) => text,
    now: () => 0,
  });
  const db = await openDb(join(root, "session.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanups.push(async () => db.close());
  const open = (overrides?: Pick<SessionHost, "managedRoots" | "additionalFolders" | "disabledTools">) => {
    const session = new SessionService({
      db: db.db,
      root,
      gateway,
      clock: { now: () => new Date(0), sleep: async () => {} },
      model: (model) => model ?? "custom:local/vision",
      prompt: () => "Explain the image.",
      mode: "read-only",
      advanced: conservativeCounting,
      ...overrides,
      ...(contextPolicy && { contextPolicy }),
    });
    cleanups.push(() => session.close());
    return session;
  };
  return {
    root,
    requests,
    open,
    storedRows: (sql: string): unknown[] => db.db.prepare(sql).all(),
    callViewImage: (...paths: string[]) => {
      imageCalls.push(paths);
    },
    holdResponse: (pending: Promise<void>) => {
      hold = pending;
    },
  };
}
