// REQ-FUNC-66b6fda6
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { acquireWorkbenchGuard } from "@vera/core";
import { demoWorkbench, veraError } from "@vera/shared";

function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
async function ordinaryDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw veraError("DENIED");
  return realpath(path);
}
async function ordinaryFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw veraError("DENIED");
}
async function confirmParent(path: string) {
  if ((await ordinaryDirectory(path)) !== resolve(path)) throw veraError("DENIED");
}

/** Installs only bundled allowlisted files. Existing user contents are always preserved. */
export async function prepareDemoWorkbench(userData: string, bundled: string): Promise<string> {
  const root = await ordinaryDirectory(userData);
  const parent = join(root, "demo-workbenches");
  await mkdir(parent, { recursive: true });
  await ordinaryDirectory(parent);
  const folder = join(parent, demoWorkbench.name);
  const release = await acquireWorkbenchGuard(join(parent, ".demo-install"));
  if (!release) throw veraError("BUSY");
  let staging: string | undefined;
  try {
    try {
      await ordinaryDirectory(folder);
      try {
        await ordinaryFile(join(folder, "workbench.yaml"));
      } catch (error) {
        if (missing(error)) throw veraError("CONFLICT");
        throw error;
      }
      return folder;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const source = await ordinaryDirectory(bundled);
    staging = await mkdtemp(join(parent, ".install-"));
    for (const path of demoWorkbench.files) {
      const parts = path.split("/");
      if (parts.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))) throw veraError("INVALID");
      let directory = source;
      for (const part of parts.slice(0, -1)) {
        directory = join(directory, part);
        await ordinaryDirectory(directory);
      }
      const input = join(source, ...parts);
      await ordinaryFile(input);
      const output = join(staging, ...parts);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, await readFile(input), { flag: "wx" });
    }
    await ordinaryDirectory(parent);
    await rename(staging, folder);
    staging = undefined;
    return folder;
  } finally {
    try {
      // Only paths created by this invocation are removed, under the confirmed host root.
      await confirmParent(parent);
      if (staging) {
        await ordinaryDirectory(staging);
        await rm(staging, { recursive: true });
      }
    } finally {
      await release(); // The OS also releases the existing IPC guard on process exit.
    }
  }
}
