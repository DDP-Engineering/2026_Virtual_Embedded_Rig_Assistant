import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DictationDownloadFailure } from "@vera/shared";
import type { DictationModelFile, DictationModelSpec } from "./catalog.js";

export class ModelDownloadError extends Error {
  constructor(readonly failure: DictationDownloadFailure) {
    super(failure);
  }
}

export function hasFileError(error: unknown, ...codes: string[]): boolean {
  return (
    error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code)
  );
}

const artifactOrigin = "https://huggingface.co";
const downloadOrigins = new Set([
  artifactOrigin,
  "https://us.aws.cdn.hf.co",
  "https://cas-bridge.xethub.hf.co",
]);

async function openArtifact(url: URL, signal: AbortSignal, transfer: typeof fetch) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!downloadOrigins.has(url.origin) || url.username || url.password) break;
    const response = await transfer(url, { signal, redirect: "manual", credentials: "omit" });
    if (response.status === 200 && response.body) return response.body;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
    url = new URL(location, url);
  }
  throw new ModelDownloadError("network");
}

/** Stream and verify a pinned artifact in its unpublished staging directory. */
export async function downloadModelFile(
  spec: DictationModelSpec,
  file: DictationModelFile,
  destination: string,
  signal: AbortSignal,
  transfer: typeof fetch,
  progress: (bytes: number) => void,
): Promise<void> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
  const url = new URL(
    `/${spec.repository}/resolve/${spec.revision}/${file.path}?download=true`,
    artifactOrigin,
  );
  let body: Awaited<ReturnType<typeof openArtifact>>;
  try {
    body = await openArtifact(url, requestSignal, transfer);
  } catch (error) {
    if (hasFileError(error, "ENOSPC", "EDQUOT")) throw error;
    throw new ModelDownloadError("network");
  }

  const hash = createHash("sha256");
  let received = 0;
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > file.bytes) {
        callback(new ModelDownloadError("integrity"));
        return;
      }
      hash.update(chunk);
      progress(chunk.length);
      callback(null, chunk);
    },
  });
  const source = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
  const destinationStream = createWriteStream(destination, { flags: "wx" });
  let sourceFailed = false;
  source.on("error", (error) => {
    if (error instanceof TypeError) sourceFailed = true;
  });
  try {
    await pipeline(source, verify, destinationStream, { signal: requestSignal });
  } catch (error) {
    if (sourceFailed || (requestSignal.aborted && !signal.aborted)) throw new ModelDownloadError("network");
    throw error;
  }
  if (received !== file.bytes || hash.digest("hex") !== file.sha256)
    throw new ModelDownloadError("integrity");
}
