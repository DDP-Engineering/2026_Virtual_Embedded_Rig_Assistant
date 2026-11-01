import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Clock, FileAccess } from "@vera/core";

function code(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

export function createFileAccess(
  clock: Clock,
  operations: { rename(source: string, destination: string): Promise<void> } = { rename },
): FileAccess {
  async function durableWrite(path: string, content: string): Promise<void> {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return {
    async read(path) {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (code(error) === "ENOENT") return undefined;
        throw error;
      }
    },
    async writeAtomic(path, content) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await durableWrite(temporary, content);
        for (let attempt = 0; ; attempt++) {
          try {
            await operations.rename(temporary, path);
            break;
          } catch (error) {
            if (attempt >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(String(code(error)))) throw error;
            await clock.sleep(10);
          }
        }
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
