import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_MESSAGE_IMAGE_BYTES } from "@vera/shared";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it } from "vitest";
import { attachComposerImage } from "./composer-images.js";

const session = "ses_00000000000000000000000000";
let root: string;
let workbench: string;
let outside: string;
let png: Buffer;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-composer-"));
  workbench = join(root, "workbench");
  outside = join(root, "outside");
  await Promise.all([mkdir(join(workbench, ".vera"), { recursive: true }), mkdir(outside)]);
  png = await sharp({
    create: { width: 3, height: 2, channels: 3, background: "#298042" },
  })
    .png()
    .toBuffer();
});

afterEach(async () => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));

const attach = (source: Parameters<typeof attachComposerImage>[2], authorize = () => {}) =>
  attachComposerImage(workbench, session, source, [], authorize);

it.each(["png", "jpeg", "gif", "webp"] as const)(
  "keeps original %s bytes and returns a PNG thumbnail",
  async (format) => {
    const bytes = await sharp(png).toFormat(format).toBuffer();
    const source = { name: `scope board.${format}`, data: bytes.toString("base64") };
    const first = await attach(source);
    const second = await attach(source);
    expect(first.path).not.toBe(second.path);
    expect(first.path).toMatch(new RegExp(`^\\.vera/attachments/${session}/`));
    expect(await readFile(join(workbench, first.path))).toEqual(bytes);
    expect(await sharp(Buffer.from(first.thumbnail, "base64")).metadata()).toMatchObject({
      format: "png",
      width: 3,
      height: 2,
    });
    const reused = await attach({ path: first.path });
    expect(reused.path).toBe(first.path);
    expect(await readdir(join(workbench, ".vera", "attachments", session))).toHaveLength(2);
  },
);

it("truncates an imported filename without splitting a supplementary Unicode letter", async () => {
  const stem = `${"a".repeat(47)}\u{20000}`;
  const image = await attach({ name: `${stem}tail.png`, data: png.toString("base64") });
  expect(image.name).toBe(`${stem}.png`);
  expect(await readFile(join(workbench, image.path))).toEqual(png);
});

it("refuses spoofed, mismatched, corrupt and oversized images before creating attachments", async () => {
  const text = Buffer.from("ordinary text");
  for (const [name, bytes] of [
    ["plain.png", text],
    ["wrong.jpg", png],
    ["broken.png", png.subarray(0, 30)],
  ] as const) {
    await expect(attach({ name, data: bytes.toString("base64") })).rejects.toMatchObject({
      code: "IMAGE_FORMAT",
    });
    await writeFile(join(workbench, name), bytes);
    await expect(attach({ path: name })).rejects.toMatchObject({ code: "IMAGE_FORMAT" });
  }
  await expect(
    attach({
      name: "oversize.png",
      data: Buffer.alloc(MAX_MESSAGE_IMAGE_BYTES + 1).toString("base64"),
    }),
  ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  await expect(readdir(join(workbench, ".vera"))).resolves.toEqual([]);
});

it("keeps file reads and import writes within the primary workbench", async () => {
  await writeFile(join(outside, "board.png"), png);
  await writeFile(join(workbench, ".vera", "board.png"), png);
  await symlink(outside, join(workbench, "redirect"), process.platform === "win32" ? "junction" : "dir");
  await symlink(
    outside,
    join(workbench, ".vera", "attachments"),
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const path of [
    "../outside/board.png",
    "redirect/board.png",
    ".vera/board.png",
    join(outside, "board.png"),
  ])
    await expect(attach({ path })).rejects.toMatchObject({ code: "DENIED" });
  await expect(attach({ name: "scope.png", data: png.toString("base64") })).rejects.toMatchObject({
    code: "DENIED",
  });
  expect(await readdir(outside)).toEqual(["board.png"]);
});
