import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { advancedSettings, builtinToolNames } from "@vera/shared";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { cleanups, raster, setup, userParts } from "./session-images.test-support.js";

// IMG-05-A
it("offers view_image only to vision models and sends a scaled tool image without saving pixels", async () => {
  const { root, open, requests, storedRows, callViewImage } = await setup();
  const service = open();
  const source = await raster(2560, 640);
  await writeFile(join(root, "board.png"), source);

  const vision = service.create("custom:local/vision");
  callViewImage("board.png");
  service.send(vision.id, "Inspect the board.");
  expect(await service.waitIdle(vision.id)).toEqual({ stopReason: "end" });
  expect(requests[0]?.tools?.some(({ function: tool }) => tool.name === "view_image")).toBe(true);
  expect(userParts(requests[0]).every(({ type }) => type === "text")).toBe(true);
  expect(requests[1]?.messages.find(({ role }) => role === "tool")?.content).toContain("board.png");
  const images = userParts(requests[1]).filter((part) => part.type === "image_url");
  expect(images).toHaveLength(1);
  const url = images[0]?.image_url.url;
  expect(url).toMatch(/^data:image\/png;base64,/);
  expect(await sharp(Buffer.from(url?.split(",")[1] ?? "", "base64")).metadata()).toMatchObject({
    width: 2048,
    height: 512,
  });
  expect(await readFile(join(root, "board.png"))).toEqual(source);
  for (const sql of ["SELECT content_json FROM messages", "SELECT result_json FROM tool_calls"]) {
    const stored = JSON.stringify(storedRows(sql));
    expect(stored).toContain("board.png");
    expect(stored).not.toMatch(/base64|image\/png/);
  }
  const exported = JSON.stringify(service.exportSession(vision.id));
  expect(exported).toContain("board.png");
  expect(exported).not.toMatch(/base64|image\/png/);

  const text = service.create("custom:local/text");
  callViewImage("board.png");
  service.send(text.id, "Inspect the board.");
  expect(await service.waitIdle(text.id)).toEqual({ stopReason: "end" });
  expect(requests[2]?.tools?.some(({ function: tool }) => tool.name === "view_image")).toBe(false);
  expect(requests[3]?.messages.find(({ role }) => role === "tool")?.content).toMatch(
    /unavailable|unknown tool/i,
  );
  expect(userParts(requests[3]).every(({ type }) => type === "text")).toBe(true);

  service.send(vision.id, "Summarize the earlier inspection.");
  expect(await service.waitIdle(vision.id)).toEqual({ stopReason: "end" });
  expect(requests[4]?.messages.find(({ role }) => role === "tool")?.content).toContain("board.png");
  expect(userParts(requests[4]).every(({ type }) => type === "text")).toBe(true);
});

// IMG-05-B
it("refuses outside, redirected, ignored and invalid files without sending an image", async () => {
  const { root, open, requests, callViewImage } = await setup();
  const outside = await mkdtemp(join(tmpdir(), "vera-view-image-outside-"));
  cleanups.push(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(root, "captures"));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "managed"));
  const png = await raster();
  await writeFile(join(root, "captures", "board.png"), png);
  await writeFile(join(outside, "outside.png"), png);
  await writeFile(join(root, ".vera", ".veraignore"), "private.png\n");
  await writeFile(join(root, "private.png"), png);
  await writeFile(join(root, "managed", "internal.png"), png);
  await symlink(outside, join(root, "outside-link"), "junction");
  await symlink(join(root, "captures"), join(root, "inside-link"), "junction");
  await writeFile(join(root, "drawing.svg"), "<svg/>");
  await writeFile(join(root, "pretends.png"), "<svg/>");
  await writeFile(join(root, "broken.png"), png.subarray(0, 32));
  await writeFile(join(root, "large.png"), png);
  await truncate(join(root, "large.png"), 1024 * 1024 + 1);

  const service = open({
    managedRoots: [join(root, "managed")],
    additionalFolders: () => [outside],
    advanced: { app: () => ({ imageFileMB: 1 }), workbench: () => undefined },
  });
  const { id } = service.create("custom:local/vision", "bypass");
  const denied = [
    `../${basename(outside)}/outside.png`,
    join(outside, "outside.png"),
    "outside-link/outside.png",
    "inside-link/board.png",
    "private.png",
    "managed/internal.png",
  ];
  callViewImage(...denied, "drawing.svg", "pretends.png", "broken.png", "large.png");
  service.send(id, "Inspect these files.");
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  const results = requests[1]?.messages.filter(({ role }) => role === "tool").map(({ content }) => content);
  expect(results).toHaveLength(denied.length + 4);
  expect(results?.slice(0, denied.length)).toEqual(denied.map(() => expect.stringContaining("DENIED")));
  expect(results?.slice(denied.length)).toEqual([
    ...[1, 2, 3].map(() => expect.stringContaining("IMAGE_FORMAT")),
    expect.stringContaining("IMAGE_TOO_LARGE"),
  ]);
  expect(results?.at(-1)).toContain("at most 1 MiB");
  expect(userParts(requests[1]).every(({ type }) => type === "text")).toBe(true);
});

