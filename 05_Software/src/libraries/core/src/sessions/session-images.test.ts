import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channels } from "@vera/shared";
import sharp from "sharp";
import { expect, it } from "vitest";
import { ContextPolicy, conservativeCounter } from "../agent/context.js";
import { buildSessionMarkdown } from "./export.js";
import {
  cleanups,
  contextWindow,
  maxBytes,
  maxOutputTokens,
  raster,
  setup,
  userParts,
} from "./session-images.test-support.js";

// IMG-02-A
it("sends resized pi-ai image parts to a vision model and only paths to a text model", async () => {
  const { root, requests, open } = await setup();
  const service = open();
  const landscape = await raster(2560, 640);
  const portrait = await raster(640, 2560);
  await writeFile(join(root, "board.png"), landscape);
  await writeFile(join(root, "scope.png"), portrait);
  for (const model of ["vision", "text"]) {
    const { id } = service.create(`custom:local/${model}`);
    await service.sendWithImages(id, "Inspect.", ["board.png", "scope.png"]);
    expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  }
  expect(requests.map(({ model }) => model)).toEqual(["vision", "text"]);
  const images = userParts(requests[0]).filter((part) => part.type === "image_url");
  expect(images).toHaveLength(2);
  for (const [index, image] of images.entries()) {
    expect(image.image_url.url).toMatch(/^data:image\/png;base64,/);
    const media = Buffer.from(image.image_url.url.split(",")[1] ?? "", "base64");
    expect(await sharp(media).metadata()).toMatchObject(
      index === 0 ? { width: 2048, height: 512 } : { width: 512, height: 2048 },
    );
  }
  const text = userParts(requests[1]);
  expect(requests[1]?.messages.find(({ role }) => role === "user")?.content).toEqual(expect.any(String));
  expect(text.every((part) => part.type === "text")).toBe(true);
  expect(JSON.stringify(text)).toContain("board.png");
  expect(JSON.stringify(text)).toContain("scope.png");
  expect(await readFile(join(root, "board.png"))).toEqual(landscape);
  expect(await readFile(join(root, "scope.png"))).toEqual(portrait);
});

it("persists only paths for initial and queued images, replays the queue and keeps paths in exports", async () => {
  const { root, requests, open, storedRows, holdResponse } = await setup();
  for (const path of ["initial.png", "queued.png"]) await writeFile(join(root, path), await raster());
  const service = open();
  const { id } = service.create();
  let releaseResponse = () => {};
  holdResponse(
    new Promise<void>((resolve) => {
      releaseResponse = resolve;
    }),
  );
  try {
    const first = await service.sendWithImages(id, "Initial", ["initial.png"]);
    await expect.poll(() => requests.length).toBe(1);
    const queued = await service.sendWithImages(id, "Queued", ["queued.png"]);
    expect(queued.turnId).toBe(first.turnId);
    const events = service.exportSession(id);
    expect(events.events.map(({ event }) => event)).toEqual(
      expect.arrayContaining([
        {
          type: "message.user",
          messageId: first.messageId,
          text: "Initial",
          images: ["initial.png"],
          timestamp: expect.any(Number),
        },
        expect.objectContaining({
          type: "message.queued",
          messageId: queued.messageId,
          images: ["queued.png"],
        }),
      ]),
    );
    expect(buildSessionMarkdown(events, [])).toContain("queued.png");
    expect(JSON.stringify(events)).not.toContain("base64");
    expect(service.stop(id)).toBe(true);
  } finally {
    releaseResponse();
  }
  expect(await service.waitIdle(id)).toEqual({ stopReason: "aborted" });
  await service.close();
  const restored = open();
  expect(restored.get(id).snapshot.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "user", images: ["initial.png"] }),
      expect.objectContaining({ kind: "user", pending: true, images: ["queued.png"] }),
    ]),
  );
  restored.send(id, "Continue");
  expect(await restored.waitIdle(id)).toEqual({ stopReason: "end" });
  expect(userParts(requests[1]).filter(({ type }) => type === "image_url")).toHaveLength(2);
  const items = restored.get(id).snapshot.items;
  expect(
    items.find((item) => item.kind === "user" && item.images?.includes("queued.png")),
  ).not.toHaveProperty("pending");
  const stored = JSON.stringify(storedRows("SELECT content_json FROM messages"));
  expect(stored).toContain("queued.png");
  expect(stored).not.toMatch(/base64|image\/png/);
});

