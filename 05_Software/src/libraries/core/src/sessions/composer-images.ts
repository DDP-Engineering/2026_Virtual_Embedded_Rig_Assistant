// REQ-FUNC-c1af1946 REQ-SEC-a86087cf REQ-SEC-2beadc98
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import {
  type ComposerImage,
  type ComposerImageSource,
  composerRasterFormat,
  MAX_MESSAGE_IMAGE_BYTES,
  sessionIdSchema,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import { FileReadLimitError, readGuardedFile } from "../tools/files.js";
import { PathGuard } from "../workbench/path-guard.js";

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

async function guardPath(guard: PathGuard, path: string) {
  try {
    return await guard.resolve(path);
  } catch (error) {
    if (veraErrorSchema.safeParse(error).success) throw error;
    throw veraError("DENIED");
  }
}

async function importDirectory(guard: PathGuard, sessionId: string) {
  let relative = ".vera";
  for (const segment of ["attachments", sessionId]) {
    relative += `/${segment}`;
    const directory = join(guard.root, relative);
    const target = await guardPath(guard, relative);
    if (target.absolute !== directory) throw veraError("DENIED");
    guard.assertAuthorized();
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(directory)).isDirectory() || (await guardPath(guard, relative)).absolute !== directory)
      throw veraError("DENIED");
  }
  return relative;
}

async function storeOriginal(guard: PathGuard, sessionId: string, name: string, bytes: Buffer) {
  const directory = await importDirectory(guard, sessionId);
  const path = `${directory}/${randomUUID()}-${name}`;
  const destination = join(guard.root, path);
  if ((await guardPath(guard, path)).absolute !== destination) throw veraError("DENIED");
  guard.assertAuthorized();
  const handle = await open(destination, "wx", 0o600);
  let identity: Awaited<ReturnType<typeof handle.stat>> | undefined;
  let completed = false;
  const isDestination = async () => {
    if (!identity || (await realpath(destination)) !== destination) return false;
    const entry = await lstat(destination);
    return entry.isFile() && entry.dev === identity.dev && entry.ino === identity.ino;
  };
  try {
    identity = await handle.stat();
    if ((await guardPath(guard, path)).absolute !== destination || !(await isDestination()))
      throw veraError("DENIED");
    guard.assertAuthorized();
    await handle.writeFile(bytes);
    await handle.close();
    if ((await guardPath(guard, path)).absolute !== destination || !(await isDestination()))
      throw veraError("DENIED");
    completed = true;
    return path;
  } finally {
    await handle.close().catch(() => {});
    if (!completed && (await isDestination().catch(() => false))) await unlink(destination).catch(() => {});
  }
}

async function preview(bytes: Buffer, format: NonNullable<ReturnType<typeof composerRasterFormat>>) {
  const { default: sharp } = await import("sharp");
  try {
    const image = sharp(bytes, { failOn: "warning" });
    if ((await image.metadata()).format !== format) throw veraError("IMAGE_FORMAT");
    return (
      await image.autoOrient().resize(128, 128, { fit: "inside", withoutEnlargement: true }).png().toBuffer()
    ).toString("base64");
  } catch {
    throw veraError("IMAGE_FORMAT");
  }
}

/** Stage a validated raster for the composer and return a bounded preview alongside its durable path. */
export async function attachComposerImage(
  root: string,
  sessionId: string,
  source: ComposerImageSource,
  managedRoots: readonly string[] | undefined,
  authorize: () => void,
): Promise<ComposerImage> {
  if (!sessionIdSchema.safeParse(sessionId).success) throw veraError("INVALID");
  authorize();
  let guard: PathGuard;
  try {
    guard = await PathGuard.create(root, root, "workbench", authorize, managedRoots, [], {
      allowSessionAttachments: true,
    });
  } catch (error) {
    if (veraErrorSchema.safeParse(error).success) throw error;
    throw veraError("DENIED");
  }
  if ("path" in source) {
    let bytes: Buffer;
    try {
      ({ bytes } = await readGuardedFile(
        guard,
        source.path,
        MAX_MESSAGE_IMAGE_BYTES,
        new AbortController().signal,
      ));
    } catch (error) {
      if (veraErrorSchema.safeParse(error).success) throw error;
      if (error instanceof FileReadLimitError) throw veraError("IMAGE_TOO_LARGE");
      if (missing(error)) throw veraError("NOT_FOUND");
      throw veraError("DENIED");
    }
    const path = posix.normalize(source.path.replaceAll("\\", "/"));
    const format = composerRasterFormat(path, bytes, true);
    if (!format) throw veraError("IMAGE_FORMAT");
    const thumbnail = await preview(bytes, format);
    authorize();
    return { path, name: posix.basename(path), thumbnail };
  }

  const bytes = Buffer.from(source.data, "base64");
  if (bytes.length > MAX_MESSAGE_IMAGE_BYTES) throw veraError("IMAGE_TOO_LARGE");
  const format = composerRasterFormat(source.name, bytes, false);
  if (!format) throw veraError("IMAGE_FORMAT");
  const thumbnail = await preview(bytes, format);
  const extension = format === "jpeg" ? "jpg" : format;
  const stem = basename(source.name)
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "_")
    .trim();
  const safeStem = [...stem].slice(0, 48).join("");
  const name = `${safeStem || "image"}.${extension}`;
  const path = await storeOriginal(guard, sessionId, name, bytes);
  return { path, name, thumbnail };
}