it("reopens composer images delivered to this session and refuses unshared managed images", async () => {
  const { root, open, requests, callViewImage } = await setup();
  await mkdir(join(root, ".vera"));
  const sending = open();
  const { id } = sending.create();
  const { id: other } = sending.create();
  const data = (await raster()).toString("base64");
  const shared = await sending.attachImage(id, { name: "shared.png", data });
  const draft = await sending.attachImage(id, { name: "draft.png", data });
  await sending.sendWithImages(id, "Here is my screenshot.", [shared.path]);
  expect(await sending.waitIdle(id)).toEqual({ stopReason: "end" });
  await sending.close();

  const service = open();
  callViewImage(shared.path, draft.path);
  service.send(id, "Look at both paths.");
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  const results = requests[2]?.messages.filter(({ role }) => role === "tool");
  expect(results?.map(({ content }) => content)).toEqual([
    expect.stringContaining(shared.path),
    expect.stringContaining("DENIED"),
  ]);
  expect(userParts(requests[2]).filter(({ type }) => type === "image_url")).toHaveLength(2);

  callViewImage(shared.path);
  service.send(other, "Look at this path.");
  expect(await service.waitIdle(other)).toEqual({ stopReason: "end" });
  expect(requests[4]?.messages.find(({ role }) => role === "tool")?.content).toContain("DENIED");
  expect(userParts(requests[4]).every(({ type }) => type === "text")).toBe(true);
});

it.each([undefined, 10])("bounds image-tool batches and retention with image count %s", async (limit) => {
  const { root, open, requests, callViewImage } = await setup(undefined, 65536);
  const service = open({
    disabledTools: builtinToolNames.filter((name) => name !== "view_image"),
    ...(limit === undefined
      ? {}
      : {
          advanced: { app: () => ({ imagesPerMessage: limit }), workbench: () => undefined },
        }),
  });
  const { id } = service.create();
  const count = limit ?? advancedSettings.imagesPerMessage.default;
  const paths = Array.from({ length: count + 1 }, (_, index) => `board-${index}.png`);
  for (const [index, path] of paths.entries()) await writeFile(join(root, path), await raster(5 + index));
  callViewImage(...paths);
  callViewImage(paths[count] ?? "");
  service.send(id, "Look at this image series.");
  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });

  const imageWidths = (request: (typeof requests)[number] | undefined) =>
    Promise.all(
      userParts(request)
        .filter((part) => part.type === "image_url")
        .map(async ({ image_url }) => {
          const bytes = Buffer.from(image_url.url.split(",")[1] ?? "", "base64");
          return (await sharp(bytes).metadata()).width;
        }),
    );
  const results = requests[1]?.messages.filter(({ role }) => role === "tool");
  expect(results).toHaveLength(paths.length);
  expect(results?.at(-1)?.content).toContain(`At most ${count} images`);
  expect(await imageWidths(requests[1])).toEqual(paths.slice(0, -1).map((_, index) => 5 + index));
  expect(await imageWidths(requests[2])).toEqual(paths.slice(1).map((_, index) => 6 + index));
});

it("authorizes a queued attachment only after the runtime delivers its message", async () => {
  const { root, open, requests, holdResponse, callViewImage } = await setup();
  await mkdir(join(root, ".vera"));
  const service = open();
  const { id } = service.create();
  const image = await service.attachImage(id, {
    name: "queued.png",
    data: (await raster()).toString("base64"),
  });
  let releaseResponse = () => {};
  holdResponse(
    new Promise<void>((resolve) => {
      releaseResponse = resolve;
    }),
  );
  callViewImage(image.path);
  callViewImage(image.path);
  try {
    service.send(id, "Begin.");
    await expect.poll(() => requests.length).toBe(1);
    const message = await service.sendWithImages(id, "Now inspect this queued screenshot.", [image.path]);
    expect(service.get(id).snapshot.items.find((item) => item.id === message.messageId)).toMatchObject({
      kind: "user",
      pending: true,
    });
  } finally {
    releaseResponse();
  }

  expect(await service.waitIdle(id)).toEqual({ stopReason: "end" });
  const beforeDelivery = requests[1]?.messages.find(({ role }) => role === "tool");
  expect(beforeDelivery?.content).toContain("DENIED");
  const afterDelivery = requests[2]?.messages.findLast(({ role }) => role === "tool");
  expect(afterDelivery?.content).toContain(image.path);
  expect(userParts(requests[1]).filter(({ type }) => type === "image_url")).toHaveLength(1);
  expect(userParts(requests[2]).filter(({ type }) => type === "image_url")).toHaveLength(2);
});

it("stops the turn while a native raster decode is still pending", async () => {
  const { root, open, requests, callViewImage } = await setup();
  const service = open();
  const { id } = service.create();
  const png = await raster();
  await writeFile(join(root, "board.png"), png);
  let release = () => {};
  const blocked = new Promise<Buffer>((resolve) => {
    release = () => resolve(png);
  });
  const decode = vi.spyOn(sharp.prototype, "toBuffer").mockImplementationOnce(() => blocked);
  try {
    callViewImage("board.png");
    service.send(id, "Inspect");
    await expect.poll(() => decode.mock.calls.length).toBe(1);
    expect(service.stop(id)).toBe(true);
    expect(await service.waitIdle(id)).toEqual({ stopReason: "aborted" });
    expect(requests).toHaveLength(1);
  } finally {
    release();
    decode.mockRestore();
  }
});
