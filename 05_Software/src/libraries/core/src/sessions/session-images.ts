import type { ImageContent, Message } from "@earendil-works/pi-ai";
import { messageImagesSchema, veraError, veraErrorSchema } from "@vera/shared";
import { imagePaths, imageRequestMessage } from "../agent/message-images.js";
import { readRasterFile } from "../tools/raster-file.js";
import { PathGuard } from "../workbench/path-guard.js";

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
    this.guard ??= PathGuard.create(this.root, this.root, "workbench", undefined, this.managedRoots, [], {
      allowSessionAttachments: true,
    });
    return readRasterFile(this.guard, path, signal);
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
