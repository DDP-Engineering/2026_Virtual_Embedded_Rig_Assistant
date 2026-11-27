import type { ImageContent, Message } from "@earendil-works/pi-ai";
import { MAX_IMAGE_FILE_BYTES, messageImagesSchema, veraError, veraErrorSchema } from "@vera/shared";
import { imagePaths, imageRequestMessage } from "../agent/message-images.js";
import { readRasterFile } from "../tools/raster-file.js";
import { PathGuard } from "../workbench/path-guard.js";

/** Validates and prepares ordinary raster files under primary-workbench authority. */
export class SessionImages {
  private guard?: Promise<PathGuard>;
  private readonly prepared = new Map<string, Awaited<ReturnType<typeof readRasterFile>>>();

  constructor(
    private readonly root: string,
    private readonly managedRoots: readonly string[] | undefined,
  ) {}

  beginRequest(paths: readonly (readonly string[])[]): void {
    // Ignore rules may change between continuations, even when the raster bytes did not.
    delete this.guard;
    if (!this.prepared.size) return;
    const included = new Set(paths.flat());
    for (const path of this.prepared.keys()) if (!included.has(path)) this.prepared.delete(path);
  }

  async validate(images: string[], maxBytes: number): Promise<string[]> {
    const parsed = messageImagesSchema.safeParse(images);
    if (!parsed.success) throw veraError("INVALID");
    const paths = parsed.data.map((path) => path.replaceAll("\\", "/"));
    const signal = new AbortController().signal;
    for (const path of paths) await this.read(path, signal, maxBytes);
    return paths;
  }

  async read(path: string, signal: AbortSignal, maxBytes = MAX_IMAGE_FILE_BYTES): Promise<ImageContent> {
    this.guard ??= PathGuard.create(this.root, this.root, "workbench", undefined, this.managedRoots, [], {
      allowSessionAttachments: true,
    });
    try {
      const prepared = await readRasterFile(this.guard, path, signal, maxBytes, this.prepared.get(path));
      this.prepared.set(path, prepared);
      return prepared.image;
    } catch (error) {
      this.prepared.delete(path);
      throw error;
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
  const allPaths = messages.map(imagePaths);
  reader?.beginRequest(allPaths);
  for (const [index, message] of messages.entries()) {
    const paths = allPaths[index] ?? [];
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
