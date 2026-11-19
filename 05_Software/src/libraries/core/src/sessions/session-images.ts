import type { ImageContent, Message } from "@earendil-works/pi-ai";
import {
  MAX_MESSAGE_IMAGE_BYTES,
  messageImagesSchema,
  rasterSignature,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import { imagePaths, imageRequestMessage } from "../agent/message-images.js";
import { FileReadLimitError, readGuardedFile } from "../tools/files.js";
import { PathGuard } from "../workbench/path-guard.js";

const maxSide = 2048;

/** Validates and prepares ordinary raster files under primary-workbench authority. */
export class SessionImages {
  private guard?: Promise<PathGuard>;

  constructor(
    private readonly root: string,
    private readonly managedRoots: readonly string[] | undefined,
  ) {}

  async validate(images: string[]): Promise<string[]> {
    const parsed = messageImagesSchema.safeParse(images);
    if (!parsed.success) throw veraError("INVALID");
    const paths = parsed.data.map((path) => path.replaceAll("\\", "/"));
    const signal = new AbortController().signal;
    for (const path of paths) await this.read(path, signal);
    return paths;
  }

  async read(path: string, signal: AbortSignal): Promise<ImageContent> {
    let bytes: Buffer;
    try {
      this.guard ??= PathGuard.create(this.root, this.root, "workbench", undefined, this.managedRoots, [], {
        allowSessionAttachments: true,
      });
      ({ bytes } = await readGuardedFile(await this.guard, path, MAX_MESSAGE_IMAGE_BYTES, signal));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof FileReadLimitError) throw veraError("IMAGE_TOO_LARGE");
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw veraError("NOT_FOUND");
      throw veraError("DENIED");
    }
    if (/\.svgz?$/i.test(path)) throw veraError("IMAGE_FORMAT");
    const format = rasterSignature(bytes);
    if (!format) throw veraError("IMAGE_FORMAT");
    const { default: sharp } = await import("sharp");
    try {
      const image = sharp(bytes, { failOn: "warning" });
      if ((await image.metadata()).format !== format) throw veraError("IMAGE_FORMAT");
      const scaled = await image
        .autoOrient()
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
        .toFormat(format)
        .toBuffer();
      return { type: "image", mimeType: `image/${format}`, data: scaled.toString("base64") };
    } catch {
      throw veraError("IMAGE_FORMAT");
    } finally {
      signal.throwIfAborted();
    }
  }
}

/** Project durable references into a single provider request. Missing files keep their path. */
export async function projectMessageImages(
  messages: Message[],
  signal: AbortSignal,
  reader?: SessionImages,
): Promise<Message[]> {
  const result: Message[] = [];
  for (const message of messages) {
    const paths = imagePaths(message);
    if (message.role !== "user" || !paths.length) {
      result.push(message);
      continue;
    }
    if (!reader) {
      result.push(imageRequestMessage(message, paths));
      continue;
    }
    const images: (ImageContent | undefined)[] = [];
    for (const path of paths) {
      signal.throwIfAborted();
      try {
        images.push(await reader.read(path, signal));
      } catch (error) {
        signal.throwIfAborted();
        if (!veraErrorSchema.safeParse(error).success) throw error;
        images.push(undefined);
      }
    }
    result.push(imageRequestMessage(message, paths, images));
  }
  return result;
}