it.each([
  { model: "vision", short: 0 },
  { model: "vision", short: 1 },
  { model: "text", short: 0 },
  { model: "text", short: 1 },
])("admits a queued image only when $model fits (short by $short)", async ({ model, short }) => {
  const expected = {
    role: "user" as const,
    timestamp: 0,
    content:
      model === "vision"
        ? [
            { type: "text" as const, text: "Queued" },
            { type: "text" as const, text: "Image attachment: queued.jpeg" },
            { type: "image" as const, data: "", mimeType: "image/jpeg" },
          ]
        : "Queued\nImage attachment: queued.jpeg",
  };
  const fixed = { system: "", tools: [] };
  const imageCost = conservativeCounter({ ...fixed, messages: [expected] }).tokens;
  const budget = contextWindow - maxOutputTokens - Math.ceil(contextWindow * 0.05);
  const policy = new ContextPolicy(({ messages }) => {
    const queued = messages.find(
      (message) =>
        message.role === "user" &&
        (typeof message.content === "string"
          ? message.content === "Queued" || message.content.startsWith("Queued\n")
          : message.content.some((part) => part.type === "text" && part.text === "Queued")),
    );
    const { tokens } = conservativeCounter({ ...fixed, messages: queued ? [queued] : [] });
    return { tokens: queued ? tokens + budget - imageCost + short : tokens, estimated: true };
  });
  const { root, requests, open, holdResponse } = await setup(policy);
  const service = open();
  const { id } = service.create(`custom:local/${model}`);
  await writeFile(
    join(root, "queued.jpeg"),
    await sharp(await raster())
      .jpeg()
      .toBuffer(),
  );
  let releaseResponse = () => {};
  holdResponse(
    new Promise<void>((resolve) => {
      releaseResponse = resolve;
    }),
  );
  let queuedId: string;
  try {
    service.send(id, "Start");
    await expect.poll(() => requests.length).toBe(1);
    const { messageId } = await service.sendWithImages(id, "Queued", ["queued.jpeg"]);
    queuedId = messageId;
  } finally {
    releaseResponse();
  }
  expect(await service.waitIdle(id)).toEqual({ stopReason: short ? "limit" : "end" });
  const item = service.get(id).snapshot.items.find(({ id: messageId }) => messageId === queuedId);
  if (short) {
    expect(item).toMatchObject({ pending: true });
    expect(requests).toHaveLength(1);
  } else {
    expect(item).not.toHaveProperty("pending");
    expect(requests).toHaveLength(2);
    const parts = userParts(requests[1]);
    expect(JSON.stringify(parts)).toContain("queued.jpeg");
    expect(parts.some(({ type }) => type === "image_url")).toBe(model === "vision");
  }
});

it.each(["jpeg", "gif", "webp"] as const)("sends a small %s without enlarging it", async (format) => {
  const { root, requests, open } = await setup();
  const service = open();
  const { id } = service.create();
  const path = `capture.${format}`;
  const image = await sharp(await raster())
    .toFormat(format)
    .toBuffer();
  await writeFile(join(root, path), image);
  await service.sendWithImages(id, "Inspect", [path]);
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  const part = userParts(requests[0]).find((part) => part.type === "image_url");
  expect(part?.image_url.url).toContain(`data:image/${format};base64,`);
  const sent = Buffer.from(part?.image_url.url.split(",")[1] ?? "", "base64");
  expect(await sharp(sent).metadata()).toMatchObject({ width: 4, height: 3, format });
});

it("keeps the path when a previously admitted file is unavailable", async () => {
  const { root, requests, open } = await setup();
  const service = open();
  const { id } = service.create();
  const path = join(root, "removed.png");
  await writeFile(path, await raster());
  await service.sendWithImages(id, "Inspect", ["removed.png"]);
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  await rm(path);
  service.send(id, "Then explain the tradeoff.");
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  const parts = userParts(requests[1]);
  expect(parts.every(({ type }) => type === "text")).toBe(true);
  expect(JSON.stringify(parts)).toContain("removed.png (image unavailable)");
});

// IMG-02-B
it("admits eight paths and a raster at the byte cap, then refuses nine and a file one byte over", async () => {
  const { root, open } = await setup();
  const service = open();
  const { id } = service.create("custom:local/text");
  const exact = join(root, "exact.png");
  await writeFile(exact, await raster());
  await truncate(exact, maxBytes);
  const paths = ["exact.png"];
  for (let i = 1; i < 8; i++) {
    paths.push(`image-${i}.png`);
    await writeFile(join(root, paths[i] ?? ""), await raster());
  }
  const { request } = channels["session.send"];
  expect(request.safeParse({ sessionId: id, text: "", images: paths }).success).toBe(true);
  expect(request.safeParse({ sessionId: id, text: "", images: [] }).success).toBe(false);
  const excessive = [...paths, "ninth.png"];
  expect(request.safeParse({ sessionId: id, text: "Ask", images: excessive }).success).toBe(false);
  await service.sendWithImages(id, "", paths);
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  const revision = service.revision(id);
  await expect(service.sendWithImages(id, "Ask", excessive)).rejects.toMatchObject({ code: "INVALID" });
  await truncate(exact, maxBytes + 1);
  await expect(service.sendWithImages(id, "Ask", paths)).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  expect(service.revision(id)).toEqual(revision);
});

it("types refusals for SVG, signature spoofing, corrupt rasters and paths outside the workbench", async () => {
  const { root, requests, open } = await setup();
  const service = open();
  const { id } = service.create("custom:local/text", "bypass");
  const outside = await mkdtemp(join(tmpdir(), "vera-image-outside-"));
  cleanups.push(() => rm(outside, { recursive: true, force: true }));
  const sample = await raster();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>';
  await writeFile(join(root, "image.SVG"), svg);
  await writeFile(join(root, "pretends.png"), svg);
  await writeFile(join(root, "broken.png"), sample.subarray(0, 32));
  await writeFile(join(outside, "outside.png"), sample);
  await symlink(outside, join(root, "outside"), "junction");
  const revision = service.revision(id);
  for (const path of ["image.SVG", "pretends.png", "broken.png"])
    await expect(service.sendWithImages(id, "Ask", [path])).rejects.toMatchObject({ code: "IMAGE_FORMAT" });
  for (const path of ["../outside.png", join(outside, "outside.png"), "outside/outside.png", "outside"])
    await expect(service.sendWithImages(id, "Ask", [path])).rejects.toMatchObject({ code: "DENIED" });
  expect(service.revision(id)).toEqual(revision);
  expect(requests).toEqual([]);
});
