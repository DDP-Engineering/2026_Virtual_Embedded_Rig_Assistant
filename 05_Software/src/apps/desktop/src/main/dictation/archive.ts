import { extractZip } from "@vera/core";
import type { DictationModelSpec } from "./catalog.js";
import { hasFileError, ModelDownloadError } from "./transfer.js";

/**
 * Extract a picked model archive into the model's unpublished staging directory. The limits allow exactly the
 * catalog inventory, and any archive that cannot be read is an integrity failure; the caller's fingerprint and
 * hash check then decides whether the staged tree is exactly the pinned model.
 */
export async function extractModelArchive(
  file: string,
  spec: DictationModelSpec,
  staging: string,
  signal: AbortSignal,
): Promise<void> {
  const bytes = spec.files.reduce((sum, item) => sum + item.bytes, 0);
  const folders = new Set(
    spec.files
      .filter((item) => item.path.includes("/"))
      .map((item) => item.path.slice(0, item.path.lastIndexOf("/"))),
  );
  try {
    await extractZip(file, staging, signal, { bytes, entries: spec.files.length + folders.size });
  } catch (error) {
    if (signal.aborted) throw error;
    const cause = error instanceof Error ? error.cause : undefined;
    if (hasFileError(error, "ENOSPC", "EDQUOT") || hasFileError(cause, "ENOSPC", "EDQUOT"))
      throw new ModelDownloadError("space");
    throw new ModelDownloadError("integrity");
  }
}
